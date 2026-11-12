# Huddle demo

A lightweight, responsive messaging interface that runs in a browser. It is installable as a web app in supported browsers; an Android Play Store package and native iOS app have not been generated yet.

The site now includes a Progressive Web App manifest, app icons, and a service worker that caches the app shell for offline loading. Authentication and Supabase requests are never cached. The Android Play Store package still needs to be generated and linked to this site with Digital Asset Links.

## Run locally

The demo uses only static files and browser local storage. With Node.js installed, run this in the project folder:

\`\`\`powershell
node -e "const http=require('http'),fs=require('fs'),path=require('path');http.createServer((q,s)=>{const f=path.join(process.cwd(),q.url==='/'?'index.html':decodeURIComponent(q.url.slice(1)));fs.readFile(f,(e,d)=>{if(e){s.writeHead(404);return s.end('Not found')}s.setHeader('Content-Type',f.endsWith('.css')?'text/css':f.endsWith('.js')?'text/javascript':'text/html; charset=utf-8');s.end(d)})}).listen(8000,'127.0.0.1',()=>console.log('Huddle demo running at http://127.0.0.1:8000'))"
\`\`\`

Open <http://127.0.0.1:8000>. Stop the server with Ctrl+C.

## Included

- Responsive chat list and conversation view
- Sample one-to-one and group conversations
- Search and All / Unread / Groups filters
- Create a local chat or group, edit your demo profile, and reset the sample data
- Send text and emoji messages; conversations persist in this browser's local storage

The page loads its fonts and Supabase client from public CDNs when internet access is available. Voice/video, file sharing, push notifications, message edits/deletes, and end-to-end encryption are not included.

## Backend and deployment setup

A Supabase schema is in `supabase/schema.sql` and has been run in the Huddle project. The app uses email/password sign-in, profile display names, conversations, messages, and Realtime updates. Sign in from the profile menu. A one-to-one chat invites one existing member by exact display name; a group accepts comma-separated display names. Everyone must have created a Huddle account first.

`supabase-config.js` points the local app at the Huddle Supabase project and contains its browser-safe publishable key. That key is public by design; access is controlled by row-level security. Never use a `service_role` or secret key in browser code.

`vercel.json` configures this static app for Vercel. Connect the project root to your Vercel account and deploy with no build command and no output directory. Add the production site URL to Supabase Authentication → URL Configuration as the Site URL and an allowed redirect URL. Email confirmation links should use the production site URL.

The Huddle project is deployed to Vercel. Its current public address is `https://hii-rho-lake.vercel.app`.

### Enable Google sign-in

The app includes a **Continue with Google** button. To enable it, create a Web application OAuth client in Google Cloud and configure the Google provider in Supabase:

1. In Google Cloud, set the OAuth audience to External if anyone with a Google account should be able to sign in. Add `https://hii-rho-lake.vercel.app` as an authorized JavaScript origin.
2. In Supabase, open Authentication → Sign In / Providers → Google and copy the callback URL shown there.
3. Add that exact callback URL as an Authorized redirect URI in Google Cloud. Google requires an exact match.
4. Copy the Google Client ID and Client Secret into the Google provider settings in Supabase, then enable the provider. Keep the Client Secret private; never add it to this repository or `supabase-config.js`.
5. In Supabase Authentication → URL Configuration, allow `https://hii-rho-lake.vercel.app` as a redirect URL.

The sign-in button redirects through Supabase Auth and returns users to the current site origin. Supabase uses Google's verified profile name as the Huddle display name when available.
