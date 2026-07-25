-- 016_delete_provenance.sql
-- An item is hidden from the collection + lookbook by flipping is_deleted=true. Today that happens
-- via exactly two buttons — Archive (CollectionTab) and Remove-duplicate (ReconciliationPanel) — and
-- NOTHING records who did it, when, or why. (Confirmed 2026-07-23: no trigger, no audit table, no
-- pgaudit; is_deleted defaults to false and no digitization path sets it.) So a piece that was hidden
-- by mistake is invisible AND unexplained. These columns give every hide a permanent, queryable record.
--
-- Additive + nullable, per ADR-0006. Downstream-owned (scraper never writes them).
--   deleted_at     : when it was hidden (NULL for currently-visible items and for legacy hides)
--   deleted_by     : the stylist's email who hid it (NULL if unknown / legacy)
--   deleted_reason : 'archive' | 'duplicate' | 'other'
-- Usage: supabase db query --linked -f migrations/016_delete_provenance.sql

alter table public.gp_closet_items add column if not exists deleted_at timestamptz;
alter table public.gp_closet_items add column if not exists deleted_by text;
alter table public.gp_closet_items add column if not exists deleted_reason text;

comment on column public.gp_closet_items.deleted_at is
  'When the item was hidden (is_deleted=true). NULL = visible or a legacy hide with no record. Scraper never writes this.';
comment on column public.gp_closet_items.deleted_by is
  'Email of the stylist who hid the item. NULL = unknown/legacy. Scraper never writes this.';
comment on column public.gp_closet_items.deleted_reason is
  'Why it was hidden: archive | duplicate | other. Scraper never writes this.';

insert into public.schema_migrations (version, source, applied_at, verified, note)
values ('016', 'atelier-builder', now(), true,
        'delete provenance (deleted_at/by/reason) on gp_closet_items — every hide now records who/when/why')
on conflict (version) do nothing;
