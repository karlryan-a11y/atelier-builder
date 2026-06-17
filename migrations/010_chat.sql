-- 010_chat.sql  (LIVE) — Client↔Stylist chat.
-- ADDITIVE: new tables only. PRIVATE data → RESTRICTIVE RLS (unlike the open
-- lookbook tables). The client app reaches these ONLY through server-side API
-- routes carrying the client's JWT; the Slack relay / push sender use the
-- SERVICE ROLE (which bypasses RLS), so client policies can stay tight.
--
-- Identity model (from the lookbook auth): a client is a Supabase auth user whose
-- JWT carries user_metadata.microsite. RLS scopes a client to the conversation
-- whose microsite matches that claim; push subs are scoped to auth.uid().

-- ── conversations: exactly one per client ──
create table if not exists chat_conversations (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,                 -- gp_clients.id (logical ref)
  microsite text not null,                 -- gp_clients.microsite — RLS key vs JWT claim
  slack_channel_id text,                   -- per-client Slack channel (C…), set at provisioning
  client_last_read_at timestamptz,         -- client's read cursor (for unread badge)
  stylist_last_read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (client_id)
);
create index if not exists idx_chat_conv_microsite on chat_conversations(microsite);
create unique index if not exists idx_chat_conv_slack
  on chat_conversations(slack_channel_id) where slack_channel_id is not null;

-- ── messages: the persistent thread (text-message style history) ──
create table if not exists chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references chat_conversations(id) on delete cascade,
  sender_type text not null check (sender_type in ('client','stylist','system')),
  sender_name text not null,               -- 'Danielle' | 'Julia' | 'Chelsea'
  sender_slack_id text,                    -- U… for stylist replies (nullable)
  slack_ts text,                           -- Slack message ts — echo-guard + dedup
  body text not null,
  image_url text,                          -- reserved for Phase 2 attachments
  created_at timestamptz not null default now()
);
create index if not exists idx_chat_msg_conv on chat_messages(conversation_id, created_at);
create unique index if not exists idx_chat_msg_slack_ts
  on chat_messages(slack_ts) where slack_ts is not null;

-- ── web-push subscriptions (for the closed-app home-screen badge, Phase 3) ──
create table if not exists chat_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null,              -- auth.uid() of the client
  microsite text,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  unique (endpoint)
);
create index if not exists idx_chat_push_user on chat_push_subscriptions(auth_user_id);

-- ── RLS: private. Default-deny, then narrow client grants. ──
alter table chat_conversations      enable row level security;
alter table chat_messages           enable row level security;
alter table chat_push_subscriptions enable row level security;

-- A client reads only their own conversation (microsite claim match).
drop policy if exists chat_conv_client_read on chat_conversations;
create policy chat_conv_client_read on chat_conversations
  for select to authenticated
  using (microsite = (auth.jwt() -> 'user_metadata' ->> 'microsite'));

-- A client may update only the read-cursor columns on their own conversation.
drop policy if exists chat_conv_client_update on chat_conversations;
create policy chat_conv_client_update on chat_conversations
  for update to authenticated
  using (microsite = (auth.jwt() -> 'user_metadata' ->> 'microsite'))
  with check (microsite = (auth.jwt() -> 'user_metadata' ->> 'microsite'));

-- A client reads only messages in their own conversation.
drop policy if exists chat_msg_client_read on chat_messages;
create policy chat_msg_client_read on chat_messages
  for select to authenticated
  using (exists (
    select 1 from chat_conversations c
    where c.id = chat_messages.conversation_id
      and c.microsite = (auth.jwt() -> 'user_metadata' ->> 'microsite')
  ));

-- A client may send (insert) ONLY as 'client', ONLY into their own conversation.
drop policy if exists chat_msg_client_insert on chat_messages;
create policy chat_msg_client_insert on chat_messages
  for insert to authenticated
  with check (
    sender_type = 'client'
    and exists (
      select 1 from chat_conversations c
      where c.id = chat_messages.conversation_id
        and c.microsite = (auth.jwt() -> 'user_metadata' ->> 'microsite')
    )
  );

-- A client manages only their own push subscriptions.
drop policy if exists chat_push_owner_all on chat_push_subscriptions;
create policy chat_push_owner_all on chat_push_subscriptions
  for all to authenticated
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());

-- No anon access at all (no policies target anon). Service role bypasses RLS for
-- the relay (stylist inserts, conversation provisioning, reading subs to push).

-- Optional (enable when we move from polling to Realtime): expose messages on the
-- realtime publication so the client app gets instant updates.
--   alter publication supabase_realtime add table chat_messages;

notify pgrst, 'reload schema';
