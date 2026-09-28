-- 030_client_looks_seasons.sql  (ADR-0154)
--
-- A stylist turns seasons on for ONE client, and only once every look she can see has a season.
--
-- Karl, 2026-09-28: "Can we make it so that the stylist can toggle this on or off for a client?
-- And that way before they toggle it on they have to go through and tag all the looks based on
-- the season." Measured the same day: 5,789 of 14,233 live looks (41%) are in no season, and
-- opening a Looks page on a season would have hidden under half of the looks for 47 of the 101
-- clients who have season categories. A switch nobody can flip early means no client ever opens
-- on a half-filed page.
--
-- OFF IS TODAY. Default false for every client, so the day this runs nothing changes on any
-- client page: the lookbook keeps its existing season buttons until a stylist turns this on.
--
-- ADDITIVE ONLY, per HARD-RULES: one new column with a default, no rename, no drop, RLS
-- untouched. gp_clients is granted to anon and authenticated at TABLE level (checked
-- 2026-09-28: no column-level grants), so the new column is readable by the lookbook with no
-- grant, unlike look_categories (migration 021 / 027).

ALTER TABLE gp_clients
  ADD COLUMN IF NOT EXISTS looks_seasons_on boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN gp_clients.looks_seasons_on IS
  'Seasons on her Looks page (ADR-0154). Set in Categorize by a stylist, only once every published look has a season. false = the Looks page behaves exactly as before seasons were tags.';

NOTIFY pgrst, 'reload schema';

INSERT INTO schema_migrations (version, source, verified, note) VALUES
 ('030_client_looks_seasons', 'atelier-builder/migrations',
  exists(select 1 from information_schema.columns
         where table_name='gp_clients' and column_name='looks_seasons_on')
  and not exists(select 1 from gp_clients where looks_seasons_on),
  'sig: gp_clients.looks_seasons_on, off for everyone -- ADR-0154')
ON CONFLICT (version) DO UPDATE
  SET verified = excluded.verified, applied_at = now(), note = excluded.note;
