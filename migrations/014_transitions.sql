-- 014_transitions.sql
-- "Transition out" — a client (or stylist) marks a piece as no longer owned:
-- donated, sold, or discarded. The piece leaves the client's lookbook, and every
-- look styled with it leaves too, landing in a stylist queue for restyling.
--
-- WHY DEDICATED COLUMNS instead of reusing gp_closet_items.is_deleted /
-- gp_looks.archived — two independent reasons, both load-bearing:
--
--   1. THE SCRAPER OVERWRITES BOTH. goodpix-scraper/src/storage.py:132 writes
--      is_deleted and :162 writes archived on every incremental sync, via
--      .upsert(). A sync would silently resurrect transitioned pieces and looks.
--      Nothing here is in the scraper's payload, so a sync cannot touch it.
--      (This also means the EXISTING stylist Archive is not sync-durable. Known,
--      pre-existing, tracked separately — not fixed by this migration.)
--
--   2. is_deleted is already triple-purposed: stylist archive, duplicate removal
--      (ReconciliationPanel), and "draft pending approval" (api/add-closet-item).
--      A fourth meaning would make it unreadable — and a transitioned piece must
--      stay VISIBLE to the stylist tab that exists to display it, which every
--      is_deleted=false filter would prevent.
--
-- Additive + nullable throughout, per ADR-0006. The scraper must never write
-- these columns (same rule as category / name_override — ADR-0025).
-- Usage: supabase db query --linked -f migrations/014_transitions.sql

-- ── Items ─────────────────────────────────────────────────────────────────────
-- transitioned_at IS NULL means "still owned". No enum, no status vocabulary to
-- keep in sync across three apps.
alter table public.gp_closet_items add column if not exists transitioned_at timestamptz;
alter table public.gp_closet_items add column if not exists transition_reason text;  -- donated | sold | discarded | unspecified
alter table public.gp_closet_items add column if not exists transition_source text;  -- client | stylist

create index if not exists idx_gp_closet_items_transitioned
  on public.gp_closet_items (client_id, transitioned_at);

-- ── Looks ─────────────────────────────────────────────────────────────────────
-- A look is pulled from the lookbook when a piece it uses is transitioned out.
-- transitioned_item_ids records WHICH pieces caused it, so restoring one piece
-- only returns the look if no other transitioned piece still holds it back.
-- Without this, restoring one item would wrongly republish looks that are still
-- broken by a second transitioned piece.
alter table public.gp_looks add column if not exists transitioned_at timestamptz;
alter table public.gp_looks add column if not exists transitioned_item_ids text[];

create index if not exists idx_gp_looks_transitioned
  on public.gp_looks (client_id, transitioned_at);

comment on column public.gp_closet_items.transitioned_at is
  'Set when the client or stylist marks the piece as no longer owned. NULL = still owned. Scraper must never write this.';
comment on column public.gp_looks.transitioned_at is
  'Set when the look was pulled from the lookbook because a piece it uses was transitioned out. NULL = live. Scraper must never write this.';

-- ── Ledger (013) ──────────────────────────────────────────────────────────────
insert into public.schema_migrations (version, source, applied_at, verified, note)
values ('014', 'atelier-builder', now(), true,
        'transition-out columns on gp_closet_items + gp_looks; dedicated to survive scraper upserts')
on conflict (version) do nothing;
