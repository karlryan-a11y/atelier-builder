-- 017_drive_verified.sql
-- The one-time collection verification sweep (see the Danielle SOP): a stylist opens each Google
-- Drive category folder, finds each piece live on Atelier, confirms its brand/color/title/tags are
-- correct, then clicks "Confirm on Google Drive". This records that confirmation so the sweep
-- survives across people/sessions and every category can show "X of Y confirmed". Photos with no
-- live piece are moved to a Drive "Not Found" subfolder and re-digitized (no in-app flag needed).
--
-- Additive + nullable, per ADR-0006. Downstream-owned (scraper never writes these).
--   drive_verified_at : when a stylist confirmed the piece against the Drive folder (NULL = not yet)
--   drive_verified_by : which stylist confirmed it
-- Usage: supabase db query --linked -f migrations/017_drive_verified.sql

alter table public.gp_closet_items add column if not exists drive_verified_at timestamptz;
alter table public.gp_closet_items add column if not exists drive_verified_by text;

comment on column public.gp_closet_items.drive_verified_at is
  'When a stylist confirmed this piece against the Google Drive folder during the verification sweep. NULL = unconfirmed. Scraper never writes this.';
comment on column public.gp_closet_items.drive_verified_by is
  'Email of the stylist who confirmed the piece on Google Drive. Scraper never writes this.';

insert into public.schema_migrations (version, source, applied_at, verified, note)
values ('017', 'atelier-builder', now(), true,
        'drive verification (drive_verified_at/by) on gp_closet_items — the Confirm-on-Google-Drive sweep')
on conflict (version) do nothing;
