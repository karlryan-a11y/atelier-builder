-- 030. HER ANSWER TO A LOOK SHE WAS ASKED TO TRY. ADR-0158.
--
-- ADR-0153 gave the stylist a way to say "try this on" and the client a box to write back in.
-- Maegan Watson, 2026-09-30: "One key detail is that we wanted the client to be able to uncheck
-- the outfit if they try it and it's successful. Is that possible or is there a reason she cannot
-- clear on her own?" There was a reason and it was only half right: the stylist's To try tab is
-- her work queue, and a client emptying it silently would make it untrustworthy. The answer is
-- not to forbid it, it is to make clearing a MESSAGE rather than a deletion.
--
-- Karl, same day: "if they like it, we want them to check it as successful and it should then go
-- in its respective category. if it's unsuccessful they leave a note, the note gets saved in supa
-- and atelier so the stylist can see unsuccessful looks and the notes that go with them."
--
-- "Goes in its respective category" needs no work: the To Try mark is an OVERLAY on the filing a
-- look already has. Measured before building, on Danielle York: 70 of her 73 marked looks are
-- already in at least one category, and 75 of 78 across the whole roster. Clearing the mark IS
-- the look going back to where it lives.
--
-- THREE COLUMNS, ON THE LOOK. Not in the chat alone. The chat carries the alert and scrolls away;
-- these survive, are searchable, and are what the stylist's "Didn't work" tab reads. There is a
-- `comments` table in this database that would also have held them, with zero rows and no UI, no
-- notification and no Slack bridge — Karl asked for a worklist, not an annotation.
--
-- SHE CAN ANSWER, NEVER MARK. Answering takes work OUT of a stylist's queue; marking would put
-- work in. Only the stylist marks. The client route enforces it and check-to-try holds the rule.
--
--   supabase db query --linked -f migrations/030_look_tried.sql   (from ~/Downloads/wsg-dashboard)

ALTER TABLE gp_looks ADD COLUMN IF NOT EXISTS tried_at timestamptz;
ALTER TABLE gp_looks ADD COLUMN IF NOT EXISTS tried_ok boolean;
ALTER TABLE gp_looks ADD COLUMN IF NOT EXISTS tried_note text;

COMMENT ON COLUMN gp_looks.tried_at IS
  'When the CLIENT answered a To Try look (ADR-0158). Null means she has not answered.';
COMMENT ON COLUMN gp_looks.tried_ok IS
  'Her answer: true = it worked, false = it did not. Null until she answers.';
COMMENT ON COLUMN gp_looks.tried_note IS
  'What she said when it did not work. Kept on the look so it survives the Slack scroll.';
