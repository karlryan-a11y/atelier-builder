-- 039. A LOOK'S NUMBER NEVER CHANGES. ADR-0161 (amendment 2, 2026-10-08).
--
-- Maegan Watson, 2026-10-08 morning: clients learn "I love Look 245", packing capsules are built
-- from lists of look numbers, clients email "Look 245 works really well". If numbers do not live
-- forever, a list written last week points at the wrong outfit, which is what happened that
-- morning: Cynthia had renumbered Holly McClellan the afternoon before under 031/034, and 225 of
-- her 242 numbered looks got a new number (her Look 134 became Look 101). Holly was put back with
-- Undo on 10/8 (run 10, all 327 titles restored), with Maegan's and Cynthia's OK in
-- #watson-atelier. "If a look gets deleted, maybe there just never is a 255 anymore. What is
-- important is that Look 245 always comes after Look 244." Confirmed in the thread: newest on top.
-- Reverses Karl 10/2 "gaps aren't fine. it should auto adjust".
--
-- THE RULE
--   1. A look's number is set once and never changed.
--   2. Delete: the number is retired, never handed out again. Archive keeps it; Restore brings the
--      look back with the same number.
--   3. A look with no number yet gets the client's next number: one more than the highest she has
--      EVER had (gp_clients.look_number_next), so a deleted top number is not reused.
--   4. The FIRST switch-on keeps every number already written in a title that is unique among her
--      live looks (Holly's "Look 134" stays Look 134). A repeated number: the oldest look keeps it,
--      the others get new numbers at the end. Looks with no number get new numbers at the end,
--      oldest first. A client whose titles restart every season (SS25 Look 1, FW25 Look 1) has no
--      numbers a client could quote uniquely, so she gets fresh ones once, season by season (034).
--   5. The lookbook shows numbered looks in number order, newest on top (atelier-looks lookOrder.ts).
--   Unchanged: Keep title, Title box, To Be Tried wording, Undo, the trigger and its choke point.
--
-- ADDITIVE ONLY: one nullable column on gp_clients (table-level grants, checked 2026-10-02).
-- Functions are replaced with the same signatures, so the Client Management route is untouched.
--
--   supabase db query --linked -f ~/atelier-builder/migrations/039_look_numbers_permanent.sql   (from ~/Downloads/wsg-dashboard)

ALTER TABLE gp_clients ADD COLUMN IF NOT EXISTS look_number_next integer;
COMMENT ON COLUMN gp_clients.look_number_next IS
  'The next look number to hand out (ADR-0161): one more than the highest she has ever had. Never goes down while numbering is on, so a deleted number is never reused. NULL when numbering is off.';

-- The plan for one client. Same columns as 034, so the Client Management route reads it unchanged.
CREATE OR REPLACE FUNCTION look_numbering_plan(p_client text)
RETURNS TABLE (look_id text, old_name text, old_number integer, old_title text,
               new_name text, new_number integer, kept_title text, new_name_kept text, restarts boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH c AS (
    SELECT name AS client_name, looks_numbering_on AS is_on, look_number_next FROM gp_clients WHERE id = p_client
  ), live AS (
    SELECT l.id, l.name, l.look_number, l.look_title, l.to_try_at, l.created_at,
           (regexp_match(coalesce(l.name, ''), '(?i)look\s*#?\s*(\d{1,6})'))[1]::integer AS t,
           btrim(regexp_replace(regexp_replace(regexp_replace(lower(coalesce(l.name, '')),
                 'look\s*#?\s*\d{1,6}.*$', ''), 'to\s*be\s*tried', '', 'g'), '\s+', ' ', 'g')) AS stem
    FROM gp_looks l
    WHERE l.client_id = p_client AND NOT coalesce(l.archived, false)
  ), restarts AS (
    SELECT count(*) >= 3 AS yes FROM (
      SELECT t FROM live WHERE t IS NOT NULL GROUP BY t HAVING count(DISTINCT stem) > 1
    ) x
  ), series AS (
    SELECT stem, min(created_at) AS started FROM live GROUP BY stem
  ),
  -- Rule 4: only before she is switched on, and never for a season-restart client. A number
  -- already held by any of her looks (archived included) is never taken again.
  kept AS (
    SELECT z.id, z.t FROM (
      SELECT live.id, live.t,
             row_number() OVER (PARTITION BY live.t ORDER BY live.created_at ASC NULLS LAST, live.id) AS rk
      FROM live
      WHERE live.look_number IS NULL AND live.t IS NOT NULL AND live.t > 0
        AND NOT coalesce((SELECT is_on FROM c), false)
        AND NOT (SELECT yes FROM restarts)
    ) z
    WHERE z.rk = 1
      AND NOT EXISTS (SELECT 1 FROM gp_looks g WHERE g.client_id = p_client AND g.look_number = z.t)
  ),
  base AS (
    SELECT greatest(
      coalesce((SELECT look_number_next FROM c), 1),
      coalesce((SELECT max(look_number) FROM gp_looks WHERE client_id = p_client), 0) + 1,
      coalesce((SELECT max(t) FROM kept), 0) + 1
    ) AS b
  ),
  -- Rule 3: everything still without a number, in order, from the counter up.
  fresh AS (
    SELECT live.id, ((SELECT b FROM base) - 1 + row_number() OVER (ORDER BY
             CASE WHEN (SELECT yes FROM restarts) THEN s.started END ASC NULLS LAST,
             CASE WHEN (SELECT yes FROM restarts) THEN live.stem END ASC,
             CASE WHEN (SELECT yes FROM restarts) THEN live.t END ASC NULLS LAST,
             live.created_at ASC NULLS LAST,
             live.id ASC))::integer AS n
    FROM live JOIN series s ON s.stem = live.stem
    WHERE live.look_number IS NULL AND live.id NOT IN (SELECT id FROM kept)
  ), numbered AS (
    SELECT live.*, coalesce(live.look_number, k.t, f.n) AS n
    FROM live LEFT JOIN kept k ON k.id = live.id LEFT JOIN fresh f ON f.id = live.id
  )
  SELECT o.id, o.name, o.look_number, o.look_title,
         look_display_name(o.name, o.to_try_at, o.n, o.look_title), o.n,
         coalesce(o.look_title, look_title_from(o.name, (SELECT client_name FROM c))),
         look_display_name(o.name, o.to_try_at, o.n, coalesce(o.look_title, look_title_from(o.name, (SELECT client_name FROM c)))),
         (SELECT yes FROM restarts)
  FROM numbered o ORDER BY o.n
$$;

-- Keep the counter one past the highest number she has ever held. Never lowers it.
CREATE OR REPLACE FUNCTION look_numbering_bump(p_client text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE gp_clients SET look_number_next = greatest(
    coalesce(look_number_next, 1),
    coalesce((SELECT max(look_number) FROM gp_looks WHERE client_id = p_client), 0) + 1)
  WHERE id = p_client
$$;

-- Bring one client into line: number any look that has none, refresh names. Never renumbers.
CREATE OR REPLACE FUNCTION look_numbering_sync(p_client text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE changed integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM gp_clients WHERE id = p_client AND looks_numbering_on) THEN
    RETURN 0;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('look_numbering:' || p_client));
  UPDATE gp_looks g SET name = p.new_name, look_number = p.new_number
  FROM look_numbering_plan(p_client) p
  WHERE g.id = p.look_id
    AND (g.name IS DISTINCT FROM p.new_name OR g.look_number IS DISTINCT FROM p.new_number);
  GET DIAGNOSTICS changed = ROW_COUNT;
  PERFORM look_numbering_bump(p_client);
  RETURN changed;
END $$;

CREATE OR REPLACE FUNCTION look_numbering_apply(p_client text, p_actor text, p_keep text[] DEFAULT '{}')
RETURNS TABLE (run_id bigint, looks_total integer, looks_renamed integer, titles_kept integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE rid bigint; total integer; renamed integer; kept integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM gp_clients WHERE id = p_client) THEN
    RAISE EXCEPTION 'look_numbering_apply: no client %', p_client;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('look_numbering:' || p_client));
  INSERT INTO look_numbering_runs (client_id, actor) VALUES (p_client, p_actor) RETURNING id INTO rid;
  -- The plan is read while she is still OFF, so rule 4 (keep unique title numbers) applies.
  INSERT INTO look_numbering_names (run_id, look_id, old_name, old_number, old_title, new_name, new_number, new_title)
    SELECT rid, p.look_id, p.old_name, p.old_number, p.old_title,
           CASE WHEN p.look_id = ANY (coalesce(p_keep, '{}')) THEN p.new_name_kept ELSE p.new_name END,
           p.new_number,
           CASE WHEN p.look_id = ANY (coalesce(p_keep, '{}')) THEN p.kept_title ELSE p.old_title END
    FROM look_numbering_plan(p_client) p;
  SELECT count(*), count(*) FILTER (WHERE new_title IS NOT NULL) INTO total, kept
    FROM look_numbering_names WHERE look_numbering_names.run_id = rid;
  UPDATE gp_clients SET looks_numbering_on = true WHERE id = p_client;
  UPDATE gp_looks g SET name = n.new_name, look_number = n.new_number, look_title = n.new_title
  FROM look_numbering_names n
  WHERE n.run_id = rid AND g.id = n.look_id
    AND (g.name IS DISTINCT FROM n.new_name OR g.look_number IS DISTINCT FROM n.new_number
         OR g.look_title IS DISTINCT FROM n.new_title);
  GET DIAGNOSTICS renamed = ROW_COUNT;
  PERFORM look_numbering_bump(p_client);
  UPDATE look_numbering_runs SET looks_renamed = renamed WHERE id = rid;
  RETURN QUERY SELECT rid, total, renamed, kept;
END $$;

CREATE OR REPLACE FUNCTION look_numbering_undo(p_client text, p_actor text)
RETURNS TABLE (run_id bigint, looks_restored integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE rid bigint; restored integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('look_numbering:' || p_client));
  SELECT r.id INTO rid FROM look_numbering_runs r
   WHERE r.client_id = p_client AND r.undone_at IS NULL ORDER BY r.created_at DESC, r.id DESC LIMIT 1;
  IF rid IS NULL THEN
    RAISE EXCEPTION 'look_numbering_undo: nothing to undo for %', p_client;
  END IF;
  UPDATE gp_clients SET looks_numbering_on = false, look_number_next = NULL WHERE id = p_client;
  UPDATE gp_looks g SET name = n.old_name, look_number = n.old_number, look_title = n.old_title
  FROM look_numbering_names n WHERE n.run_id = rid AND g.id = n.look_id;
  GET DIAGNOSTICS restored = ROW_COUNT;
  -- A look numbered after the run (new since) is not in the run's log: clear its number too, so
  -- an off client carries no numbers and her page goes back to its old order exactly.
  UPDATE gp_looks SET look_number = NULL WHERE client_id = p_client AND look_number IS NOT NULL;
  UPDATE look_numbering_runs SET undone_at = now(), undone_by = p_actor WHERE id = rid;
  RETURN QUERY SELECT rid, restored;
END $$;

REVOKE ALL ON FUNCTION look_numbering_bump(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION look_numbering_bump(text) TO service_role;

NOTIFY pgrst, 'reload schema';

INSERT INTO schema_migrations (version, source, verified, note) VALUES
 ('039_look_numbers_permanent', 'atelier-builder/migrations',
  exists(select 1 from information_schema.columns where table_name='gp_clients' and column_name='look_number_next'),
  'sig: gp_clients.look_number_next; numbers never change, deleted numbers retired -- ADR-0161 amendment 2')
ON CONFLICT (version) DO UPDATE
  SET verified = excluded.verified, applied_at = now(), note = excluded.note;
