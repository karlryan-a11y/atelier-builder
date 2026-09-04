-- 020_category_description_not_public.sql  (ADR-0110)
--
-- Karl's call: the client should not see the styling note.
--
-- She already cannot. atelier-looks names its columns and never names this one, so nothing
-- renders it. But `anon` held a TABLE-wide SELECT grant, which in Postgres covers every
-- column including ones added later, so a crafted ?select=description with the public key
-- returned the note. "Stylist only" was true of the interface and not of the database.
--
-- Column-level SELECT is the fix. A table-level grant cannot be narrowed by revoking a
-- single column (the table grant still implies every column), so SELECT is revoked and
-- re-granted per column. ONLY SELECT is touched: anon's INSERT/UPDATE/DELETE grants are
-- left exactly as found, because RLS is what actually blocks those (lc_write is TO
-- authenticated) and changing two things at once makes a rollback ambiguous.
--
-- `authenticated` is untouched and keeps the whole row. That is the stylist in the builder,
-- who must read AND write the note.
--
-- Every column except `description` is granted, including `client_id` and `sort_order`:
-- PostgREST needs SELECT on a column to FILTER or ORDER by it, not just to return it, and
-- both client queries filter on client_id. Granting only the columns in the select lists
-- would 42501 the lookbook.
--
-- SIDE EFFECT, deliberate: with column-level grants in place, a column added to this table
-- in future is NOT automatically readable by anon. That is the safe default for a table
-- holding stylist notes, but it means a future client-visible column needs its own GRANT.
-- Noted in the ADR so the next person is not surprised by a 42501.

REVOKE SELECT ON look_categories FROM anon;

GRANT SELECT (id, client_id, slug, label, sort_order, is_hidden, created_at)
  ON look_categories TO anon;

NOTIFY pgrst, 'reload schema';

INSERT INTO schema_migrations (version, source, verified, note) VALUES
 ('020_category_description_not_public', 'atelier-builder/migrations',
  not exists(select 1 from information_schema.column_privileges
             where table_name='look_categories' and grantee='anon'
               and column_name='description' and privilege_type='SELECT'),
  'sig: anon holds no SELECT on look_categories.description — ADR-0110')
ON CONFLICT (version) DO UPDATE
  SET verified = excluded.verified, applied_at = now(), note = excluded.note;
