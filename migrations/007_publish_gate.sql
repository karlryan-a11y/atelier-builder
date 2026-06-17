-- 007_publish_gate.sql
-- Publish gate for the client lookbook.
--
-- Model: new looks/capsules default to DRAFT (hidden from the client). Stylists
-- publish them from the Categorize screen ("Add to client lookbook"). The client
-- lookbook will be changed to render published-only.
--
-- gp_looks / gp_boards are the BASE tables the lookbook reads. `looks` is a view
-- over gp_looks, so we do NOT need to touch it: a builder-saved look inserts
-- without `published`, so it falls to the DEFAULT (false = draft) automatically —
-- exactly the behavior we want. The weekly GoodPix sync's new rows likewise
-- default to draft with no change to the sync.
--
-- Run with:  npx tsx supabase/run-migration.ts migrations/007_publish_gate.sql

-- 1) Columns. published defaults to DRAFT so any NEW row (builder save or weekly
--    GoodPix ingest) lands in the queue with no extra code. category_tags is a
--    real column on boards (clobber-safer than raw; looks already use looks.tags).
alter table gp_looks  add column if not exists published boolean not null default false;
alter table gp_boards add column if not exists published boolean not null default false;
alter table gp_boards add column if not exists category_tags text[] not null default '{}';

-- 2) Backfill: keep EVERY current look/capsule live so no client lookbook goes
--    blank when the published-only filter ships.
update gp_looks  set published = true where published = false;
update gp_boards set published = true where published = false;

-- 3) Pilot: put Danielle York's looks + capsules into the categorization queue
--    (draft) instead, so her stylist categorizes and publishes them.
update gp_looks  set published = false where client_id = '6a15ae19c06d454288c08009';
update gp_boards set published = false where client_id = '6a15ae19c06d454288c08009';

-- Sanity checks (optional — run as SELECTs in the SQL editor):
-- select published, count(*) from gp_looks  group by 1;   -- expect mostly true + Danielle's draft count
-- select published, count(*) from gp_boards group by 1;
