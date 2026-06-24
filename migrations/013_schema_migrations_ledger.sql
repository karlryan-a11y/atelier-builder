-- 013_schema_migrations_ledger.sql  (ADR-0037)
-- A ledger so "which migrations are on live?" is knowable, not guessed.
-- The 2026-06-24 outage happened because 006 was not applied to live while the
-- code that needed it was deployed, and there was no way to see that gap.
--
-- From now on: every migration run records itself here (wire the runner to insert
-- a row on success). This file also BACKFILLS a baseline by checking, per known
-- migration, whether its signature object actually exists on live — so `verified`
-- truthfully reflects reality (a false row would just recreate the original bug).

CREATE TABLE IF NOT EXISTS schema_migrations (
  version    text PRIMARY KEY,        -- e.g. '006_closet_categories'
  source     text,                    -- repo/folder the file lives in
  applied_at timestamptz DEFAULT now(),
  verified   boolean,                 -- signature object confirmed present on live
  note       text
);

-- Backfill baseline (idempotent). `verified=false` rows are DRIFT — apply them.
INSERT INTO schema_migrations (version, source, verified, note) VALUES
 ('001_foundation',       'atelier-builder/supabase/migrations', (to_regclass('public.gp_closet_items') is not null), 'sig: table gp_closet_items'),
 ('002_rls_policies',     'atelier-builder/supabase/migrations', exists(select 1 from pg_policies where tablename='gp_looks'), 'sig: any policy on gp_looks'),
 ('004_shopping_workflow','atelier-builder/supabase/migrations', (to_regclass('public.shopping_sessions') is not null), 'sig: table shopping_sessions'),
 ('005_shopping_playbook','atelier-builder/supabase/migrations', (to_regclass('public.shopping_playbook') is not null), 'sig: table shopping_playbook — APPLIED 2026-06-24 (drift fix)'),
 ('006_closet_categories','atelier-builder/migrations', exists(select 1 from information_schema.columns where table_name='gp_closet_items' and column_name='category'), 'sig: gp_closet_items.category — APPLIED 2026-06-24 (outage fix)'),
 ('007_publish_gate',     'atelier-builder/migrations', exists(select 1 from information_schema.columns where table_name='gp_looks' and column_name='published'), 'sig: gp_looks.published'),
 ('009_item_overrides',   'atelier-builder/migrations', exists(select 1 from information_schema.columns where table_name='gp_closet_items' and column_name='name_override'), 'sig: gp_closet_items.name_override'),
 ('010_chat',             'atelier-builder/migrations', (to_regclass('public.chat_conversations') is not null), 'sig: table chat_conversations'),
 ('intake_rejection_reasons_id', 'atelier-builder (drift fix)', exists(select 1 from information_schema.columns where table_name='intake_rejection_reasons' and column_name='id'), 'sig: intake_rejection_reasons.id — APPLIED 2026-06-24 (drift fix)')
ON CONFLICT (version) DO UPDATE SET verified = EXCLUDED.verified, note = EXCLUDED.note;
