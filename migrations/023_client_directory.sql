-- 023_client_directory.sql
-- A duplicate client is labelled, never merged (ADR-0122).
--
-- Cynthia Dada, 2026-09-15, with a screenshot of the builder's client search:
-- "there are many client duplicates in the closet". Typing "holl" returned nine
-- names. One is a client we style today. "Holly Klus McClellan" is an empty shell
-- (0 pieces, 0 looks) sitting beside Holly McClellan (636 pieces, 302 looks, 22
-- capsules), and nothing on the screen said which was which, so she opened the
-- empty one and the canvas said "no pieces found".
--
-- Measured on all 988 client rows the same day: 75 same-name pairs, 8 with an
-- extra middle name, and a tail of one-letter misspellings (Goughnor/Goughnour,
-- Hidalgo/Hildalgo, Lagan/Logan) that are all empty archived shells.
--
-- Karl: "put a note next to the client profile when there is a duplicate that
-- shows which has the most looks etc and when it was last updated so it's easy to
-- see which one to use." Nothing is merged or deleted here; the pickers just stop
-- hiding the facts that tell the twins apart.
--
-- ONE FUNCTION IS THE CHOKE POINT. Three pickers read it (builder ClientBar,
-- builder Digitize upload, dashboard Client Lookbooks) and all three render
-- `note` and `badge` VERBATIM, so the wording and the matching rule live here and
-- cannot drift between two repos.
--
-- WHO SEES WHAT. The first cut was SECURITY INVOKER so RLS did the scoping, and it
-- took 3,186 ms for a staff login: the gp_* read policies call is_full_staff() once
-- PER ROW, 89,000 closet rows of it. Without RLS the same query was 857 ms, 811 of
-- them reading the whole closet table. So:
--   1. SECURITY DEFINER, with the gp_clients_read policy applied ONCE, up front, in
--      `visible` below: full staff see every client, a stylist_scoped account sees
--      her assigned clients, a client sees her own row. Every count is taken only
--      over visible clients, so no one learns a number RLS would have hidden.
--      If gp_clients_read changes, `visible` must change with it. Checked at
--      creation by counting both under four logins (staff 988/988, stylist_scoped
--      1/1, a client's own microsite 1/1, a stranger 0/0; zero rows in one and not
--      the other). 3,186 ms -> 152 ms for staff.
--   2. Three covering indexes, so the counts read (client_id + a few flags) instead
--      of every row's JSON. 857 ms -> 240 ms.
-- Granted to authenticated only, never anon (ADR-0110: the anon key must not gain a
-- way to list clients).
--
-- WHY NOT gp_clients.updated_at: every row reads May/June 2026, the day the rows
-- were copied into Atelier. "Last updated" here is the latest change to one of her
-- pieces, looks or capsules. 12 Sep 2019 is the GoodPix bulk-import day, so a
-- profile reading "updated Sep 12, 2019" has never been touched since.
--
-- WHY NOT EMAIL: several unrelated rows share one (the support@ inbox on
-- Consignment, Theresa Jones and Jami Polestak; Test 123 and Brie Bryan; Kristen
-- and Steve Seeger). Matching on it would label different people as twins.
--
-- ADDITIVE ONLY (ADR-0006): three new functions and three new indexes, no column
-- or row touched.
--
-- APPLY: `supabase db query --linked -f` runs this file. CREATE INDEX CONCURRENTLY
-- cannot run inside a transaction; if a runner wraps the file in one, run the three
-- index statements on their own first.

create index concurrently if not exists gp_closet_items_directory_idx
  on public.gp_closet_items (client_id) include (is_deleted, transitioned_at, last_modified, added_at);
create index concurrently if not exists gp_looks_directory_idx
  on public.gp_looks (client_id) include (published, archived, transitioned_at, updated_at, created_at);
create index concurrently if not exists gp_boards_directory_idx
  on public.gp_boards (client_id) include (published, is_deleted, last_modified, created_at);

-- Lower-cased name words, parentheticals and punctuation dropped.
-- "Kristen Seeger- Wilmette" -> {kristen,seeger,wilmette}; "Cynthia Lippe2" -> {cynthia,lippe}
create or replace function public.client_name_words(p text)
returns text[]
language sql
immutable
set search_path = public
as $$
  select coalesce(array_remove(
    regexp_split_to_array(
      trim(regexp_replace(
        regexp_replace(lower(coalesce(p, '')), '\([^)]*\)', ' ', 'g'),
        '[^[:alpha:]]+', ' ', 'g')),
      '\s+'),
    ''), '{}')
$$;

-- True when a and b differ by exactly one inserted, deleted or substituted letter.
create or replace function public.client_name_one_edit_apart(a text, b text)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  la int := length(a);
  lb int := length(b);
  i int := 1;
begin
  if a = b or abs(la - lb) > 1 then
    return false;
  end if;
  while i <= least(la, lb) and substr(a, i, 1) = substr(b, i, 1) loop
    i := i + 1;
  end loop;
  if la = lb then
    return substr(a, i + 1) = substr(b, i + 1);
  elsif la > lb then
    return substr(a, i + 1) = substr(b, i);
  else
    return substr(a, i) = substr(b, i + 1);
  end if;
end
$$;

create or replace function public.client_directory()
returns table (
  id text,
  name text,
  status text,
  microsite text,
  pieces int,
  looks int,
  capsules int,
  last_activity timestamptz,
  similar_count int,
  badge text,
  note text
)
language sql
stable
security definer
set search_path = public
as $$
  with visible as (
    -- gp_clients_read, verbatim in meaning. Evaluated here instead of per row.
    select c.id, c.name, c.status, c.microsite
    from gp_clients c
    where (select auth.jwt() ->> 'role') = 'service_role'   -- bypasses RLS everywhere; the guard reads as it
       or (select public.is_full_staff())
       or public.is_assigned_client(c.id)
       or c.microsite = ((select auth.jwt()) -> 'user_metadata' ->> 'microsite')
  ),
  base as (
    select v.id, v.name, v.status, v.microsite, public.client_name_words(v.name) as w
    from visible v
  ),
  i as (
    select client_id,
           count(*) filter (where not coalesce(is_deleted, false) and transitioned_at is null) as n,
           max(coalesce(last_modified, added_at)) filter (where not coalesce(is_deleted, false)) as at
    from gp_closet_items where client_id in (select id from visible) group by client_id
  ),
  l as (
    select client_id,
           count(*) filter (where published and not coalesce(archived, false) and transitioned_at is null) as n,
           max(coalesce(updated_at, created_at)) as at
    from gp_looks where client_id in (select id from visible) group by client_id
  ),
  b as (
    select client_id,
           count(*) filter (where published and not coalesce(is_deleted, false)) as n,
           max(coalesce(last_modified, created_at)) filter (where not coalesce(is_deleted, false)) as at
    from gp_boards where client_id in (select id from visible) group by client_id
  ),
  s as (
    select base.*,
           coalesce(i.n, 0)::int as pieces,
           coalesce(l.n, 0)::int as looks,
           coalesce(b.n, 0)::int as capsules,
           greatest(i.at, l.at, b.at) as last_activity
    from base
    left join i on i.client_id = base.id
    left join l on l.client_id = base.id
    left join b on b.client_id = base.id
  ),
  -- Pairs the team has decided are two separate lookbooks. They still carry the
  -- note, so nobody mistakes one for an accident, but neither gets a star.
  -- Karl, 2026-09-08: Cynthia Lippe and Cynthia Lippe2 stay separate.
  kept_separate(a, b) as (
    values ('5e8ec7c545496f1c3f4c643f', '5e8ec7c445496f1c3f4c6167')
  ),
  pairs as (
    select x.id as id, y.id as other_id,
           exists (select 1 from kept_separate k
                   where (k.a = x.id and k.b = y.id) or (k.a = y.id and k.b = x.id)) as separate
    from s x
    join s y
      on y.id <> x.id
     and cardinality(x.w) > 0
     and x.w[1] = y.w[1]   -- same first name: every rule below needs it
    where array_to_string(x.w, '') = array_to_string(y.w, '')           -- same name, spacing aside
       or (cardinality(x.w) >= 2 and cardinality(y.w) >= 2
           and x.w[cardinality(x.w)] = y.w[cardinality(y.w)]
           and x.w <> y.w)                                              -- an extra middle name
       or (cardinality(x.w) >= 2 and cardinality(y.w) >= 2
           and least(length(x.w[cardinality(x.w)]), length(y.w[cardinality(y.w)])) >= 4
           and (public.client_name_one_edit_apart(x.w[cardinality(x.w)], y.w[cardinality(y.w)])
                or (length(x.w[cardinality(x.w)]) >= 5
                    and x.w[cardinality(x.w)] <> y.w[cardinality(y.w)]
                    and (select string_agg(ch, '' order by ch) from regexp_split_to_table(x.w[cardinality(x.w)], '') ch)
                      = (select string_agg(ch, '' order by ch) from regexp_split_to_table(y.w[cardinality(y.w)], '') ch))))
                                                                        -- last name one letter off, or two letters swapped
  ),
  -- The strongest rival each client has among its non-separate twins, by the same
  -- order the star uses: published looks, then pieces, then the DAY of last activity
  -- (a day, not a timestamp, so identical twins do not split on milliseconds).
  rival as (
    select distinct on (p.id)
           p.id, o.looks, o.pieces, o.last_activity::date as day
    from pairs p
    join s o on o.id = p.other_id
    where not p.separate
    order by p.id, o.looks desc, o.pieces desc, o.last_activity desc nulls last
  ),
  counts as (
    select p.id, count(*)::int as n, bool_and(p.separate) as all_separate
    from pairs p group by p.id
  )
  select s.id, s.name, s.status, s.microsite, s.pieces, s.looks, s.capsules, s.last_activity,
         coalesce(counts.n, 0) as similar_count,
         case
           when counts.n is null then null
           when counts.all_separate then 'Kept separate'
           when s.pieces + s.looks = 0 then null
           when s.looks > r.looks then 'Most looks'
           when s.looks = r.looks and s.pieces > r.pieces then 'Most pieces'
           when s.looks = r.looks and s.pieces = r.pieces
                and s.last_activity::date > coalesce(r.day, '-infinity'::date) then 'Most recent'
           else null
         end as badge,
         case
           when counts.n is null then null
           else concat_ws(' · ',
             case when s.pieces + s.looks + s.capsules = 0 then 'Empty'
                  else concat_ws(' · ',
                         s.pieces || case when s.pieces = 1 then ' piece' else ' pieces' end,
                         s.looks || case when s.looks = 1 then ' look' else ' looks' end,
                         case when s.capsules > 0 then s.capsules || case when s.capsules = 1 then ' capsule' else ' capsules' end end)
             end,
             case when s.last_activity is null then 'never updated'
                  else 'updated ' || to_char(s.last_activity, 'Mon FMDD, YYYY') end,
             case when s.status = 'archived' then 'archived' end)
         end as note
  from s
  left join counts on counts.id = s.id
  left join rival r on r.id = s.id
  order by s.name
$$;

revoke all on function public.client_directory() from public;
revoke all on function public.client_directory() from anon;
grant execute on function public.client_directory() to authenticated, service_role;
