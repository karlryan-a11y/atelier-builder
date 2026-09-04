-- 021_grant_is_residence_to_anon.sql  (ADR-0110, incident fix)
--
-- INCIDENT. Migration 020 (this session) revoked anon's table-wide SELECT on
-- look_categories and re-granted it column by column, to keep the stylist note off the
-- public key. It granted the 7 columns that existed WHEN I READ THE TABLE. Between that
-- read and the grant, a concurrent session added `is_residence` (ADR-0111), which the
-- CLIENT lookbook reads with the anon key in two places:
--   atelier-looks src/lib/queries.ts:260   .select('id, slug, label, sort_order, is_hidden, is_residence')
--   atelier-looks src/pages/[microsite]/index.astro:32
-- Both returned 401 / 42501. The home tiles on every multi-residence client's front page.
--
-- This is EXACTLY the side effect migration 020's own comment warned about ("a column
-- added to this table in future is NOT automatically readable by anon"), and I still
-- walked into it, because I enumerated the columns from a read taken hours earlier
-- instead of from the table as it stood at the moment of the grant.
--
-- The fix is the grant, not a rollback: the column-level model is right, it was simply
-- missing a column.
--
-- The durable lesson is in the grant itself below: it is written to grant EVERY column
-- except `description`, computed from the catalog, so it cannot go stale again and a
-- future column is readable by default rather than silently 42501-ing a client page.
-- Denying one column is the intent; enumerating the allowed ones was the bug.

DO $$
DECLARE cols text;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
    INTO cols
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name   = 'look_categories'
     AND column_name <> 'description';

  EXECUTE format('REVOKE SELECT ON public.look_categories FROM anon');
  EXECUTE format('GRANT SELECT (%s) ON public.look_categories TO anon', cols);
  RAISE NOTICE 'anon granted SELECT on: %', cols;
END $$;

NOTIFY pgrst, 'reload schema';

INSERT INTO schema_migrations (version, source, verified, note) VALUES
 ('021_grant_is_residence_to_anon', 'atelier-builder/migrations',
  (select count(*) from information_schema.column_privileges
    where table_name='look_categories' and grantee='anon' and privilege_type='SELECT'
      and column_name='is_residence') = 1
  and not exists(select 1 from information_schema.column_privileges
    where table_name='look_categories' and grantee='anon' and privilege_type='SELECT'
      and column_name='description'),
  'sig: anon reads is_residence, still not description — ADR-0110 incident fix')
ON CONFLICT (version) DO UPDATE
  SET verified = excluded.verified, applied_at = now(), note = excluded.note;
