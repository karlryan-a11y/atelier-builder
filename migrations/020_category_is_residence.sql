-- 020_category_is_residence.sql  (ADR-0111)
--
-- A home is a property of a category, not a list in the code.
--
-- Until now "which categories are homes" lived in a hardcoded array of three slugs
-- (new-york-city / hamptons / aspen), duplicated across atelier-looks/src/lib/residences.ts,
-- atelier-builder/src/lib/residences.ts, scripts/check-residence-allowlist.mjs and
-- tests/residences.test.ts. Adding a home for a client was a code change in two repos and
-- two deploys. Madeline asked for Maegan Watson's three closet locations; Karl asked whether
-- the team could promote Mexico City themselves. They could not. This column is the answer.
--
-- After this, a residence is an ordinary look_categories row with a flag, so the stylist
-- ticks a box in Categorize and the client's homepage changes. Renaming already worked
-- (renameCategory writes `label` and never `slug`); this makes EXISTENCE self-serve too.
--
-- ADDITIVE ONLY, per HARD-RULES: new column, NOT NULL with a false default so every one of
-- the 803 existing rows is unchanged in meaning, no rename, no drop, RLS untouched.
--
-- ORDER MATTERS: this runs against live BEFORE any code that selects `is_residence` is
-- deployed. Code selecting a column the database lacks is a PostgREST 42703 and an empty
-- Categorize rail for every stylist -- the 2026-06-24 outage.

ALTER TABLE look_categories
  ADD COLUMN IF NOT EXISTS is_residence boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN look_categories.is_residence IS
  'True when this category is one of the client''s homes (ADR-0111). Two or more on a client turns on the residence home tiles and the Collection home picker. Set from the Categorize rail; never inferred from the slug.';

-- BACKFILL = EXACT PRESERVATION OF TODAY'S BEHAVIOUR, NOT A NEW DECISION.
-- The old code asked `isResidenceSlug(slug)` with no client context, so these three slugs
-- were residences for WHOEVER held them. Flagging exactly those rows means the day after
-- this deploy every client renders precisely what she rendered the day before.
--
-- Who that is, verified against live before writing this file:
--   Margaux Ellery (xisvfqpu)      aspen, hamptons, new-york-city  -> 3, home tiles ON (as today)
--   Barbie demo    (margaux-ellery) aspen, hamptons, new-york-city -> 3, home tiles ON (as today)
--   Shanna Preve   (2p8qylun)      aspen                           -> 1, BELOW the two-home gate,
--       so no tiles -- exactly as today. Flagging it preserves the other thing the old slug
--       list did for her: planCategoryDeletion REFUSES to delete a residence, and her Aspen
--       category is refused today. Not flagging it would silently make her Aspen deletable.
UPDATE look_categories
   SET is_residence = true
 WHERE slug IN ('new-york-city', 'hamptons', 'aspen');

INSERT INTO schema_migrations (version, source, verified, note) VALUES
 ('020_category_is_residence', 'atelier-builder/migrations',
  exists(select 1 from information_schema.columns
         where table_name='look_categories' and column_name='is_residence'),
  'sig: look_categories.is_residence -- ADR-0111, self-serve homes')
ON CONFLICT (version) DO UPDATE
  SET verified = excluded.verified, applied_at = now(), note = excluded.note;
