-- 015_edit_provenance.sql
-- Client self-serve editing of a piece's Designer / Name / Category (from the lookbook detail
-- sheet). We track WHICH fields the client set so the stylist gets a heads-up before overwriting
-- them ("Danielle set this designer — change anyway?"), and can tell client edits from ours.
--
-- ONE SOURCE OF TRUTH: these edits write to the same gp_closet_items row the builder reads —
-- there is nothing to "sync", every surface reflects the change on next read. Provenance travels
-- on that same row.
--
-- Additive + nullable, per ADR-0006. Downstream-owned (scraper must never write these), same class
-- as category / name_override (ADR-0025).
--   client_edited_fields : which fields the client currently owns — subset of
--                          {'name','brand','category'}. A stylist override removes that field.
--   client_edited_at     : when the client last edited (drives the badge's date).
-- Usage: supabase db query --linked -f migrations/015_edit_provenance.sql

alter table public.gp_closet_items add column if not exists client_edited_fields text[];
alter table public.gp_closet_items add column if not exists client_edited_at timestamptz;

comment on column public.gp_closet_items.client_edited_fields is
  'Fields the client set via the lookbook (subset of name/brand/category). Stylist override clears the field. Scraper must never write this.';
comment on column public.gp_closet_items.client_edited_at is
  'When the client last edited this piece''s metadata. NULL = never client-edited. Scraper must never write this.';

insert into public.schema_migrations (version, source, applied_at, verified, note)
values ('015', 'atelier-builder', now(), true,
        'client edit provenance on gp_closet_items (client_edited_fields[], client_edited_at) — powers stylist badge + change-anyway heads-up')
on conflict (version) do nothing;
