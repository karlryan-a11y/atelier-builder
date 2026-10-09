-- 041: dates on looks and capsules, and when a client last opened her lookbook (Karl, 2026-10-09).
--
-- Maegan, 2026-10-08: "dates ... displayed in the capsule title, next to the location, so we can
-- easily track when clients are traveling and returning home ... adding the date in one place
-- should accomplish all of this." Karl: dates for packing capsules AND looks; her home page shows
-- the next 5 things coming up; a dated look or capsule leaves the home page once its date passes.
--
-- event_start / event_end are CALENDAR dates (no time, no zone): "Oct 14 to Oct 18". A look for one
-- evening has event_start only. Both optional; nothing reads them until a stylist sets one.
alter table public.gp_looks  add column if not exists event_start date, add column if not exists event_end date;
alter table public.gp_boards add column if not exists event_start date, add column if not exists event_end date;
alter table public.gp_looks  drop constraint if exists gp_looks_event_range;
alter table public.gp_looks  add constraint gp_looks_event_range  check (event_end is null or (event_start is not null and event_end >= event_start));
alter table public.gp_boards drop constraint if exists gp_boards_event_range;
alter table public.gp_boards add constraint gp_boards_event_range check (event_end is null or (event_start is not null and event_end >= event_start));

-- "New from her stylist" = added since her PREVIOUS visit (and in the last 30 days). Two stamps so a
-- refresh does not empty the section: a visit more than 6 hours after the last one moves
-- last_visit_at into prev_visit_at. Written by the lookbook server (service role) only, for the
-- client herself, never for a team member viewing her page. No policies: nobody else reads it.
create table if not exists public.client_home_visits (
  client_id text primary key,
  prev_visit_at timestamptz,
  last_visit_at timestamptz not null default now()
);
alter table public.client_home_visits enable row level security;
revoke all on public.client_home_visits from anon, authenticated;
notify pgrst, 'reload schema';
