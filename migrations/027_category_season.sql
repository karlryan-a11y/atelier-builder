-- 027_category_season.sql  (ADR-0147)
--
-- A season is a tag a stylist sets, not a word the code guesses from a slug.
--
-- Cynthia Dada, 2026-09-23: "I changed Janet's categories so she can select Spring/Summer or
-- Fall/Winter and then one of her other categories but it only allows you to click on one
-- category on the client facing site." Maegan Watson, on video the same day: the seasons should
-- sit at the top under Looks as a toggle, the category list underneath, and the season we are in
-- should come first. Karl, deciding the shape: it is a TAG, not a date. Nothing about this
-- consults the calendar.
--
-- WHY A COLUMN AND NOT A BETTER GUESS. The lookbook decides "is this category a season" by testing
-- the slug against a hardcoded list: `springsummer` matches, `spring-summer` does not. Measured
-- against live, 2026-09-23, over all 823 look_categories:
--
--     133 categories ARE a season word           -> work today, on 75 clients
--      91 categories CONTAIN a season word       -> silently do nothing, on 34 more clients
--     599 not seasonal
--
-- Ashley Petras, Cassidy Arthur, Brittany Thiele and Carey Carpenter all spell theirs
-- `spring-summer` / `fall-winter` and get no season buttons at all, with no error to say why. A
-- longer list of spellings would buy a few more and fail again on the next stylist's phrasing.
-- The flag ends the guessing: however she writes it, she ticks what it is.
--
-- This is deliberately the same shape as `is_residence` (ADR-0111, migration 020): a home stopped
-- being a list of place names in the code when a stylist could tick a box. Same problem, same
-- answer, and the same control she already knows in Categorize.
--
-- ADDITIVE ONLY, per HARD-RULES: new nullable column, no rename, no drop, RLS untouched. NULL
-- means "not a season", which is what 599 of the 823 rows are.
--
-- ORDER MATTERS: this runs against live BEFORE any code that selects `season` is deployed. Code
-- selecting a column the database lacks is a PostgREST 42703 and an empty Categorize rail for
-- every stylist -- the 2026-06-24 outage.

ALTER TABLE look_categories
  ADD COLUMN IF NOT EXISTS season text;

ALTER TABLE look_categories
  DROP CONSTRAINT IF EXISTS look_categories_season_check;

ALTER TABLE look_categories
  ADD CONSTRAINT look_categories_season_check
  CHECK (season IS NULL OR season IN ('ss', 'fw'));

COMMENT ON COLUMN look_categories.season IS
  'Which season this category is, set by a stylist in Categorize (ADR-0147). ''ss'' = Spring/Summer, ''fw'' = Fall/Winter, NULL = not a season. Never inferred from the slug: 91 of 823 categories spell a season in a way the old slug list missed, silently, on 34 clients.';

-- BACKFILL = WHAT THE SLUG LIST ALREADY DID, PLUS THE ONES IT OBVIOUSLY MEANT.
--
-- Two passes, deliberately separated so the second is reviewable on its own:
--
--   PASS 1 preserves today's behaviour exactly. These are the slugs the lookbook's own
--   seasonSlugs map already matched, so the day after this runs those 75 clients behave as they
--   did the day before.
--
--   PASS 2 catches the ones the list missed and nobody would argue about: the season word as a
--   whole word inside the slug. `spring-summer`, `fall-winter`, `ss-2026-work`,
--   `fall-winter-elevated-casual`. It is still a stylist's to correct, and the Categorize control
--   is how she corrects it. A category that is ambiguous is left NULL rather than guessed.
--
-- Nothing here decides which season is CURRENT. That is a tag too, and a stylist sets it.

-- pass 1: the exact list the code used
UPDATE look_categories SET season = 'ss'
 WHERE season IS NULL
   AND slug IN ('spring','summer','ss','ss24','ss25','ss26','ss27','springsummer','spring-casual','warm-weather');

UPDATE look_categories SET season = 'fw'
 WHERE season IS NULL
   AND slug IN ('fall','winter','fw','fw24','fw25','fw26','fw27','fallwinter','cool-weather');

-- pass 2: the season word as a whole word anywhere in the slug, which the list missed
UPDATE look_categories SET season = 'ss'
 WHERE season IS NULL
   AND slug ~ '(^|-)(ss|spring|summer)([0-9]{0,4})($|-)';

UPDATE look_categories SET season = 'fw'
 WHERE season IS NULL
   AND slug ~ '(^|-)(fw|fall|winter|autumn)([0-9]{0,4})($|-)';

INSERT INTO schema_migrations (version, source, verified, note) VALUES
 ('027_category_season', 'atelier-builder/migrations',
  exists(select 1 from information_schema.columns
         where table_name='look_categories' and column_name='season'),
  'sig: look_categories.season -- ADR-0147, a season is a tag a stylist sets')
ON CONFLICT (version) DO UPDATE
  SET verified = excluded.verified, applied_at = now(), note = excluded.note;
