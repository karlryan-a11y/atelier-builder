-- 028. A PIECE GETS A DESCRIPTION THE CLIENT CAN READ, AND SEARCH CAN FIND. ADR-0151.
--
-- Maegan Watson, 2026-09-24: "Also under item details there's no spot to put a 'description' of
-- the items ... we have to be able to search houndstooth and the dress shows up ... having a
-- description or note section is something we needed from the beginning." Asked whether it was
-- for the team or the client, she answered "Both".
--
-- So there are two fields, not one, and they already half exist:
--
--   style_note   THE INTERNAL ONE. Shipped long ago, labelled "Team only, never shown to the
--                client", and read by NOTHING - not one of the five piece searches in the three
--                apps looks at it. Empty on all 1,077 of Peyton Wheeler's pieces, which is what
--                a field nobody can find anything with looks like. Kept as it is, and now
--                searched by the STYLIST's surfaces only.
--
--   description  THIS ONE. Client-visible: it shows on her piece sheet and it is searched by her
--                Collection search as well as by the team's.
--
-- WHY THE SPLIT MATTERS AND IS NOT FUSSINESS. If one box served both, a stylist writing "she
-- hates the neckline, keep it for resale" would have that piece surface when the CLIENT types
-- "hates". The rule this column exists to make possible: a client can only search text a client
-- can see. The stylist searches both.
--
-- Additive and nullable: every existing row keeps working, and nothing reads it until the code
-- that writes it ships. `text`, not a fixed length, because "houndstooth wool, three-quarter
-- sleeve, hits mid-calf" and "navy" are both real answers.
--
--   supabase db query --linked -f migrations/028_piece_description.sql   (from ~/Downloads/wsg-dashboard)

ALTER TABLE gp_closet_items ADD COLUMN IF NOT EXISTS description text;

COMMENT ON COLUMN gp_closet_items.description IS
  'Client-visible description of the garment (fabric, pattern, cut, length). Shown on her piece '
  'sheet and searched by both the client and the team. The TEAM-ONLY note is style_note, which '
  'the client can neither see nor search. ADR-0151.';
