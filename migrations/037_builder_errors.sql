-- 037: a lasting record of what broke on a stylist's screen (ADR-0168, 2026-10-07).
--
-- Cynthia Dada, Holly McClellan: the board froze and the look saved with no picture. The real
-- error (SecurityError: the canvas has been tainted) existed only in her browser's console, so it
-- took an hour of rebuilding her steps by hand to see it. The builder now records errors here:
-- what happened, which screen, which client, the message and stack. No piece data, no photos.
--
-- Written from the builder under the stylist's own session. Nobody reads it from a browser: no
-- SELECT policy; the daily check reads it with the service key. anon gets nothing (ADR-0159:
-- this database's default privileges hand anon every privilege on a new table).
create table if not exists public.builder_errors (
  id         bigserial primary key,
  at         timestamptz not null default now(),
  kind       text not null,             -- 'board_photo_unusable' | 'save_failed' | 'window_error' | ...
  message    text,
  stack      text,
  page       text,
  client_id  text,
  context    jsonb,
  user_agent text,
  user_id    uuid default auth.uid()
);
create index if not exists builder_errors_at_idx on public.builder_errors (at desc);

alter table public.builder_errors enable row level security;
drop policy if exists builder_errors_insert on public.builder_errors;
create policy builder_errors_insert on public.builder_errors for insert to authenticated
  with check (user_id is null or user_id = auth.uid());

revoke all on public.builder_errors from anon, authenticated;
grant insert on public.builder_errors to authenticated;
revoke all on sequence public.builder_errors_id_seq from anon, authenticated;
grant usage on sequence public.builder_errors_id_seq to authenticated;

notify pgrst, 'reload schema';
