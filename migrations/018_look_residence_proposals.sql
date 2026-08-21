-- 018_look_residence_proposals.sql
-- Residence review queue for multi-residence clients (ADR-0070 taxonomy).
--
-- A client with several homes wants her Looks and Collection scoped by residence
-- (NYC / Aspen / The Hamptons — rows in `look_categories`). Filing a back-catalog
-- of GoodPix-era looks by hand is the slow part, so an offline vision pass reads
-- each look's composed image and PROPOSES a residence with a short reason. The
-- stylist then confirms or corrects in Categorize; nothing here is client-facing
-- and nothing here assigns anything on its own.
--
-- This table is the proposal only. The ACCEPTED answer always lands in
-- `look_category_assignments`, exactly as if the stylist had clicked the chip —
-- so the lookbook, the publish gate and every existing read path are untouched.
--
-- Deliberately NOT stored here: the item-provenance tally (which pieces in a look
-- the stylist has already placed in a residence). That is derived live in the
-- builder from `gp_closet_items.category` + `gp_looks.closet_item_ids`, so it
-- stays true as she refiles pieces instead of going stale in a snapshot.
--
-- Additive + nullable, per ADR-0006. Downstream-owned (the scraper never writes it).
-- Usage: supabase db query --linked -f migrations/018_look_residence_proposals.sql

create table if not exists public.look_residence_proposals (
  look_id        text primary key references public.gp_looks(id) on delete cascade,
  client_id      text not null,
  proposed_slugs text[] not null,          -- look_categories.slug values, e.g. {new-york-city,hamptons}
  confidence     text not null check (confidence in ('high', 'medium', 'low')),
  reason         text,                     -- one clause naming the garments read, shown to the stylist
  source         text not null default 'vision',
  created_at     timestamptz not null default now(),
  resolved_at    timestamptz,              -- set when a stylist accepts or dismisses it
  resolved_by    text
);

create index if not exists look_residence_proposals_client_idx
  on public.look_residence_proposals (client_id)
  where resolved_at is null;

comment on table public.look_residence_proposals is
  'Proposed residence for a look, pending stylist confirmation in Categorize. Advisory only — the accepted answer is written to look_category_assignments. Scraper never writes this.';
comment on column public.look_residence_proposals.confidence is
  'high | medium | low, as judged by the proposing pass. Validated against 40 known-answer looks: high was 18/18 correct, medium 10/19 — so medium always needs a human.';
comment on column public.look_residence_proposals.resolved_at is
  'When a stylist acted on the proposal (accepted or dismissed). NULL = still in her queue.';

-- Staff-only. Follows the ADR-0045 posture: RLS on, is_staff() gate, anon sees nothing.
alter table public.look_residence_proposals enable row level security;

drop policy if exists look_residence_proposals_staff on public.look_residence_proposals;
create policy look_residence_proposals_staff
  on public.look_residence_proposals
  for all
  using (is_staff())
  with check (is_staff());

insert into public.schema_migrations (version, source, applied_at, verified, note)
values ('018', 'atelier-builder', now(), true,
        'look_residence_proposals — stylist review queue for residence filing (multi-residence clients)')
on conflict (version) do nothing;
