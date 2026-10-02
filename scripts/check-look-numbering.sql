-- check-look-numbering.sql (ADR-0161). Run by check-look-numbering.mjs against LIVE.
--
-- Builds a throwaway client with 6 looks inside ONE DO block, walks every writer path the rule
-- has to survive, and ALWAYS ends by raising an exception, so the block rolls back and nothing
-- it made survives. Success raises 'CHECK_OK <n> assertions'; any failure raises 'CHECK_FAIL ...'.
-- On a database without migration 031 it fails (no look_numbering_apply), which is the point.
DO $check$
DECLARE
  cid  text := 'zz-check-look-numbering-' || md5(clock_timestamp()::text);
  nums text;
  names text;
  passed int := 0;
  r record;

  -- every live look's name in number order, as one string
  live_names text;
BEGIN
  INSERT INTO gp_clients (id, name, raw) VALUES (cid, 'ZZ Check Look Numbering', '{}'::jsonb);
  -- Messy on purpose: a gap (3 -> 7), a duplicate (7 twice), a "to be tried" title, a blank,
  -- and a draft in the queue. All of it is what live data looks like (Kristen Seeger, Keil).
  INSERT INTO gp_looks (id, client_id, name, raw, published, created_at) VALUES
    (cid||'-a', cid, 'ZZ Client Look 1',                '{}', true,  now() - interval '6 days'),
    (cid||'-b', cid, 'ZZ Client FW26 Look 3',           '{}', true,  now() - interval '5 days'),
    (cid||'-c', cid, 'ZZ Client To Be Tried Look 7',    '{}', true,  now() - interval '4 days'),
    (cid||'-d', cid, 'ZZ Client Look 7',                '{}', true,  now() - interval '3 days'),
    (cid||'-e', cid, '',                                '{}', true,  now() - interval '2 days'),
    (cid||'-f', cid, 'Look 8',                          '{}', false, now() - interval '1 days');

  -- 1. Off by default: an insert renames nothing.
  IF (SELECT name FROM gp_looks WHERE id = cid||'-b') <> 'ZZ Client FW26 Look 3' THEN
    RAISE EXCEPTION 'CHECK_FAIL 1: a client who is off was renamed';
  END IF; passed := passed + 1;

  -- 2. Renumber looks.
  PERFORM * FROM look_numbering_apply(cid, 'check');
  SELECT string_agg(name, '|' ORDER BY look_number) INTO live_names FROM gp_looks WHERE client_id = cid AND NOT archived;
  IF live_names <> 'Look 1|Look 2|To Be Tried Look 3|Look 4|Look 5|Look 6' THEN
    RAISE EXCEPTION 'CHECK_FAIL 2: renumber gave %', live_names;
  END IF; passed := passed + 1;

  -- 3. Archive Look 2: everything after moves up, no gap. (Builder Archive writes archived+published.)
  UPDATE gp_looks SET archived = true, published = false WHERE id = cid||'-b';
  SELECT string_agg(name, '|' ORDER BY look_number) INTO live_names FROM gp_looks WHERE client_id = cid AND NOT archived;
  IF live_names <> 'Look 1|To Be Tried Look 2|Look 3|Look 4|Look 5' THEN
    RAISE EXCEPTION 'CHECK_FAIL 3: after archive %', live_names;
  END IF; passed := passed + 1;

  -- 4. Restore it: back to its old spot, the rest move down. (The blank-titled look sits after the
  --    numbered draft: looks with no number go last, from step 2.)
  UPDATE gp_looks SET archived = false WHERE id = cid||'-b';
  SELECT string_agg(id || '=' || name, '|' ORDER BY look_number) INTO live_names FROM gp_looks WHERE client_id = cid AND NOT archived;
  IF live_names <> cid||'-a=Look 1|'||cid||'-b=Look 2|'||cid||'-c=To Be Tried Look 3|'||cid||'-d=Look 4|'||cid||'-f=Look 5|'||cid||'-e=Look 6' THEN
    RAISE EXCEPTION 'CHECK_FAIL 4: after restore %', live_names;
  END IF; passed := passed + 1;

  -- 5. Tick To Try: the words come off that look, and its number stays.
  UPDATE gp_looks SET to_try_at = now() WHERE id = cid||'-c';
  IF (SELECT name FROM gp_looks WHERE id = cid||'-c') <> 'Look 3' THEN
    RAISE EXCEPTION 'CHECK_FAIL 5: ticked look is %', (SELECT name FROM gp_looks WHERE id = cid||'-c');
  END IF; passed := passed + 1;

  -- 6. Untick: the words do NOT come back.
  UPDATE gp_looks SET to_try_at = null WHERE id = cid||'-c';
  IF (SELECT name FROM gp_looks WHERE id = cid||'-c') <> 'Look 3' THEN
    RAISE EXCEPTION 'CHECK_FAIL 6: unticked look is %', (SELECT name FROM gp_looks WHERE id = cid||'-c');
  END IF; passed := passed + 1;

  -- 7. Delete Look 1 (builder Delete): no gap.
  DELETE FROM gp_looks WHERE id = cid||'-a';
  SELECT string_agg(look_number::text, ',' ORDER BY look_number) INTO nums FROM gp_looks WHERE client_id = cid AND NOT archived;
  IF nums <> '1,2,3,4,5' THEN RAISE EXCEPTION 'CHECK_FAIL 7: after delete %', nums; END IF;
  passed := passed + 1;

  -- 8. A new look saved with any name goes on the end.
  INSERT INTO gp_looks (id, client_id, name, raw, published) VALUES (cid||'-g', cid, 'Untitled Look', '{}', false);
  IF (SELECT name FROM gp_looks WHERE id = cid||'-g') <> 'Look 6' THEN
    RAISE EXCEPTION 'CHECK_FAIL 8: new look is %', (SELECT name FROM gp_looks WHERE id = cid||'-g');
  END IF; passed := passed + 1;

  -- 9. The GoodPix sync writes back GoodPix's old title: the name is put right, the order holds.
  UPDATE gp_looks SET name = 'ZZ Client To Be Tried Look 99' WHERE id = cid||'-d';
  SELECT string_agg(name, '|' ORDER BY look_number) INTO live_names FROM gp_looks WHERE client_id = cid AND NOT archived;
  IF live_names <> 'Look 1|Look 2|To Be Tried Look 3|Look 4|Look 5|Look 6' THEN
    RAISE EXCEPTION 'CHECK_FAIL 9: after a sync overwrite %', live_names;
  END IF; passed := passed + 1;

  -- 10. A drag (sort_order) renumbers nothing.
  UPDATE gp_looks SET sort_order = 0 WHERE id = cid||'-g';
  IF (SELECT look_number FROM gp_looks WHERE id = cid||'-g') <> 6 THEN
    RAISE EXCEPTION 'CHECK_FAIL 10: a drag moved the number';
  END IF; passed := passed + 1;

  -- 11. Undo: every old name back, switch off, and an archive no longer renumbers.
  PERFORM * FROM look_numbering_undo(cid, 'check');
  IF (SELECT name FROM gp_looks WHERE id = cid||'-b') <> 'ZZ Client FW26 Look 3'
     OR (SELECT looks_numbering_on FROM gp_clients WHERE id = cid) THEN
    RAISE EXCEPTION 'CHECK_FAIL 11: undo left % / on=%', (SELECT name FROM gp_looks WHERE id = cid||'-b'),
      (SELECT looks_numbering_on FROM gp_clients WHERE id = cid);
  END IF;
  UPDATE gp_looks SET archived = true WHERE id = cid||'-e';
  IF (SELECT name FROM gp_looks WHERE id = cid||'-f') <> 'Look 8' THEN
    RAISE EXCEPTION 'CHECK_FAIL 11b: renamed after undo: %', (SELECT name FROM gp_looks WHERE id = cid||'-f');
  END IF; passed := passed + 1;

  RAISE EXCEPTION 'CHECK_OK % assertions, 7 looks, 1 throwaway client (rolled back)', passed;
END
$check$;
