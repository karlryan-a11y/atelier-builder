-- 040: client_directory() leaves out accounts combined into another (ADR-0172).
-- Same function as 023 (as live on 2026-10-08) with one added condition: c.merged_into is null.
-- Karl approved 2026-10-08 ("yes I approve 1-4"). Readers: builder ClientBar + Digitize picker,
-- dashboard Client Management. Return shape unchanged.
CREATE OR REPLACE FUNCTION public.client_directory()
 RETURNS TABLE(id text, name text, status text, microsite text, pieces integer, looks integer, capsules integer, last_activity timestamp with time zone, similar_count integer, badge text, note text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with visible as (
    -- gp_clients_read, verbatim in meaning. Evaluated here instead of per row.
    select c.id, c.name, c.status, c.microsite
    from gp_clients c
    -- An account combined into another (ADR-0172) is empty and lives on inside the main one:
    -- it is in no picker and no list. Cynthia, 2026-10-08: "remove the Keil Cadieux Carlton
    -- Landing closet since everything is under Creekside". Undo is on the main account.
    where c.merged_into is null
      and ((select auth.jwt() ->> 'role') = 'service_role'   -- bypasses RLS everywhere; the guard reads as it
       or (select public.is_full_staff())
       or public.is_assigned_client(c.id)
       or c.microsite = ((select auth.jwt()) -> 'user_metadata' ->> 'microsite'))
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
$function$;
