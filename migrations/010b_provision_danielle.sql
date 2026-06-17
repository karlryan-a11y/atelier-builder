-- 010b_provision_danielle.sql  (LIVE) — run AFTER 010_chat.sql.
-- Creates Danielle York's chat conversation so the bubble activates for her.
-- slack_channel_id is left NULL for now; set it in Phase 2 once Cowork has made
-- her #danielle-york channel and reported its C… id.

insert into chat_conversations (client_id, microsite)
values ('6a15ae19c06d454288c08009', 'tfykgutf')
on conflict (client_id) do nothing;

-- (Phase 2, after Cowork) wire her Slack channel:
--   update chat_conversations
--   set slack_channel_id = 'C0XXXXXXX'
--   where client_id = '6a15ae19c06d454288c08009';

-- Optional Phase-1 smoke test — insert a stylist message via the SQL editor
-- (service role bypasses RLS) to confirm inbound messages render in her thread:
--   insert into chat_messages (conversation_id, sender_type, sender_name, body)
--   select id, 'stylist', 'Julia', 'Hi Danielle! Excited to start styling with you 🤍'
--   from chat_conversations where client_id = '6a15ae19c06d454288c08009';
