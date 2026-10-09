-- 042: the check-in Atelier posts to the team the morning after a client's trip (Maegan 2026-10-08,
-- Karl 2026-10-09: "this goes to the stylist in slack not to the client"). One row per capsule so it
-- is posted once; slack_ts lets the lookbook's Slack bridge keep replies under it team-only.
create table if not exists public.trip_checkins (
  board_id text primary key,
  client_id text not null,
  slack_channel text not null,
  slack_ts text,
  posted_at timestamptz not null default now()
);
create index if not exists trip_checkins_ts on public.trip_checkins (slack_ts);
alter table public.trip_checkins enable row level security;
revoke all on public.trip_checkins from anon, authenticated;
notify pgrst, 'reload schema';
