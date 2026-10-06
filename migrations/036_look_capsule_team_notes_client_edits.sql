-- 036: team notes for looks and capsules; the client edits a look's description and categories;
-- look categories writable only by the team, her stylist, or her (ADR-0166, 2026-10-06).
--
-- Karl, 2026-10-06: "I want team notes for looks and capsules too. only visible to team members."
-- "I want the client to be able to edit the description of the collection item or look." "I want
-- the client to be able to change the category(s) of a look."
--
-- Measured before writing this:
--   - gp_looks.notes_internal ("Internal Notes" in Save Look) is on 5 looks (Cynthia Lippe 4,
--     Kristen Seeger 1). A query signed as Cynthia Lippe's client login read all 4 of hers: the
--     gp_looks SELECT policy lets a client read every column of her own looks. Capsules (gp_boards)
--     have no team note at all; the unused `capsules` table has 0 rows.
--   - look_categories and look_category_assignments had one write policy each, `true` for every
--     signed-in account: any client could add or remove categories on ANY client's looks, or
--     rename any client's categories, straight through the database API.
--
-- PART 1 (applied first, before either app ships): the table, the note copy, the provenance
-- columns, and the write policies. PART 2 (applied after both apps read and write team_notes):
-- re-copy, then a trigger that moves any note written the old way and empties the old column.

-- 1. ONE TEAM-ONLY TABLE FOR LOOKS AND CAPSULES. Same rule as closet_item_team_notes (ADR-0165):
--    only team accounts (is_team_member: admin, stylist, sales; finance excluded) and a scoped
--    stylist for her assigned clients. A client's login reads nothing.
create table if not exists public.team_notes (
  kind       text not null check (kind in ('look', 'capsule')),
  target_id  text not null,             -- gp_looks.id / gp_boards.id (no FK: the move trigger runs BEFORE insert)
  client_id  text not null,
  note       text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  primary key (kind, target_id)
);
create index if not exists team_notes_client_idx on public.team_notes (client_id, kind);

alter table public.team_notes enable row level security;
drop policy if exists team_notes_team on public.team_notes;
create policy team_notes_team on public.team_notes
  for all to authenticated
  using (public.is_team_member() or client_id in (select public.my_assigned_client_ids()))
  with check (public.is_team_member() or client_id in (select public.my_assigned_client_ids()));

-- ADR-0159: a new public table hands anon every privilege by default. Revoke, then grant only
-- what the policy narrows.
revoke all on public.team_notes from anon, authenticated;
grant select, insert, update, delete on public.team_notes to authenticated;

insert into public.team_notes (kind, target_id, client_id, note, updated_at, updated_by)
select 'look', id, client_id, trim(notes_internal), now(), null
  from public.gp_looks
 where nullif(trim(notes_internal), '') is not null
on conflict (kind, target_id) do nothing;

-- 2. WHO LAST CHANGED A LOOK'S DESCRIPTION OR CATEGORIES. The same provenance pieces carry
--    (gp_closet_items.client_edited_fields / client_edited_at): the builder marks what she changed
--    so a stylist sees it before changing it back.
alter table public.gp_looks add column if not exists client_edited_fields text[];
alter table public.gp_looks add column if not exists client_edited_at timestamptz;

-- 3. LOOK CATEGORIES: WHO MAY WRITE.
--    Her category LIST (look_categories): the team or her stylist. Never the client: stylists own
--    her list (Karl, 2026-10-06: she picks from hers, she does not create).
--    Which categories a LOOK is in (look_category_assignments): the team, her stylist, or the
--    client herself, only for her own look AND her own category, and never a home (a home is
--    where her pieces live, ADR-0111; filing a look there is the stylist's call).
--    Reads are unchanged (lc_read / la_read).
drop policy if exists lc_write on public.look_categories;
drop policy if exists lc_ins on public.look_categories;
drop policy if exists lc_upd on public.look_categories;
drop policy if exists lc_del on public.look_categories;
create policy lc_ins on public.look_categories for insert to authenticated
  with check ((select public.is_full_staff()) or client_id in (select public.my_assigned_client_ids()));
create policy lc_upd on public.look_categories for update to authenticated
  using ((select public.is_full_staff()) or client_id in (select public.my_assigned_client_ids()))
  with check ((select public.is_full_staff()) or client_id in (select public.my_assigned_client_ids()));
create policy lc_del on public.look_categories for delete to authenticated
  using ((select public.is_full_staff()) or client_id in (select public.my_assigned_client_ids()));

create or replace function public.can_file_look(p_look_id text, p_category_id uuid)
returns boolean language sql stable security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.look_categories c
     where c.id = p_category_id
       and (
         public.is_full_staff()
         or c.client_id in (select public.my_assigned_client_ids())
         or (
           c.client_id = public.jwt_client_id()
           and coalesce(c.is_residence, false) = false
           and exists (select 1 from public.gp_looks l where l.id = p_look_id and l.client_id = c.client_id)
         )
       )
  );
$$;
revoke all on function public.can_file_look(text, uuid) from anon;

drop policy if exists la_write on public.look_category_assignments;
drop policy if exists la_ins on public.look_category_assignments;
drop policy if exists la_upd on public.look_category_assignments;
drop policy if exists la_del on public.look_category_assignments;
create policy la_ins on public.look_category_assignments for insert to authenticated
  with check (public.can_file_look(look_id, category_id));
create policy la_upd on public.look_category_assignments for update to authenticated
  using (public.can_file_look(look_id, category_id))
  with check (public.can_file_look(look_id, category_id));
create policy la_del on public.look_category_assignments for delete to authenticated
  using (public.can_file_look(look_id, category_id));

notify pgrst, 'reload schema';

-- ── PART 2 (applied after both apps read and write team_notes) ─────────────────────────────────
-- 1. Re-copy anything written the old way since Part 1, without overwriting a note saved through
--    the new code (updated_by set).
insert into public.team_notes (kind, target_id, client_id, note, updated_at, updated_by)
select 'look', id, client_id, trim(notes_internal), now(), null
  from public.gp_looks
 where nullif(trim(notes_internal), '') is not null
on conflict (kind, target_id) do update
   set note = excluded.note, updated_at = now()
 where public.team_notes.updated_by is null
   and public.team_notes.note is distinct from excluded.note;

-- 2. A note can never rest on the look row again. A write that carries one (an old open builder
--    tab, through the `looks` view or gp_looks) is moved into team_notes when the writer is team,
--    her stylist, or the server itself; a client's own token writing it gets it dropped.
create or replace function public.move_look_team_note()
returns trigger language plpgsql security definer
set search_path to 'public'
as $$
declare v text;
begin
  v := nullif(trim(coalesce(new.notes_internal, '')), '');
  if v is not null and (auth.uid() is null
                        or public.is_team_member()
                        or new.client_id in (select public.my_assigned_client_ids())) then
    insert into public.team_notes (kind, target_id, client_id, note, updated_at, updated_by)
    values ('look', new.id, new.client_id, v, now(), auth.uid())
    on conflict (kind, target_id) do update
       set note = excluded.note, updated_at = now(), updated_by = excluded.updated_by;
  end if;
  new.notes_internal := null;
  return new;
end;
$$;
revoke all on function public.move_look_team_note() from anon, authenticated;

drop trigger if exists gp_looks_move_team_note on public.gp_looks;
create trigger gp_looks_move_team_note
  before insert or update of notes_internal on public.gp_looks
  for each row execute function public.move_look_team_note();

-- 3. Empty the old column. Every note is already in team_notes (step 1).
update public.gp_looks set notes_internal = null where notes_internal is not null;

notify pgrst, 'reload schema';
