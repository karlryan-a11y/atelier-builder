-- 033: a lasting record of what was searched (ADR-0164, 2026-10-06).
--
-- Maegan, Danielle York: "search still wasn't working" and nothing on record said what she typed.
-- The lookbook wrote searches to the Vercel log, which keeps about the last 5,000 lines, a few hours
-- on a working day. This table keeps them. Words, filters and counts only: no piece data.
--
-- Written by the lookbook server under the caller's own session. Nobody reads it from a browser:
-- no SELECT policy, and anon gets nothing. ADR-0159 measured that this database's default
-- privileges hand anon every privilege on a new public table, so they are revoked here explicitly
-- and the grants verified after applying.
create table if not exists public.search_log (
  id         bigserial primary key,
  at         timestamptz not null default now(),
  app        text not null default 'lookbook',
  page       text not null,            -- 'collection' | 'looks'
  microsite  text,
  client_id  text,
  q          text not null,
  cat        text,
  color      text,
  fav        boolean not null default false,
  shown      integer,
  elsewhere  integer,
  staff      boolean not null default false,
  user_id    uuid
);
create index if not exists search_log_at_idx on public.search_log (at desc);
create index if not exists search_log_microsite_idx on public.search_log (microsite, at desc);

alter table public.search_log enable row level security;
drop policy if exists search_log_insert on public.search_log;
create policy search_log_insert on public.search_log for insert to authenticated with check (true);

revoke all on public.search_log from anon, authenticated;
grant insert on public.search_log to authenticated;
revoke all on sequence public.search_log_id_seq from anon, authenticated;
grant usage on sequence public.search_log_id_seq to authenticated;

notify pgrst, 'reload schema';
