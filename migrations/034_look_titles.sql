-- 034. A NUMBERED LOOK CAN KEEP A TITLE: "LOOK 14 BALI DINNER". ADR-0161 (amended 2026-10-06).
--
-- Karl, 2026-10-06, looking at Margaux Ellery's Look Numbers preview: "I want the option to leave
-- the title but it should change to Look N Bali Dinner as an example. maybe they check a box to
-- keep the title?" Margaux is the case: "Aspen Day Look", "Hamptons Swim Look" are real titles
-- a stylist wrote on purpose, and 031 would have turned every one into a bare "Look N".
--
-- Same preview, second fault: Margaux's titles restart every season ("SS25 Look 1".."SS25 Look
-- 15", then "FW25 Look 1".."), so 031 ordered her oldest first, and inside SS25 the creation
-- times are scrambled: "SS25 Look 10" was coming out as Look 1. A client whose numbers restart
-- is now ordered SERIES BY SERIES (a series = the title with its number taken out, e.g.
-- "margaux ellery ss25"), series in the order each was started, and inside a series by the
-- number she wrote. Looks with no number sit in their own series the same way.
--
-- WHAT CHANGES
--   * gp_looks.look_title: the optional words after the number. The name is
--     [To Be Tried ]Look N[ <title>].
--   * Renumber looks takes a list of looks whose title to keep (the panel's checkboxes). A kept
--     title is the old title with the number, "to be tried", the word "look" and the client's own
--     name taken out: "Margaux Ellery Aspen Day Look" -> "Aspen Day". Everything else: "Look N".
--   * After she is on, a stylist adds or changes a title just by typing it in the name box:
--     "Bali Dinner" or "Look 14 Bali Dinner" both give "Look 14 Bali Dinner". The number is never
--     taken from what she types. The GoodPix sync writing back GoodPix's own title is NOT a
--     stylist typing (name = raw->>'name'), so it never sets a title.
--   * Undo also puts each look's title back.
--
-- ADDITIVE ONLY: one nullable column on gp_looks (table-level grants, checked 2026-10-02), two
-- nullable columns on the service-role-only log. Functions are replaced; the plan's result
-- columns change, so it is dropped and recreated (nothing outside these functions calls it but
-- the Client Management route, deployed with this).
--
--   supabase db query --linked -f ~/atelier-builder/migrations/034_look_titles.sql   (from ~/Downloads/wsg-dashboard)

ALTER TABLE gp_looks ADD COLUMN IF NOT EXISTS look_title text;
COMMENT ON COLUMN gp_looks.look_title IS
  'Optional words after the look number (ADR-0161): the name is [To Be Tried ]Look <look_number>[ <look_title>]. Set by Renumber looks (Keep title) or by a stylist typing a title while numbering is on.';

ALTER TABLE look_numbering_names ADD COLUMN IF NOT EXISTS old_title text;
ALTER TABLE look_numbering_names ADD COLUMN IF NOT EXISTS new_title text;

-- The title left in a name once the number, "to be tried", the word "look" and the client's own
-- name are taken out. NULL when nothing is left, or when it is just "Untitled".
CREATE OR REPLACE FUNCTION look_title_from(p_name text, p_client_name text)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE s text := coalesce(p_name, ''); w text;
BEGIN
  s := regexp_replace(s, 'to\s*be\s*tried', ' ', 'gi');
  s := regexp_replace(s, '\mlook\s*#?\s*\d{1,6}\M', ' ', 'gi');
  s := regexp_replace(s, '\mlooks?\M', ' ', 'gi');
  -- her name, as written on the client (before any " - Location" suffix)
  FOREACH w IN ARRAY regexp_split_to_array(btrim(split_part(coalesce(p_client_name, ''), '-', 1)), '\s+') LOOP
    IF length(w) >= 2 THEN
      s := regexp_replace(s, '\m' || regexp_replace(w, '([.\\+*?^$()\[\]{}|])', '\\\1', 'g') || '\M', ' ', 'gi');
    END IF;
  END LOOP;
  s := btrim(regexp_replace(s, '\s+', ' ', 'g'));
  s := btrim(regexp_replace(s, '^[\s\-:,|.*]+|[\s\-:,|.*]+$', '', 'g'));
  IF s = '' OR lower(s) = 'untitled' THEN RETURN NULL; END IF;
  RETURN s;
END $$;

CREATE OR REPLACE FUNCTION look_display_name(p_name text, p_to_try timestamptz, p_n integer, p_title text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_to_try IS NULL AND coalesce(p_name, '') ~* 'to\s*be\s*tried' THEN 'To Be Tried ' ELSE '' END
      || 'Look ' || p_n
      || coalesce(' ' || nullif(btrim(p_title), ''), '')
$$;

DROP FUNCTION IF EXISTS look_numbering_plan(text);
-- new_name: what she gets as things stand (her stored titles, none before the first renumber).
-- kept_title / new_name_kept: what a look gets if the stylist ticks Keep title for it.
CREATE FUNCTION look_numbering_plan(p_client text)
RETURNS TABLE (look_id text, old_name text, old_number integer, old_title text,
               new_name text, new_number integer, kept_title text, new_name_kept text, restarts boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH c AS (SELECT name AS client_name FROM gp_clients WHERE id = p_client),
  live AS (
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
  ), ordered AS (
    SELECT live.*, s.started, (row_number() OVER (ORDER BY
             live.look_number ASC NULLS LAST,
             -- one running sequence: the number she wrote
             CASE WHEN (SELECT yes FROM restarts) THEN NULL ELSE live.t END ASC NULLS LAST,
             -- numbers restart per series: series in the order started, then the number inside it
             CASE WHEN (SELECT yes FROM restarts) THEN s.started END ASC NULLS LAST,
             CASE WHEN (SELECT yes FROM restarts) THEN live.stem END ASC,
             live.t ASC NULLS LAST,
             live.created_at ASC NULLS LAST,
             live.id ASC))::integer AS n
    FROM live JOIN series s ON s.stem = live.stem
  )
  SELECT o.id, o.name, o.look_number, o.look_title,
         look_display_name(o.name, o.to_try_at, o.n, o.look_title), o.n,
         coalesce(o.look_title, look_title_from(o.name, (SELECT client_name FROM c))),
         look_display_name(o.name, o.to_try_at, o.n, coalesce(o.look_title, look_title_from(o.name, (SELECT client_name FROM c)))),
         (SELECT yes FROM restarts)
  FROM ordered o ORDER BY o.n
$$;

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
  RETURN changed;
END $$;

DROP FUNCTION IF EXISTS look_numbering_apply(text, text);
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
  UPDATE gp_clients SET looks_numbering_on = false WHERE id = p_client;
  UPDATE gp_looks g SET name = n.old_name, look_number = n.old_number, look_title = n.old_title
  FROM look_numbering_names n WHERE n.run_id = rid AND g.id = n.look_id;
  GET DIAGNOSTICS restored = ROW_COUNT;
  UPDATE look_numbering_runs SET undone_at = now(), undone_by = p_actor WHERE id = rid;
  RETURN QUERY SELECT rid, restored;
END $$;

-- The trigger, now also reading a title a stylist TYPED. A name counts as typed when it changed
-- (or the look is new), is not GoodPix's own title coming back (raw->>'name'), and is not already
-- the name the rule would give. Its title is what is left after look_title_from().
CREATE OR REPLACE FUNCTION trg_look_numbering_fn()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c text;
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    IF TG_OP = 'INSERT' THEN
      UPDATE gp_looks g SET look_title = look_title_from(n.name, k.name)
      FROM new_rows n JOIN gp_clients k ON k.id = n.client_id AND k.looks_numbering_on
      WHERE g.id = n.id
        AND n.name IS DISTINCT FROM (n.raw->>'name')
        AND g.look_title IS DISTINCT FROM look_title_from(n.name, k.name);
    ELSE
      UPDATE gp_looks g SET look_title = look_title_from(n.name, k.name)
      FROM new_rows n JOIN old_rows o ON o.id = n.id
           JOIN gp_clients k ON k.id = n.client_id AND k.looks_numbering_on
      WHERE g.id = n.id
        AND n.name IS DISTINCT FROM o.name
        AND n.name IS DISTINCT FROM (n.raw->>'name')
        AND n.name IS DISTINCT FROM look_display_name(n.name, n.to_try_at, n.look_number, n.look_title)
        AND g.look_title IS DISTINCT FROM look_title_from(n.name, k.name);
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    FOR c IN SELECT DISTINCT n.client_id FROM new_rows n
             JOIN gp_clients k ON k.id = n.client_id AND k.looks_numbering_on LOOP
      PERFORM look_numbering_sync(c);
    END LOOP;
  ELSIF TG_OP = 'DELETE' THEN
    FOR c IN SELECT DISTINCT o.client_id FROM old_rows o
             JOIN gp_clients k ON k.id = o.client_id AND k.looks_numbering_on LOOP
      PERFORM look_numbering_sync(c);
    END LOOP;
  ELSE
    FOR c IN SELECT DISTINCT x.client_id FROM (
               SELECT n.client_id FROM new_rows n JOIN old_rows o ON o.id = n.id
                WHERE n.archived IS DISTINCT FROM o.archived
                   OR n.name IS DISTINCT FROM o.name
                   OR n.to_try_at IS DISTINCT FROM o.to_try_at
                   OR n.look_number IS DISTINCT FROM o.look_number
                   OR n.look_title IS DISTINCT FROM o.look_title
                   OR n.client_id IS DISTINCT FROM o.client_id
               UNION
               SELECT o.client_id FROM new_rows n JOIN old_rows o ON o.id = n.id
                WHERE n.client_id IS DISTINCT FROM o.client_id
             ) x JOIN gp_clients k ON k.id = x.client_id AND k.looks_numbering_on LOOP
      PERFORM look_numbering_sync(c);
    END LOOP;
  END IF;
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION look_numbering_plan(text), look_numbering_apply(text, text, text[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION look_numbering_plan(text), look_numbering_apply(text, text, text[])
  TO service_role;

NOTIFY pgrst, 'reload schema';

INSERT INTO schema_migrations (version, source, verified, note) VALUES
 ('034_look_titles', 'atelier-builder/migrations',
  exists(select 1 from information_schema.columns where table_name='gp_looks' and column_name='look_title')
  and look_title_from('Margaux Ellery Aspen Day Look', 'Margaux Ellery') = 'Aspen Day'
  and look_display_name('x', null, 14, 'Bali Dinner') = 'Look 14 Bali Dinner',
  'sig: gp_looks.look_title + apply(p_keep) + series order -- ADR-0161 amendment')
ON CONFLICT (version) DO UPDATE
  SET verified = excluded.verified, applied_at = now(), note = excluded.note;
