-- ROLLBACK for 026: restores the 12 policies on gp_closet_items / gp_looks / gp_boards to their exact
-- definitions as read from pg_policies on 2026-09-19 (qual/with_check text copied verbatim), then drops the
-- helper 026 added. Same names, commands, roles (authenticated) and PERMISSIVE; ALTER POLICY in place.
BEGIN;

ALTER POLICY gp_closet_items_read ON public.gp_closet_items USING (is_full_staff() OR is_assigned_client(client_id) OR (client_id = jwt_client_id()));
ALTER POLICY gp_closet_items_del  ON public.gp_closet_items USING (is_full_staff() OR is_assigned_client(client_id) OR (client_id = jwt_client_id()));
ALTER POLICY gp_closet_items_ins  ON public.gp_closet_items WITH CHECK (is_full_staff() OR is_assigned_client(client_id) OR (client_id = jwt_client_id()));
ALTER POLICY gp_closet_items_upd  ON public.gp_closet_items USING (is_full_staff() OR is_assigned_client(client_id) OR (client_id = jwt_client_id())) WITH CHECK (is_full_staff() OR is_assigned_client(client_id) OR (client_id = jwt_client_id()));

ALTER POLICY gp_looks_read ON public.gp_looks USING (is_full_staff() OR is_assigned_client(client_id) OR (client_id = jwt_client_id()));
ALTER POLICY gp_looks_del  ON public.gp_looks USING (is_full_staff() OR is_assigned_client(client_id) OR (client_id = jwt_client_id()));
ALTER POLICY gp_looks_ins  ON public.gp_looks WITH CHECK (is_full_staff() OR is_assigned_client(client_id) OR (client_id = jwt_client_id()));
ALTER POLICY gp_looks_upd  ON public.gp_looks USING (is_full_staff() OR is_assigned_client(client_id) OR (client_id = jwt_client_id())) WITH CHECK (is_full_staff() OR is_assigned_client(client_id) OR (client_id = jwt_client_id()));

ALTER POLICY gp_boards_read ON public.gp_boards USING (is_full_staff() OR is_assigned_client(client_id) OR (client_id = jwt_client_id()));
ALTER POLICY gp_boards_del  ON public.gp_boards USING (is_full_staff() OR is_assigned_client(client_id) OR (client_id = jwt_client_id()));
ALTER POLICY gp_boards_ins  ON public.gp_boards WITH CHECK (is_full_staff() OR is_assigned_client(client_id) OR (client_id = jwt_client_id()));
ALTER POLICY gp_boards_upd  ON public.gp_boards USING (is_full_staff() OR is_assigned_client(client_id) OR (client_id = jwt_client_id())) WITH CHECK (is_full_staff() OR is_assigned_client(client_id) OR (client_id = jwt_client_id()));

DROP FUNCTION IF EXISTS public.my_assigned_client_ids();

COMMIT;

-- Post-check (read-only): expect 12 rows, every qual/with_check equal to (is_full_staff() OR is_assigned_client(client_id) OR (client_id = jwt_client_id())).
SELECT tablename, policyname, cmd, qual, with_check
  FROM pg_policies
 WHERE schemaname = 'public' AND tablename IN ('gp_closet_items','gp_looks','gp_boards')
 ORDER BY tablename, policyname;
