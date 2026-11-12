(function () {
  const cfg = window.HUDDLE_SUPABASE || {};
  if (!cfg.url || !cfg.anonKey || !window.supabase?.createClient) return;

  const client = window.supabase.createClient(cfg.url, cfg.anonKey);
  const $ = (selector) => document.querySelector(selector);
  const html = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
  const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((part) => part[0] || '').join('').toUpperCase();
  let account = null;
  let remoteChats = [];
  let activeRemoteId = null;
  let filter = 'all';
  let subscription = null;
  let participantField;

  const dialog = document.createElement('dialog');
  dialog.id = 'authDialog';
  dialog.className = 'modal';
  dialog.innerHTML = '<form id="authForm"><div class="modal-head"><div><p class="eyebrow">YOUR HUDDLE ACCOUNT</p><h2>Sign in to sync chats</h2></div><button class="icon-button" type="button" id="authClose" aria-label="Close">×</button></div><label class="field-label" for="authDisplayName">Display name <span>needed when creating an account</span></label><input class="modal-input" id="authDisplayName" maxlength="60" placeholder="Your name"><label class="field-label" for="authEmail">Email</label><input class="modal-input" id="authEmail" type="email" autocomplete="email" placeholder="you@example.com" required><label class="field-label" for="authPassword">Password</label><input class="modal-input" id="authPassword" type="password" autocomplete="current-password" minlength="8" required><p class="auth-status" id="authStatus">Use your account to sync conversations across devices.</p><div class="auth-divider" id="authDivider"><span>or</span></div><button class="google-button" id="googleSignInButton" type="button"><span class="google-mark" aria-hidden="true">G</span>Continue with Google</button><div class="modal-actions"><button class="secondary-button" id="signOutButton" type="button" hidden>Sign out</button><button class="secondary-button" id="signInButton" type="button">Sign in</button><button class="primary-button" id="signUpButton" type="button">Create account</button></div></form>';
  document.body.append(dialog);
  const status = (message) => { $('#authStatus').textContent = message; };
  const toast = (message) => {
    const node = $('#toast');
    if (node) {
      node.textContent = message;
      node.classList.add('show');
      setTimeout(() => node.classList.remove('show'), 2400);
    }
  };

  function ensureParticipantField() {
    if (participantField) return;
    const note = $('#personNote');
    if (!note) return;
    participantField = document.createElement('div');
    participantField.innerHTML = '<label class="field-label" for="participantNames">Invite by display name <span>comma-separated for groups</span></label><input class="modal-input" id="participantNames" maxlength="240" placeholder="Alex Chen">';
    note.insertAdjacentElement('afterend', participantField);
  }

  function updateAccountControls() {
    $('#authDisplayName').hidden = Boolean(account);
    $('#authDisplayName').previousElementSibling.hidden = Boolean(account);
    $('#signInButton').hidden = Boolean(account);
    $('#signUpButton').hidden = Boolean(account);
    $('#googleSignInButton').hidden = Boolean(account);
    $('#authDivider').hidden = Boolean(account);
    $('#signOutButton').hidden = !account;
    $('#authEmail').readOnly = Boolean(account);
    $('#authPassword').hidden = Boolean(account);
    $('#authPassword').previousElementSibling.hidden = Boolean(account);
    if (account) {
      $('#authEmail').value = account.email || '';
      status('Signed in as ' + (account.email || 'your Huddle account') + '. Chats sync through Supabase.');
    } else {
      $('#authEmail').value = '';
      $('#authPassword').value = '';
    }
  }

  async function loadRemoteChats() {
    if (!account) return;
    const memberResult = await client.from('conversation_members').select('conversation_id,user_id').eq('user_id', account.id);
    if (memberResult.error) throw memberResult.error;
    const ids = [...new Set((memberResult.data || []).map((row) => row.conversation_id))];
    if (!ids.length) {
      remoteChats = [];
      renderRemoteList();
      return;
    }
    const [conversationResult, membersResult, messagesResult] = await Promise.all([
      client.from('conversations').select('id,name,is_group,created_at').in('id', ids).order('created_at', { ascending: false }),
      client.from('conversation_members').select('conversation_id,user_id').in('conversation_id', ids),
      client.from('messages').select('id,conversation_id,sender_id,body,created_at').in('conversation_id', ids).order('created_at', { ascending: true })
    ]);
    if (conversationResult.error) throw conversationResult.error;
    if (membersResult.error) throw membersResult.error;
    if (messagesResult.error) throw messagesResult.error;
    const userIds = [...new Set((membersResult.data || []).map((row) => row.user_id))];
    const profileResult = userIds.length ? await client.from('profiles').select('id,display_name').in('id', userIds) : { data: [], error: null };
    if (profileResult.error) throw profileResult.error;
    const names = new Map((profileResult.data || []).map((profile) => [profile.id, profile.display_name]));
    const membersByChat = new Map();
    (membersResult.data || []).forEach((row) => {
      if (!membersByChat.has(row.conversation_id)) membersByChat.set(row.conversation_id, []);
      membersByChat.get(row.conversation_id).push(row.user_id);
    });
    const messagesByChat = new Map();
    (messagesResult.data || []).forEach((row) => {
      if (!messagesByChat.has(row.conversation_id)) messagesByChat.set(row.conversation_id, []);
      messagesByChat.get(row.conversation_id).push({
        id: row.id, text: row.body, from: row.sender_id === account.id ? 'me' : 'them',
        sender: names.get(row.sender_id) || 'Huddle member',
        time: new Date(row.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
      });
    });
    remoteChats = (conversationResult.data || []).map((conversation) => {
      const otherId = (membersByChat.get(conversation.id) || []).find((id) => id !== account.id);
      const title = conversation.is_group ? conversation.name : (names.get(otherId) || 'New conversation');
      return {
        id: conversation.id, name: title, group: conversation.is_group,
        messages: messagesByChat.get(conversation.id) || [], color: 'linear-gradient(145deg,#62ae91,#24745f)'
      };
    });
    renderRemoteList();
    if (activeRemoteId) renderRemoteMessages();
  }

  function renderRemoteList() {
    const list = $('#chatList');
    const search = ($('#searchInput').value || '').trim().toLowerCase();
    const visible = remoteChats.filter((chat) =>
      (!search || chat.name.toLowerCase().includes(search) || chat.messages.some((message) => message.text.toLowerCase().includes(search))) &&
      (filter === 'all' || filter === 'groups' && chat.group)
    );
    $('#allCount').textContent = '';
    list.innerHTML = '';
    if (!visible.length) {
      list.innerHTML = '<div class="no-results">' + (remoteChats.length ? 'No chats match this filter.' : 'No synced chats yet. Start a conversation to invite someone.') + '</div>';
      return;
    }
    visible.forEach((chat) => {
      const last = chat.messages[chat.messages.length - 1];
      const item = document.createElement('button');
      item.className = 'chat-item' + (activeRemoteId === chat.id ? ' selected' : '');
      item.dataset.remoteId = chat.id;
      item.innerHTML = '<div class="avatar" style="background:' + chat.color + '">' + html(initials(chat.name)) + '</div><div class="chat-copy"><div class="chat-title-row"><strong>' + html(chat.name) + '</strong><span class="chat-time">' + html(last?.time || '') + '</span></div><div class="chat-preview">' + (last?.from === 'me' ? '<span style="color:#6ca58a">You: </span>' : '') + html(last?.text || 'Start a conversation') + '</div></div>';
      list.append(item);
    });
  }

  function openRemoteChat(id) {
    activeRemoteId = id;
    const chat = remoteChats.find((item) => item.id === id);
    if (!chat) return;
    $('#emptyState').classList.add('hidden');
    $('#activeChat').classList.remove('hidden');
    $('#headerAvatar').textContent = initials(chat.name);
    $('#headerAvatar').style.background = chat.color;
    $('#headerName').textContent = chat.name;
    $('#headerStatus').textContent = chat.group ? 'Group conversation · synced' : 'Synced with Huddle';
    renderRemoteMessages();
    renderRemoteList();
    if (innerWidth <= 760) $('#conversation').classList.add('mobile-open');
  }

  function renderRemoteMessages() {
    const chat = remoteChats.find((item) => item.id === activeRemoteId);
    if (!chat) return;
    $('#messages').innerHTML = chat.messages.map((message) =>
      '<div class="message-row ' + (message.from === 'me' ? 'mine' : '') + '"><div class="message-bubble">' +
      (message.from === 'them' && chat.group ? '<small class="message-sender">' + html(message.sender) + '</small>' : '') +
      html(message.text) + '</div><span class="message-meta">' + html(message.time) + (message.from === 'me' ? ' · ✓✓' : '') + '</span></div>'
    ).join('');
    const area = $('#messageArea');
    area.scrollTop = area.scrollHeight;
  }

  async function signedIn(user) {
    if (!user || account?.id === user.id) return;
    account = user;
    updateAccountControls();
    const existingProfile = await client.from('profiles').select('display_name').eq('id', user.id).maybeSingle();
    if (existingProfile.error) {
      status('Signed in, but profile lookup failed: ' + existingProfile.error.message);
      return;
    }
    const displayName = existingProfile.data?.display_name || user.user_metadata?.display_name || user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0] || 'Huddle member';
    const profile = await client.from('profiles').upsert({ id: user.id, display_name: displayName }, { onConflict: 'id' });
    if (profile.error) {
      status('Signed in, but profile setup failed: ' + profile.error.message);
      return;
    }
    await loadRemoteChats();
    if (subscription) await client.removeChannel(subscription);
    subscription = client.channel('huddle-messages-' + user.id)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (event) => {
        const row = event.new;
        if (remoteChats.some((chat) => chat.id === row.conversation_id)) {
          loadRemoteChats().catch((error) => status(error.message));
        }
      }).subscribe();
    const strip = $('#profileStrip .profile-copy');
    strip.querySelector('strong').textContent = displayName;
    strip.querySelector('span').textContent = user.email || 'Signed in · syncing chats';
    toast('Signed in. Your chats are syncing.');
  }

  async function signIn() {
    const email = $('#authEmail').value.trim();
    const password = $('#authPassword').value;
    status('Signing in…');
    const result = await client.auth.signInWithPassword({ email, password });
    if (result.error) return status(result.error.message);
    await signedIn(result.data.user);
    dialog.close();
  }

  async function signInWithGoogle() {
    status('Opening Google sign-in…');
    const result = await client.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin }
    });
    if (result.error) status(result.error.message);
  }

  async function signUp() {
    const displayName = $('#authDisplayName').value.trim();
    const email = $('#authEmail').value.trim();
    const password = $('#authPassword').value;
    if (!displayName) return status('Add your display name to create an account.');
    status('Creating your account…');
    const result = await client.auth.signUp({ email, password, options: { data: { display_name: displayName } } });
    if (result.error) return status(result.error.message);
    if (result.data.session && result.data.user) {
      await signedIn(result.data.user);
      dialog.close();
    } else {
      status('Check your email to confirm the account, then sign in here.');
    }
  }

  async function signOut() {
    const result = await client.auth.signOut();
    if (result.error) return status(result.error.message);
    account = null;
    remoteChats = [];
    activeRemoteId = null;
    if (subscription) await client.removeChannel(subscription);
    subscription = null;
    $('#conversation').classList.remove('mobile-open');
    $('#activeChat').classList.add('hidden');
    $('#emptyState').classList.remove('hidden');
    updateAccountControls();
    $('#profileStrip .profile-copy strong').textContent = 'You';
    $('#profileStrip .profile-copy span').textContent = 'Online · ready to chat';
    dialog.close();
    window.location.reload();
  }

  async function createRemoteChat(form) {
    const title = $('#personName').value.trim();
    const group = $('#groupCheck').checked;
    const rawParticipants = group ? $('#participantNames').value : title;
    const participantNames = [...new Set(rawParticipants.split(',').map((name) => name.trim()).filter(Boolean))];
    if (!title || !participantNames.length) return toast('Enter a chat title and at least one member name.');
    const found = [];
    for (const name of participantNames) {
      const result = await client.from('profiles').select('id,display_name').eq('display_name', name);
      if (result.error) return toast(result.error.message);
      const matches = (result.data || []).filter((profile) => profile.id !== account.id);
      if (matches.length !== 1) return toast(matches.length ? 'More than one account has that display name.' : 'No Huddle member named ' + name + ' was found.');
      found.push(matches[0]);
    }
    const created = await client.from('conversations').insert({
      name: group ? title : null, is_group: group, created_by: account.id
    }).select('id').single();
    if (created.error) return toast(created.error.message);
    const members = [account.id, ...found.map((profile) => profile.id)].map((userId) => ({
      conversation_id: created.data.id, user_id: userId
    }));
    const added = await client.from('conversation_members').insert(members);
    if (added.error) return toast('Conversation was created but adding members failed: ' + added.error.message);
    form.reset();
    $('#newChatDialog').close();
    await loadRemoteChats();
    openRemoteChat(created.data.id);
  }

  document.addEventListener('click', (event) => {
    if (event.target.closest('#profileButton')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      updateAccountControls();
      dialog.showModal();
    } else if (event.target.closest('#authClose')) dialog.close();
    else if (event.target.closest('#signInButton')) signIn().catch((error) => status(error.message));
    else if (event.target.closest('#signUpButton')) signUp().catch((error) => status(error.message));
    else if (event.target.closest('#googleSignInButton')) signInWithGoogle().catch((error) => status(error.message));
    else if (event.target.closest('#signOutButton')) signOut().catch((error) => status(error.message));
  }, true);

  document.addEventListener('input', (event) => {
    if (account && event.target.id === 'searchInput') {
      event.stopImmediatePropagation();
      renderRemoteList();
    }
  }, true);
  document.addEventListener('click', (event) => {
    const filterButton = event.target.closest('.filter');
    if (account && filterButton) {
      event.preventDefault();
      event.stopImmediatePropagation();
      filter = filterButton.dataset.filter;
      document.querySelectorAll('.filter').forEach((button) => button.classList.toggle('active', button === filterButton));
      renderRemoteList();
    } else if (account && event.target.closest('#clearSearch')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      $('#searchInput').value = '';
      filter = 'all';
      document.querySelectorAll('.filter').forEach((button) => button.classList.toggle('active', button.dataset.filter === 'all'));
      renderRemoteList();
    } else if (account && event.target.closest('.chat-item[data-remote-id]')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      openRemoteChat(event.target.closest('.chat-item').dataset.remoteId);
    }
  }, true);
  document.addEventListener('submit', (event) => {
    if (!account) return;
    if (event.target.id === 'messageForm') {
      event.preventDefault();
      event.stopImmediatePropagation();
      const text = $('#messageInput').value.trim();
      if (!text || !activeRemoteId) return;
      client.from('messages').insert({ conversation_id: activeRemoteId, sender_id: account.id, body: text })
        .then((result) => {
          if (result.error) toast(result.error.message);
          else $('#messageInput').value = '';
        });
    } else if (event.target.id === 'newChatForm') {
      event.preventDefault();
      event.stopImmediatePropagation();
      createRemoteChat(event.target).catch((error) => toast(error.message));
    }
  }, true);
  $('#authForm').addEventListener('submit', (event) => event.preventDefault());
  document.addEventListener('change', (event) => {
    if (event.target.id === 'groupCheck') {
      ensureParticipantField();
      if (participantField) participantField.hidden = !event.target.checked;
    }
  });

  client.auth.getSession().then(({ data, error }) => {
    if (error) status(error.message);
    if (data?.session?.user) signedIn(data.session.user).catch((failure) => status(failure.message));
  });
  client.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN' && session?.user && account?.id !== session.user.id) {
      setTimeout(() => signedIn(session.user).catch((error) => status(error.message)), 0);
    } else if (event === 'SIGNED_OUT' && account) {
      account = null;
      remoteChats = [];
      activeRemoteId = null;
      renderRemoteList();
    }
  });
  ensureParticipantField();
  if (participantField) participantField.hidden = true;
})();
