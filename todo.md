## TODO

Below is a “do‑this‑exactly” recipe that starts from **your current repo layout** and arrives at
• Supabase project (auth + Stripe + DB)  
• Chats/messages stored server‑side  
• Month‑grouped chat list  
• Edit / Commit / token count etc.  

The guide assumes the paths you showed:

```
konzuko-code/
  CHANGELOG.md
  dist/
  index.html
  node_modules/
  openai-api-gen.md
  package.json
  package-lock.json
  src/               ← Preact code lives here
  tsconfig.node.json
  vite.config.js
```

Everything happens inside this folder – we just add a new `supabase/` directory and a few more files.

────────────────────────────────────────
1.  SUPABASE SETUP  (creates supabase/)
────────────────────────────────────────
```bash
npm i -g supabase             # if you don’t have it
cd konzuko-code
npx supabase init
supabase start                # local dev stack; leave running in a tab
```
A `supabase/` folder now exists.  

Inside a new terminal, create DB schema & RLS:

```bash
cat > supabase/migrations/0001_chats_messages.sql <<'SQL'
create extension if not exists "pgcrypto";

create table public.chats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade,
  title text not null default 'New Chat',
  code_type text default 'Javascript',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  archived bool default false
);
create index chats_user_idx on chats(user_id, created_at desc);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid references public.chats on delete cascade,
  role text check (role in ('user','assistant','system')) not null,
  content jsonb not null,
  token_count int default 0,
  created_at timestamptz default now(),
  archived bool default false
);
create index messages_chat_idx on messages(chat_id, created_at);

alter table chats    enable row level security;
alter table messages enable row level security;

create policy "chats owner" on chats
  for all using ( auth.uid() = user_id )
  with check ( auth.uid() = user_id );

create policy "messages owner" on messages
  for all using (
    chat_id in (select id from chats where user_id = auth.uid())
  )
  with check (
    chat_id in (select id from chats where user_id = auth.uid())
  );
SQL
supabase db push                # applies migration to local dev db
```

Add storage bucket for images:

```bash
supabase storage create-bucket chat-images --public
```

────────────────────────────────────────
2.  EDGE FUNCTIONS  (tokenizer + Stripe)
────────────────────────────────────────
Token counter (minimal but works):

```bash
supabase functions new tokenize
```
Replace generated `supabase/functions/tokenize/index.ts` with:

```ts
import { serve } from 'https://deno.land/x/sift@0.6.0/mod.ts'
import { encoding_for_model } from "https://esm.sh/tiktoken@1.0.7?bundle"

serve(async req => {
  const { model, text } = await req.json()
  const enc = encoding_for_model(model || "gpt-4o")
  const tokens = enc.encode(text).length
  enc.free()
  return new Response(JSON.stringify({ tokens }), {
    headers: { 'Content-Type': 'application/json' }
  })
})
```

Deploy to local dev:
```bash
supabase functions serve tokenize --no-verify-jwt
```

Stripe subscription starter:
```bash
npx create-supabase-js --template stripe-subscriptions
# Follow its README: set STRIPE_SECRET, PRICE_ID env vars
supabase functions deploy stripe-webhooks
```

────────────────────────────────────────
3.  FRONTEND CHANGES (all inside src/)
────────────────────────────────────────
Install libraries:
```bash
npm i @supabase/supabase-js swr dayjs
```

3‑a.  Create `src/lib/supabase.ts`
```ts
import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL!,
  import.meta.env.VITE_SUPABASE_ANON!
)
```

3‑b.  Auth hook – `src/hooks/useAuth.ts`
```ts
import { useEffect, useState } from 'preact/hooks'
import { supabase } from '../lib/supabase'

export function useAuth() {
  const initial = supabase.auth.getUser().data?.user ?? null
  const [user, setUser] = useState(initial)

  useEffect(() => {
    const { data:sub } = supabase.auth.onAuthStateChange((_e,session) =>
      setUser(session?.user ?? null)
    )
    return () => sub.subscription.unsubscribe()
  },[])
  return user
}
```

3‑c.  AuthGate – `src/components/AuthGate.jsx`
```jsx
import { useAuth } from '../hooks/useAuth'
import useSWR from 'swr'
import { supabase } from '../lib/supabase'
import SignIn from './SignIn.jsx'
import Subscribe from './Subscribe.jsx'

export default function AuthGate({ children }) {
  const user = useAuth()

  const { data: profile } = useSWR(
    user ? 'profile' : null,
    () => supabase.from('profiles')
            .select('subscription_status')
            .eq('id', user.id).single()
            .then(r => r.data)
  )

  if (!user) return <SignIn />
  if (profile?.subscription_status !== 'active') return <Subscribe />
  return children
}
```

3‑d.  Wrap existing App in AuthGate.  
Open `src/main.jsx` and change:

```jsx
import AuthGate from './components/AuthGate.jsx'
render(
  <AuthGate><App /></AuthGate>,
  document.getElementById('app')
)
```

3‑e.  Online chat hook – `src/hooks/useChatsOnline.ts`
```ts
import useSWR from 'swr'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

export function useChatsOnline(activeChatId) {
  const user = useAuth()

  const { data: chats, mutate: mutateChats } = useSWR(
    user ? 'chats' : null,
    () => supabase.from('chats')
          .select('*')
          .order('created_at',{ascending:false})
          .then(r => r.data)
  )

  const { data: messages, mutate: mutateMsgs } = useSWR(
    activeChatId ? ['messages',activeChatId] : null,
    () => supabase.from('messages')
          .select('*')
          .eq('chat_id',activeChatId)
          .order('created_at')
          .then(r => r.data)
  )

  async function sendMessage(chat_id, role, content) {
    const optimistic = { id: crypto.randomUUID(), chat_id, role, content, created_at:new Date().toISOString() }
    mutateMsgs(msgs => [...(msgs||[]), optimistic], false)
    await supabase.from('messages')
          .insert({ chat_id, role, content }, { returning:'minimal' })
    mutateMsgs()
  }

  return { chats, messages, sendMessage, mutateChats }
}
```

Swap your current local‑storage chat hooks with the above in `App.jsx`.  
(Keep token‑estimating helper; just source data from remote list.)

3‑f.  Group chats in `chatpane.jsx`
```jsx
const grouped = useMemo(()=>{
  const sevenAgo = dayjs().subtract(7,'day')
  return (chats||[]).reduce((acc,chat)=>{
    const key = dayjs(chat.created_at).isAfter(sevenAgo)
      ? 'Recent'
      : dayjs(chat.created_at).format('MMM YYYY')
    ;(acc[key]=acc[key]||[]).push(chat)
    return acc
  },{})
},[chats])
```
Add small header element before each group (CSS `.group-heading`).

3‑g.  Image upload helper (put next to existing image handling):
```ts
async function uploadImageToSupabase(file){
  const path = `${crypto.randomUUID()}_${file.name}`
  await supabase.storage.from('chat-images').upload(path, file, { cacheControl:'3600' })
  const { data } = supabase.storage.from('chat-images').getPublicUrl(path)
  return data.publicUrl
}
```
Use that instead of retaining base64 in message `content`.

3‑h.  After sending/getting assistant response, call tokenizer:
```ts
const { data:tok } = await supabase.functions.invoke('tokenize',{
  body:{ model:settings.model, text:assistantText }
})
await supabase.from('messages')
       .update({ token_count: tok.tokens })
       .eq('id', assistantMessageId)
```

────────────────────────────────────────
4.  EDIT / ARCHIVE SQL HELPER
────────────────────────────────────────
Create migration `supabase/migrations/0002_archive_fn.sql`
```sql
create or replace function archive_following(_message_id uuid)
returns void language plpgsql as $$
declare _chat uuid; _ts timestamptz;
begin
  select chat_id, created_at into _chat, _ts
    from messages where id=_message_id;
  update messages set archived=true
    where chat_id=_chat and created_at > _ts;
end $$;
```
Run `supabase db push`.

In your edit handler:  
1 ) `update messages set archived=true where id=<original>`  
2 ) `select rpc('archive_following', { _message_id: <original> })`  
3 ) insert new edited user message.

────────────────────────────────────────
5.  LOCAL→CLOUD CHAT MIGRATION (one‑time)
────────────────────────────────────────
Add button in Settings:

```js
async function migrateLocalChats() {
  const local = JSON.parse(localStorage.getItem('konzuko-chats')||'[]')
  for (const c of local) {
    const { data:chatRow } = await supabase.from('chats')
         .insert({ title:c.title, created_at:c.started })
         .select('id').single()
    const rows = c.messages.map(m=>({
       chat_id: chatRow.id,
       role: m.role,
       content: m.content,
       created_at: m.created_at || new Date().toISOString()
    }))
    await supabase.from('messages').insert(rows,{ returning:'minimal' })
  }
  localStorage.removeItem('konzuko-chats')
  alert('Imported!')
}
```

────────────────────────────────────────
6.  ENV VARS & BUILD
────────────────────────────────────────
Create `.env` (Vite uses `VITE_` prefix):
```dotenv
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON=your-anon-key
VITE_STRIPE_PK=pk_live_xxx
VITE_PRICE_ID=price_123
```

Add to `vite.config.js` if not already:
```js
import { defineConfig, loadEnv } from 'vite'
export default ({ mode }) => {
  process.env = { ...process.env, ...loadEnv(mode, process.cwd()) }
  return {
    /* existing */
  }
}
```

Scripts (package.json):
```json
"scripts": {
  "dev": "vite",
  "build": "vite build",
  "preview": "vite preview",
  "supabase": "supabase start"
}
```

────────────────────────────────────────
7.  DEPLOY
────────────────────────────────────────
1. `npm run build` → static assets in `dist/`  
2. Drag‑drop `dist/` to Netlify or Vercel.  
   Add env vars in dashboard.  
3. In Supabase dashboard → “Project Settings → API” copy keys into Netlify env.  
4. Deploy Supabase functions & Stripe keys in dashboard or via CLI:
```bash
supabase functions deploy tokenize
supabase functions deploy stripe-webhooks
supabase secrets set STRIPE_SECRET=sk_live_xxx PRICE_ID=price_123
```

────────────────────────────────────────
8.  FINAL TEST LIST (should take <30 min)
────────────────────────────────────────
[ ] Sign‑up via magic link  
[ ] Cannot access app until subscription paid  
[ ] New chat stored in `chats` table  
[ ] Messages appear in `messages` table with token counts  
[ ] Edit user message archives correct rows  
[ ] Chat‑pane groups by month after seeding dates  
[ ] Image uploads land in `chat-images` bucket  
[ ] Old local chats import button works  
[ ] Browser refresh restores exact chat history  

────────────────────────────────────────
That completes the step‑by‑step conversion **starting from your current single‑folder repo**.  
Copy‑paste the code blocks where indicated; replace only the files listed; leave all other front‑end components/styles intact.  

Ping back with any file that throws errors and we’ll patch it live.

# DONE 

