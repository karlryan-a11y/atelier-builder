-- 045. ATELIER SEES EVERY CLIENT MESSAGE TOO, AND ANSWERS THE TECH ONES. (Maegan, 2026-10-26.)
--
-- A client's Messages still go to her stylist's client channel exactly as before. atelier-looks
-- api/chat/send.ts now also posts a copy to Atelier support, sorted tech or styling
-- (src/lib/supportCopy.ts), and keeps the sort on her message row:
--   support_kind  'tech' | 'styling'. Styling ones are kept so we can see where Atelier could
--                 be better for styling.
--   support_ts    Slack ts of Atelier's copy. A reply in the thread under it is found by this
--                 and relayed into her Messages as Atelier (api/chat/slack-events.ts).
--
-- Additive only: two nullable columns and an index. Older rows stay null. The lookbook's message
-- SELECT lists its columns, so nothing she sees changes.

alter table chat_messages add column if not exists support_kind text
  check (support_kind is null or support_kind in ('tech', 'styling'));
alter table chat_messages add column if not exists support_ts text;

create index if not exists idx_chat_msg_support_ts
  on chat_messages(support_ts) where support_ts is not null;
