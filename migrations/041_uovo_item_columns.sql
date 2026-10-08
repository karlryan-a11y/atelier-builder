-- 041_uovo_item_columns.sql
-- UOVO x Atelier integration (ADR-0173). Per-piece columns that tie an Atelier
-- item to its UOVO identity and current physical whereabouts.
--
-- UOVO-origin pieces still flow through the normal Digitize pipeline, so their
-- `source` stays 'intake_pipeline'; a non-null `uovo_system_id` is what marks a
-- piece as UOVO-backed. We deliberately do NOT widen the source CHECK.
--
-- Additive + nullable, per ADR-0006. Scraper never writes these.
--   uovo_system_id     : UOVO's own internal item id (e.g. "942189"). Stable.
--   uovo_item_number   : the client-facing number UOVO shows as "#35". Stable per client.
--   physical_location  : where the piece currently is — mirror of the latest
--                        dashboard.item_location_events row. One of
--                        home | uovo | cold_storage | at_client | cleaner | suitcase | out.
--   location_updated_at: when physical_location last changed.
-- Usage: supabase db query --linked -f migrations/041_uovo_item_columns.sql

alter table public.gp_closet_items add column if not exists uovo_system_id text;
alter table public.gp_closet_items add column if not exists uovo_item_number text;
alter table public.gp_closet_items add column if not exists physical_location text;
alter table public.gp_closet_items add column if not exists location_updated_at timestamptz;

comment on column public.gp_closet_items.uovo_system_id is
  'UOVO MyCloset internal item id. NULL = not a UOVO-stored piece. Scraper never writes this. (ADR-0173)';
comment on column public.gp_closet_items.uovo_item_number is
  'Client-facing UOVO item number ("#35"). What a delivery request cites to UOVO. Scraper never writes this.';
comment on column public.gp_closet_items.physical_location is
  'Current physical location, mirror of the latest dashboard.item_location_events row: home|uovo|cold_storage|at_client|cleaner|suitcase|out. NULL = unknown.';
comment on column public.gp_closet_items.location_updated_at is
  'When physical_location last changed.';

-- A partial index so "what is at UOVO / out to the cleaner" reads fast per client.
create index if not exists gp_closet_items_physical_location_idx
  on public.gp_closet_items (client_id, physical_location)
  where physical_location is not null;

-- The frozen public.closet_items VIEW is intentionally NOT recreated here: closet
-- reads go straight to gp_closet_items (useClosetItems.ts:58), and the live view's
-- true column list has drifted past migration 009, so recreating it from the repo
-- copy would risk DROPPING columns the live view already serves. If a view
-- consumer needs these, recreate it from the live definition in a follow-up.

insert into public.schema_migrations (version, source, applied_at, verified, note)
values ('041', 'atelier-builder', now(), true,
        'UOVO item columns (uovo_system_id/uovo_item_number/physical_location/location_updated_at) on gp_closet_items — ADR-0173')
on conflict (version) do nothing;
