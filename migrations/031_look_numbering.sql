-- 031. A LOOK'S NUMBER IS ITS PLACE: LOOK 1..N, NO GAPS, KEPT BY THE DATABASE. ADR-0161.
--
-- Cynthia Dada, #watson-atelier, 2026-09-25: number looks automatically, carry on from the last
-- number, and "when you are removing a look from a client site, could it automatically reorder
-- the looks so there aren't gaps in the numbers?" The styling team confirmed "Look #" on 9/30.
-- Karl, 2026-10-02: "gaps aren't fine. it should auto adjust." and: a look titled "to be tried"
-- keeps those words, with its new number, until the stylist ticks To Try in Atelier.
--
-- Measured 2026-10-02: 15,846 live looks across 185 clients. Duplicate numbers are common
-- (Kristen Seeger 69), gaps are normal (Keil Cadieux's highest is 568, 410 distinct), 395 live
-- looks say "to be tried" and 394 of them are not ticked.
--
-- ONE CHOKE POINT. Looks are written by the builder (save, archive, restore, delete through the
-- `looks` view), by the GoodPix sync (wsg-dashboard api/admin/gp-sync, which OVERWRITES name and
-- archived on every refresh) and by hand. A rule in any one of them leaves the others making
-- gaps, and the sync would quietly put the old names back. So the rule lives here, in a
-- statement trigger on gp_looks, and every writer gets it.
--
-- THE NUMBER IS A COLUMN, THE NAME IS DERIVED FROM IT. `look_number` holds the order. Reading the
-- order out of the name would let the GoodPix sync reorder a client by writing back GoodPix's old
-- title. An archived look keeps the number it had, so Restore puts it back in its old spot.
--
-- PER CLIENT, OFF BY DEFAULT. `gp_clients.looks_numbering_on` is false for everyone the day this
-- runs: nothing is renamed until a stylist presses Renumber looks for that client (Client
-- Management). Off = today, exactly.
--
-- UNDOABLE. Every renumber saves each look's old name and number first; Undo puts them back and
-- turns the switch off.
--
-- ADDITIVE ONLY, per HARD-RULES: one nullable column on gp_looks, one defaulted column on
-- gp_clients (both tables are granted at TABLE level to anon/authenticated, checked 2026-10-02,
-- so no column grants are needed), two new log tables locked to the service role.
--
--   supabase db query --linked -f ~/atelier-builder/migrations/031_look_numbering.sql   (from ~/Downloads/wsg-dashboard)

ALTER TABLE gp_looks   ADD COLUMN IF NOT EXISTS look_number integer;
ALTER TABLE gp_clients ADD COLUMN IF NOT EXISTS looks_numbering_on boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN gp_looks.look_number IS
  'Her look number (ADR-0161). Kept 1..N with no gaps by trg_look_numbering while gp_clients.looks_numbering_on. The name is derived from it. An archived look keeps its last number.';
COMMENT ON COLUMN gp_clients.looks_numbering_on IS
  'Look numbering on for this client (ADR-0161). Set by Renumber looks in Client Management; Undo turns it off. false = names are never touched.';

CREATE TABLE IF NOT EXISTS look_numbering_runs (
  id            bigserial PRIMARY KEY,
  client_id     text NOT NULL,
  actor         text,
  looks_renamed integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  undone_at     timestamptz,
  undone_by     text
);
CREATE INDEX IF NOT EXISTS look_numbering_runs_client ON look_numbering_runs (client_id, created_at DESC);

CREATE TABLE IF NOT EXISTS look_numbering_names (
  run_id     bigint NOT NULL REFERENCES look_numbering_runs(id) ON DELETE CASCADE,
  look_id    text NOT NULL,
  old_name   text,
  old_number integer,
  new_name   text,
  new_number integer,
  PRIMARY KEY (run_id, look_id)
);

ALTER TABLE look_numbering_runs  ENABLE ROW LEVEL SECURITY;
ALTER TABLE look_numbering_names ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON look_numbering_runs, look_numbering_names FROM anon, authenticated;
REVOKE ALL ON SEQUENCE look_numbering_runs_id_seq FROM anon, authenticated;

-- The name a look gets at number n. "To Be Tried" survives only on a look whose title says so
-- and that nobody has ticked To Try yet; ticking drops it, and it never comes back.
CREATE OR REPLACE FUNCTION look_numbered_name(p_name text, p_to_try timestamptz, p_n integer)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_to_try IS NULL AND coalesce(p_name, '') ~* 'to\s*be\s*tried'
              THEN 'To Be Tried Look ' || p_n
              ELSE 'Look ' || p_n END
$$;

-- The plan for one client: every live look (published, queue and To Try alike), in order.
--
-- Once she is numbered, the order is simply look_number; a look with none yet (a new one) goes
-- on the end, oldest first.
--
-- The FIRST renumber has to read an order out of the titles, and titles come in two shapes
-- (measured 2026-10-02, 159 clients with numbered titles):
--   * one running sequence ("Danielle York Look 142", "To Be Tried Look 143"): 127 clients.
--     Keep it: order by the number in the title, a duplicate splits by age.
--   * a sequence that restarts every season or trip ("K.C. CL SS24 Look 1", "K.C. CL SS25 Look 1",
--     "K.C. CL FW25 Look 1"): 32 clients, 4,691 looks. Ordering those by title number would
--     interleave every season's Look 1, then every Look 2. Order them oldest first instead.
-- A client "restarts" when 3 or more numbers each appear under 2+ different title stems (the
-- title with the number, "to be tried" and spacing taken out).
CREATE OR REPLACE FUNCTION look_numbering_plan(p_client text)
RETURNS TABLE (look_id text, old_name text, old_number integer, new_name text, new_number integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH live AS (
    SELECT l.id, l.name, l.look_number, l.to_try_at, l.created_at,
           (regexp_match(coalesce(l.name, ''), '(?i)look\s*#?\s*(\d{1,6})'))[1]::integer AS t,
           btrim(regexp_replace(regexp_replace(regexp_replace(lower(coalesce(l.name, '')),
                 'look\s*#?\s*\d{1,6}.*$', ''), 'to\s*be\s*tried', '', 'g'), '\s+', ' ', 'g')) AS stem
    FROM gp_looks l
    WHERE l.client_id = p_client AND NOT coalesce(l.archived, false)
  ), restarts AS (
    SELECT count(*) >= 3 AS yes FROM (
      SELECT t FROM live WHERE t IS NOT NULL GROUP BY t HAVING count(DISTINCT stem) > 1
    ) x
  ), ordered AS (
    SELECT live.*, (row_number() OVER (ORDER BY
             live.look_number ASC NULLS LAST,
             CASE WHEN (SELECT yes FROM restarts) THEN NULL ELSE live.t END ASC NULLS LAST,
             live.created_at ASC NULLS LAST,
             live.t ASC NULLS LAST,
             live.id ASC))::integer AS n
    FROM live
  )
  SELECT id, name, look_number, look_numbered_name(name, to_try_at, n), n FROM ordered ORDER BY n
$$;

-- Bring one client into line with her plan. Writes only rows that differ. No-op when she is off.
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

-- Renumber looks (the Client Management button): save every old name, apply the plan, switch on.
CREATE OR REPLACE FUNCTION look_numbering_apply(p_client text, p_actor text)
RETURNS TABLE (run_id bigint, looks_total integer, looks_renamed integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE rid bigint; total integer; renamed integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM gp_clients WHERE id = p_client) THEN
    RAISE EXCEPTION 'look_numbering_apply: no client %', p_client;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('look_numbering:' || p_client));
  INSERT INTO look_numbering_runs (client_id, actor) VALUES (p_client, p_actor) RETURNING id INTO rid;
  INSERT INTO look_numbering_names (run_id, look_id, old_name, old_number, new_name, new_number)
    SELECT rid, p.look_id, p.old_name, p.old_number, p.new_name, p.new_number FROM look_numbering_plan(p_client) p;
  SELECT count(*) INTO total FROM look_numbering_names WHERE look_numbering_names.run_id = rid;
  -- Switch on BEFORE the write, so the trigger this update fires sees her as on and finds nothing
  -- left to do (the plan is already applied), rather than skipping her.
  UPDATE gp_clients SET looks_numbering_on = true WHERE id = p_client;
  UPDATE gp_looks g SET name = n.new_name, look_number = n.new_number
  FROM look_numbering_names n
  WHERE n.run_id = rid AND g.id = n.look_id
    AND (g.name IS DISTINCT FROM n.new_name OR g.look_number IS DISTINCT FROM n.new_number);
  GET DIAGNOSTICS renamed = ROW_COUNT;
  UPDATE look_numbering_runs SET looks_renamed = renamed WHERE id = rid;
  RETURN QUERY SELECT rid, total, renamed;
END $$;

-- Undo last renumber: switch off FIRST (so nothing renumbers behind it), then put back every old
-- name and number from that run, for looks that still exist.
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
  UPDATE gp_looks g SET name = n.old_name, look_number = n.old_number
  FROM look_numbering_names n WHERE n.run_id = rid AND g.id = n.look_id;
  GET DIAGNOSTICS restored = ROW_COUNT;
  UPDATE look_numbering_runs SET undone_at = now(), undone_by = p_actor WHERE id = rid;
  RETURN QUERY SELECT rid, restored;
END $$;

-- The trigger. Statement level, so a sync that writes 400 looks renumbers each client once.
-- Depth guard: the renumber's own UPDATE fires this again, and must not recurse.
CREATE OR REPLACE FUNCTION trg_look_numbering_fn()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c text;
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;
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
    -- Only the columns that change a number or a name. A drag (sort_order), a note or a photo
    -- touches none of them, and costs one join.
    FOR c IN SELECT DISTINCT x.client_id FROM (
               SELECT n.client_id FROM new_rows n JOIN old_rows o ON o.id = n.id
                WHERE n.archived IS DISTINCT FROM o.archived
                   OR n.name IS DISTINCT FROM o.name
                   OR n.to_try_at IS DISTINCT FROM o.to_try_at
                   OR n.look_number IS DISTINCT FROM o.look_number
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

DROP TRIGGER IF EXISTS trg_look_numbering_ins ON gp_looks;
DROP TRIGGER IF EXISTS trg_look_numbering_upd ON gp_looks;
DROP TRIGGER IF EXISTS trg_look_numbering_del ON gp_looks;
CREATE TRIGGER trg_look_numbering_ins AFTER INSERT ON gp_looks
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION trg_look_numbering_fn();
CREATE TRIGGER trg_look_numbering_upd AFTER UPDATE ON gp_looks
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION trg_look_numbering_fn();
CREATE TRIGGER trg_look_numbering_del AFTER DELETE ON gp_looks
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION trg_look_numbering_fn();

-- Only the server (service role) presses the buttons. A stylist's own writes still renumber,
-- because the trigger function is SECURITY DEFINER.
REVOKE ALL ON FUNCTION look_numbering_plan(text), look_numbering_sync(text),
                       look_numbering_apply(text, text), look_numbering_undo(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION look_numbering_plan(text), look_numbering_sync(text),
                          look_numbering_apply(text, text), look_numbering_undo(text, text)
  TO service_role;

NOTIFY pgrst, 'reload schema';

INSERT INTO schema_migrations (version, source, verified, note) VALUES
 ('031_look_numbering', 'atelier-builder/migrations',
  exists(select 1 from information_schema.columns where table_name='gp_looks' and column_name='look_number')
  and exists(select 1 from pg_trigger where tgname='trg_look_numbering_upd')
  and not exists(select 1 from gp_clients where looks_numbering_on),
  'sig: gp_looks.look_number + trg_look_numbering_*, off for everyone -- ADR-0161')
ON CONFLICT (version) DO UPDATE
  SET verified = excluded.verified, applied_at = now(), note = excluded.note;
