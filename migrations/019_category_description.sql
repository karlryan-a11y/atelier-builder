-- 019_category_description.sql  (ADR-0110)
--
-- A stylist note on each look category.
--
-- Amaia asked for it: "if 'summit club' is a category for Mr. C and we know that each of
-- these looks will always require a sports jacket... it would be helpful if on the backend
-- there was a place to write these short descriptions so that we are able to see it when
-- styling." Today that rule lives in one stylist's head, so a second stylist covering her
-- client cannot know it, and neither can the compose pipeline.
--
-- ADDITIVE ONLY, per HARD-RULES: nullable, no default, no rename, no drop, RLS untouched.
-- Every existing read of this table names its columns explicitly (5 sites in
-- atelier-builder, 2 in atelier-looks, 2 in wsg-dashboard scripts), so nothing sees this
-- column until code is deployed that asks for it. Verified before writing this file.
--
-- ORDER MATTERS: this runs against live BEFORE the builder that selects `description` is
-- deployed. Code selecting a column the database lacks is a PostgREST 42703 and an empty
-- Categorize rail for every stylist. That is the 2026-06-24 outage. npm run guard blocks
-- the deploy if this has not been applied.
--
-- NOT DONE HERE, deliberately: tightening the anon grant. RLS on this table is open by
-- design (ADR-0006, the lookbook needs it), so anon can read all 803 rows and will be able
-- to read this column too by a crafted ?select=description. Making that untrue means
-- REVOKE SELECT then re-GRANT the named columns, which is a change to a live CLIENT read
-- path and wants its own verification pass. The client lookbook never selects this column,
-- so nothing renders it. Tracked as an open item.

ALTER TABLE look_categories ADD COLUMN IF NOT EXISTS description text;

COMMENT ON COLUMN look_categories.description IS
  'Stylist-only note on how to style this category (e.g. "always a sports jacket, never jeans"). Not rendered on the client lookbook.';

INSERT INTO schema_migrations (version, source, verified, note) VALUES
 ('019_category_description', 'atelier-builder/migrations',
  exists(select 1 from information_schema.columns
         where table_name='look_categories' and column_name='description'),
  'sig: look_categories.description — ADR-0110, Amaia category notes')
ON CONFLICT (version) DO UPDATE
  SET verified = excluded.verified, applied_at = now(), note = excluded.note;
