-- 026: gp_closet_items / gp_looks / gp_boards row rules, computed once per query instead of once per row.
--
-- WHAT CHANGES: HOW the 12 policies on these three tables are computed. WHO sees WHAT does not change.
-- Today each policy calls is_full_staff(), is_assigned_client(client_id) and jwt_client_id() for every
-- row scanned. All three depend only on the caller's JWT, so Postgres can evaluate them once per query
-- (an InitPlan) when wrapped in (select ...). is_assigned_client(client_id) takes the row's value, so it
-- is replaced by `client_id IN (select public.my_assigned_client_ids())` over a new helper whose body is
-- the same client_assignments x users join, keyed on the same JWT email.
--
-- Proven before writing (2026-09-19, read-only transactions, 5 personas x 3 tables): old predicate vs
-- new predicate over EVERY row of each table -> 0 rows differ; counts and id hashes identical, and equal
-- to what today's live RLS returns. 48-row client closet page: 65 ms -> 5 ms.
--
-- Rule note: HARD-RULES says lookbook-read tables keep SELECT USING (true). These three already had
-- scoped SELECT policies before this migration; this file keeps exactly that scope.
--
-- Additive: one new function; no table, column or policy is dropped or renamed (ALTER POLICY in place,
-- so there is no instant with a missing policy). Undo: 026_rls_initplan_gp_tables.rollback.sql.
BEGIN;

CREATE OR REPLACE FUNCTION public.my_assigned_client_ids()
 RETURNS SETOF text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select ca.client_id
    from public.client_assignments ca
    join public.users u on u.id = ca.user_id
   where u.email = (auth.jwt() ->> 'email');
$function$;

-- Same EXECUTE grants as is_assigned_client (PUBLIC, anon, authenticated, service_role).
GRANT EXECUTE ON FUNCTION public.my_assigned_client_ids() TO anon, authenticated, service_role;

ALTER POLICY gp_closet_items_read ON public.gp_closet_items USING ((select public.is_full_staff()) OR client_id IN (select public.my_assigned_client_ids()) OR client_id = (select public.jwt_client_id()));
ALTER POLICY gp_closet_items_del  ON public.gp_closet_items USING ((select public.is_full_staff()) OR client_id IN (select public.my_assigned_client_ids()) OR client_id = (select public.jwt_client_id()));
ALTER POLICY gp_closet_items_ins  ON public.gp_closet_items WITH CHECK ((select public.is_full_staff()) OR client_id IN (select public.my_assigned_client_ids()) OR client_id = (select public.jwt_client_id()));
ALTER POLICY gp_closet_items_upd  ON public.gp_closet_items USING ((select public.is_full_staff()) OR client_id IN (select public.my_assigned_client_ids()) OR client_id = (select public.jwt_client_id())) WITH CHECK ((select public.is_full_staff()) OR client_id IN (select public.my_assigned_client_ids()) OR client_id = (select public.jwt_client_id()));

ALTER POLICY gp_looks_read ON public.gp_looks USING ((select public.is_full_staff()) OR client_id IN (select public.my_assigned_client_ids()) OR client_id = (select public.jwt_client_id()));
ALTER POLICY gp_looks_del  ON public.gp_looks USING ((select public.is_full_staff()) OR client_id IN (select public.my_assigned_client_ids()) OR client_id = (select public.jwt_client_id()));
ALTER POLICY gp_looks_ins  ON public.gp_looks WITH CHECK ((select public.is_full_staff()) OR client_id IN (select public.my_assigned_client_ids()) OR client_id = (select public.jwt_client_id()));
ALTER POLICY gp_looks_upd  ON public.gp_looks USING ((select public.is_full_staff()) OR client_id IN (select public.my_assigned_client_ids()) OR client_id = (select public.jwt_client_id())) WITH CHECK ((select public.is_full_staff()) OR client_id IN (select public.my_assigned_client_ids()) OR client_id = (select public.jwt_client_id()));

ALTER POLICY gp_boards_read ON public.gp_boards USING ((select public.is_full_staff()) OR client_id IN (select public.my_assigned_client_ids()) OR client_id = (select public.jwt_client_id()));
ALTER POLICY gp_boards_del  ON public.gp_boards USING ((select public.is_full_staff()) OR client_id IN (select public.my_assigned_client_ids()) OR client_id = (select public.jwt_client_id()));
ALTER POLICY gp_boards_ins  ON public.gp_boards WITH CHECK ((select public.is_full_staff()) OR client_id IN (select public.my_assigned_client_ids()) OR client_id = (select public.jwt_client_id()));
ALTER POLICY gp_boards_upd  ON public.gp_boards USING ((select public.is_full_staff()) OR client_id IN (select public.my_assigned_client_ids()) OR client_id = (select public.jwt_client_id())) WITH CHECK ((select public.is_full_staff()) OR client_id IN (select public.my_assigned_client_ids()) OR client_id = (select public.jwt_client_id()));

COMMIT;

-- Post-check (read-only): expect 12 rows, every qual/with_check containing "SELECT is_full_staff()" and "my_assigned_client_ids()".
SELECT tablename, policyname, cmd, qual, with_check
  FROM pg_policies
 WHERE schemaname = 'public' AND tablename IN ('gp_closet_items','gp_looks','gp_boards')
 ORDER BY tablename, policyname;
