-- 035: team notes live in their own table that only team accounts can read (ADR-0165, 2026-10-06).
--
-- A team note ("Too low cut for work!") sat in gp_closet_items.style_note, and a copy in
-- gp_closet_items.raw->'style_note' on 1,357 pieces. RLS lets a signed-in client SELECT every column
-- of her own rows, so no page showed it, but her own token could read it from the database API.
-- Karl, 2026-10-06: "team notes in own table only team accounts can read".
--
-- PART 1 (applied first): the team test, the table, and a copy of every note. Nothing reads it yet.
-- PART 2 (applied after both apps read and write this table): re-copy, then a trigger that moves any
-- note written the old way into this table and empties the old column and raw key.

-- WHO IS TEAM. Stricter than is_full_staff(), which is true for ANY dashboard profile, including the
-- two `finance` accounts (Tentho, an outside firm; ADR-0143). A dashboard role, where one exists,
-- DECIDES: admin, stylist or sales is team; anything else (finance) is not, even if that person also
-- holds a builder role (both finance accounts are builder "stylist" users, measured 2026-10-06). The
-- builder role counts only for someone with no dashboard profile at all. A stylist_scoped account sees
-- only her assigned clients, through the policy below, never through this function.
create or replace function public.is_team_member()
returns boolean language sql stable security definer
set search_path to 'public', 'dashboard'
as $$
  select case
    when exists (select 1 from dashboard.profiles p where p.id = auth.uid())
      then exists (
        select 1 from dashboard.profiles p
         where p.id = auth.uid() and lower(coalesce(p.role, '')) in ('admin', 'stylist', 'sales')
      )
    else exists (
      select 1 from public.users u
       where u.email = (auth.jwt() ->> 'email') and coalesce(u.role, '') in ('admin', 'stylist')
    )
  end;
$$;
revoke all on function public.is_team_member() from anon;

create table if not exists public.closet_item_team_notes (
  item_id    text primary key,          -- gp_closet_items.id (no FK: the move trigger runs BEFORE insert)
  client_id  text not null,
  note       text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
create index if not exists closet_item_team_notes_client_idx on public.closet_item_team_notes (client_id);

alter table public.closet_item_team_notes enable row level security;
drop policy if exists team_notes_team on public.closet_item_team_notes;
create policy team_notes_team on public.closet_item_team_notes
  for all to authenticated
  using (public.is_team_member() or client_id in (select public.my_assigned_client_ids()))
  with check (public.is_team_member() or client_id in (select public.my_assigned_client_ids()));

-- ADR-0159: this database hands anon every privilege on a new public table by default. Revoke, then
-- grant only what the policy above narrows.
revoke all on public.closet_item_team_notes from anon, authenticated;
grant select, insert, update, delete on public.closet_item_team_notes to authenticated;

-- Copy every note: the column first, then raw-only copies.
insert into public.closet_item_team_notes (item_id, client_id, note, updated_at, updated_by)
select id, client_id, trim(style_note), now(), null
  from public.gp_closet_items
 where nullif(trim(style_note), '') is not null
on conflict (item_id) do nothing;
insert into public.closet_item_team_notes (item_id, client_id, note, updated_at, updated_by)
select id, client_id, trim(raw ->> 'style_note'), now(), null
  from public.gp_closet_items
 where nullif(trim(style_note), '') is null
   and jsonb_typeof(raw) = 'object'
   and nullif(trim(raw ->> 'style_note'), '') is not null
on conflict (item_id) do nothing;

notify pgrst, 'reload schema';

-- ── PART 2 (applied 2026-10-06, after both apps read and write closet_item_team_notes) ──────────
-- 1. Re-copy anything written the old way since Part 1 (a note edited by a tab still running the old
--    code), without overwriting a note already saved through the new code (updated_by set).
insert into public.closet_item_team_notes (item_id, client_id, note, updated_at, updated_by)
select id, client_id, trim(style_note), now(), null
  from public.gp_closet_items
 where nullif(trim(style_note), '') is not null
on conflict (item_id) do update
   set note = excluded.note, updated_at = now()
 where public.closet_item_team_notes.updated_by is null
   and public.closet_item_team_notes.note is distinct from excluded.note;

-- 2. From now on a note can never rest on the piece row. Any write that carries one (an old open
--    builder tab, an import) is moved into the team table, but only when the writer is team, a
--    stylist for that client, or the server itself (no auth.uid(): service role, SQL). A client's
--    own token writing style_note gets it dropped, never stored as a "team note". Fires only when
--    style_note or raw is in the write, so ordinary edits are untouched.
create or replace function public.move_team_note()
returns trigger language plpgsql security definer
set search_path to 'public'
as $$
declare v text;
begin
  v := nullif(trim(coalesce(
         nullif(trim(new.style_note), ''),
         case when jsonb_typeof(new.raw) = 'object' then new.raw ->> 'style_note' end,
         '')), '');
  if v is not null and (auth.uid() is null
                        or public.is_team_member()
                        or new.client_id in (select public.my_assigned_client_ids())) then
    insert into public.closet_item_team_notes (item_id, client_id, note, updated_at, updated_by)
    values (new.id, new.client_id, v, now(), auth.uid())
    on conflict (item_id) do update
       set note = excluded.note, updated_at = now(), updated_by = excluded.updated_by;
  end if;
  new.style_note := null;
  if jsonb_typeof(new.raw) = 'object' and new.raw ? 'style_note' then
    new.raw := new.raw - 'style_note';
  end if;
  return new;
end;
$$;
revoke all on function public.move_team_note() from anon, authenticated;

drop trigger if exists gp_closet_items_move_team_note on public.gp_closet_items;
create trigger gp_closet_items_move_team_note
  before insert or update of style_note, raw on public.gp_closet_items
  for each row execute function public.move_team_note();

-- 3. Empty the old column and raw key. Every note is already in the team table (step 1). No trigger
--    on this table bumps last_modified, so no Collection reorders.
update public.gp_closet_items
   set style_note = null,
       raw = case when jsonb_typeof(raw) = 'object' then raw - 'style_note' else raw end
 where style_note is not null
    or (jsonb_typeof(raw) = 'object' and raw ? 'style_note');

notify pgrst, 'reload schema';
