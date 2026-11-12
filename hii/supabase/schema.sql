-- Huddle chat schema for Supabase
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'New member' check (char_length(display_name) between 1 and 60),
  avatar_url text,
  created_at timestamptz not null default now()
);
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  name text,
  is_group boolean not null default false,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  check ((is_group and name is not null) or not is_group)
);
create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index if not exists messages_conversation_created_idx on public.messages (conversation_id, created_at desc);
create index if not exists conversation_members_user_idx on public.conversation_members (user_id, conversation_id);

-- SECURITY DEFINER avoids recursive RLS checks while checking membership.
create or replace function public.is_conversation_member(target_conversation uuid, target_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.conversation_members cm where cm.conversation_id = target_conversation and cm.user_id = target_user);
$$;
create or replace function public.is_conversation_creator(target_conversation uuid, target_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.conversations c where c.id = target_conversation and c.created_by = target_user);
$$;
revoke all on function public.is_conversation_member(uuid, uuid) from public;
revoke all on function public.is_conversation_creator(uuid, uuid) from public;
grant execute on function public.is_conversation_member(uuid, uuid) to authenticated;
grant execute on function public.is_conversation_creator(uuid, uuid) to authenticated;

alter table public.profiles enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;

drop policy if exists "Profiles are visible to authenticated members" on public.profiles;
drop policy if exists "Members can update their own profile" on public.profiles;
drop policy if exists "Users can create their own profile" on public.profiles;
drop policy if exists "Members can view their conversations" on public.conversations;
drop policy if exists "Authenticated users can create conversations" on public.conversations;
drop policy if exists "Members can view conversation membership" on public.conversation_members;
drop policy if exists "Users can join conversations they create" on public.conversation_members;
drop policy if exists "Members can read messages" on public.messages;
drop policy if exists "Members can send messages as themselves" on public.messages;

create policy "Authenticated users can view profiles" on public.profiles for select to authenticated using (true);
create policy "Users can create their own profile" on public.profiles for insert to authenticated with check (id = auth.uid());
create policy "Users can update their own profile" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy "Members can view conversations" on public.conversations for select to authenticated using (public.is_conversation_member(id));
create policy "Users can create conversations" on public.conversations for insert to authenticated with check (created_by = auth.uid());
create policy "Members can view conversation membership" on public.conversation_members for select to authenticated using (public.is_conversation_member(conversation_id));
create policy "Creators can add conversation members" on public.conversation_members for insert to authenticated with check (
  public.is_conversation_creator(conversation_id)
);
create policy "Members can read messages" on public.messages for select to authenticated using (public.is_conversation_member(conversation_id));
create policy "Members can send messages as themselves" on public.messages for insert to authenticated with check (sender_id = auth.uid() and public.is_conversation_member(conversation_id));

-- Enable Realtime delivery for messages. Safe to rerun if already in the publication.
do $$ begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null;
end $$;

