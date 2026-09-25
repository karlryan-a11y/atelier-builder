-- 029. A LOOK THE CLIENT HAS NOT TRIED ON YET. ADR-0153.
--
-- Maegan Watson, 2026-09-23: "we need a more sophisticated solution for 'to be tried' looks. We
-- need the ability to create a look and mark it as 'to be tried' to indicate that we freestyled it
-- and the client needs to try it with us or by themselves."
--
-- The team has already invented this twice without us. Measured 2026-09-24: 478 live looks carry
-- "to be tried" IN THEIR NAME across 34 clients, and 12 clients have a hand-made category called
-- "To Be Tried" holding 156 looks. Two workarounds for one missing flag.
--
-- A TIMESTAMP, NOT A BOOLEAN, for two reasons that both turned out to matter:
--   1. the stylist's queue sorts oldest-first, so the look that has been waiting three weeks is
--      the one she chases;
--   2. "marked on the 3rd" is a fact we can show her; "true" is not.
--
-- WHO CLEARS IT. The stylist, never the client (Karl, 2026-09-24). The client's only job is to
-- reply. That is the same ownership split the whole product runs on: the stylist decides what
-- exists and what state it is in, the client reacts to it. It is also why there is no "not for me"
-- button -- Karl, same conversation: "I don't want not for me. just feedback box for them to
-- reply to."
--
-- HER REPLY IS NOT STORED HERE. It goes into the chat thread she and her stylist already share,
-- which already posts to the per-client Slack channel and already sends a push (api/chat/send.ts).
-- A separate `comments` table exists in this database with parent_type/parent_id and even
-- pin_x/pin_y for pinning a note to a spot on the image. It has ZERO rows, no UI, no notification
-- and no Slack bridge. Using it would mean building all of that; the chat is already there.
--
--   supabase db query --linked -f migrations/029_look_to_try.sql   (from ~/Downloads/wsg-dashboard)

ALTER TABLE gp_looks ADD COLUMN IF NOT EXISTS to_try_at timestamptz;

COMMENT ON COLUMN gp_looks.to_try_at IS
  'Set when a stylist marks a look as one the client has not tried on yet (ADR-0153). A timestamp '
  'not a boolean, so the queue can be ordered oldest-first and we can see how long a look has been '
  'waiting. Cleared by the STYLIST when it has been handled; the client never clears it, she only '
  'replies.';
