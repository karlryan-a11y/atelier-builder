-- 038. COMBINE TWO ACCOUNTS INTO ONE CLIENT WITH TWO HOMES. ADR-0172.
--
-- GoodPix had no residences, so a client with two houses got two GoodPix accounts, and the sync
-- gave each its own Atelier account. Julia Driscoll, 2026-10-05 (Kristen Seeger, Wilmette + Downtown
-- Chicago): "How are we handling clients with two residences in Atelier?" Cynthia Dada, 2026-10-06:
-- "Can you please merge Mrs. C's Carlton Landing site with her Creekside site on Atelier?"
--
-- Atelier already does homes inside ONE account (ADR-0111: a look_categories row with is_residence,
-- a piece in a home through its looks or its Also in list). This folds the second account into the
-- first and files each side under its own home.
--
-- ONE TRANSACTION, EVERYTHING RECORDED. merge_client_accounts() moves every content row of the
-- second account (pieces, looks, capsules, invoices, purchases, marks, team notes, share links,
-- templates, intake) to the main one, recording the key of every row it moved, every category it
-- moved, every home it created, every assignment it added and every piece it tagged, in
-- client_merges.log. undo_client_merge() replays that log backwards. Nothing is deleted.
--
-- THE SECOND ACCOUNT IS NOT DELETED. gp_clients.merged_into points at the main account. Billing,
-- hours and roster rows keyed by its id keep their link (Kristen's hours_ledger is keyed by an
-- account that is not her main one). Pickers hide it; the GoodPix sync writes anything that arrives
-- under its GoodPix id into the main account, tagged with its home (wsg-dashboard gp-sync).
--
-- Called only by the server (wsg-dashboard /api/admin/combine-accounts, team members): EXECUTE is
-- revoked from anon and authenticated. ADDITIVE ONLY: one nullable column, one new table.
--
--   supabase db query --linked -f ~/Downloads/atelier-builder/migrations/038_combine_accounts.sql   (from ~/Downloads/wsg-dashboard)

ALTER TABLE gp_clients ADD COLUMN IF NOT EXISTS merged_into text REFERENCES gp_clients(id);
-- Which GoodPix account a piece came from, when that is not the account it now sits in. Set by a
-- combine for the pieces it moves, and by the GoodPix sync for pieces it adds from a combined
-- account. The sync's deletion step only ever considers pieces from the account it is reading:
-- without this, syncing Creekside would see Carlton Landing's 233 pieces as "no longer on GoodPix"
-- (16% of the combined closet, under the 25% guard) and hide them.
ALTER TABLE gp_closet_items ADD COLUMN IF NOT EXISTS origin_client_id text;
COMMENT ON COLUMN gp_closet_items.origin_client_id IS
  'ADR-0172. The GoodPix account this piece came from when it has been combined into another account. NULL = it came from the account it sits in.';
COMMENT ON COLUMN gp_clients.merged_into IS
  'ADR-0172. Set when this account was combined into another (merge_client_accounts). Its content lives on the main account; pickers hide it; the GoodPix sync writes into the main one. NULL = a live account.';

CREATE TABLE IF NOT EXISTS client_merges (
  id                  bigserial PRIMARY KEY,
  primary_id          text NOT NULL REFERENCES gp_clients(id),
  secondary_id        text NOT NULL REFERENCES gp_clients(id),
  primary_home_slug   text NOT NULL,
  secondary_home_slug text NOT NULL,
  primary_home_label  text NOT NULL,
  secondary_home_label text NOT NULL,
  actor               text,
  log                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary             jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  undone_at           timestamptz,
  undone_by           text
);
CREATE INDEX IF NOT EXISTS client_merges_primary ON client_merges (primary_id, created_at DESC);
CREATE INDEX IF NOT EXISTS client_merges_secondary ON client_merges (secondary_id) WHERE undone_at IS NULL;
ALTER TABLE client_merges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON client_merges FROM anon, authenticated;

-- The content tables a merge moves, and the expression that identifies a row in each (for the log).
CREATE OR REPLACE FUNCTION combine_tables() RETURNS TABLE (tbl text, keyexpr text)
LANGUAGE sql IMMUTABLE AS $$
  VALUES
    ('gp_closet_items', 'id::text'),
    ('gp_looks', 'id::text'),
    ('gp_boards', 'id::text'),
    ('gp_invoices', 'id::text'),
    ('gp_invoice_items', 'id::text'),
    ('gp_invoice_payments', 'id::text'),
    ('gp_orders', 'id::text'),
    ('purchases', 'id::text'),
    ('purchase_items_declined', 'id::text'),
    ('client_notes', 'id::text'),
    ('intake_batches', 'id::text'),
    ('intake_items', 'id::text'),
    ('look_templates', 'look_id::text'),
    ('look_residence_proposals', 'look_id::text'),
    ('closet_item_team_notes', 'item_id::text'),
    ('team_notes', 'kind::text || '':'' || target_id::text'),
    ('client_marks', 'target_type::text || '':'' || target_id::text || '':'' || mark::text'),
    ('share_links', 'token::text')
$$;

CREATE OR REPLACE FUNCTION combine_slug(p text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT trim(both '-' from regexp_replace(lower(coalesce(p, '')), '[^a-z0-9]+', '-', 'g'))
$$;

-- What a merge would do, without doing it. Read by the Combine accounts panel before she presses it.
CREATE OR REPLACE FUNCTION merge_client_accounts_preview(p_primary text, p_secondary text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; counts jsonb := '{}'::jsonb; n bigint; pc gp_clients; sc gp_clients;
BEGIN
  SELECT * INTO pc FROM gp_clients WHERE id = p_primary;
  SELECT * INTO sc FROM gp_clients WHERE id = p_secondary;
  IF pc.id IS NULL OR sc.id IS NULL THEN RAISE EXCEPTION 'account not found'; END IF;
  FOR r IN SELECT * FROM combine_tables() LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE client_id = $1', r.tbl) INTO n USING p_secondary;
    IF n > 0 THEN counts := counts || jsonb_build_object(r.tbl, n); END IF;
  END LOOP;
  RETURN jsonb_build_object(
    'primary', jsonb_build_object('id', pc.id, 'name', pc.name, 'microsite', pc.microsite,
      'pieces', (SELECT count(*) FROM gp_closet_items WHERE client_id = pc.id AND NOT is_deleted),
      'looks', (SELECT count(*) FROM gp_looks WHERE client_id = pc.id AND NOT coalesce(archived, false)),
      'capsules', (SELECT count(*) FROM gp_boards WHERE client_id = pc.id AND NOT is_deleted),
      'merged_into', pc.merged_into),
    'secondary', jsonb_build_object('id', sc.id, 'name', sc.name, 'microsite', sc.microsite, 'email', sc.email,
      'pieces', (SELECT count(*) FROM gp_closet_items WHERE client_id = sc.id AND NOT is_deleted),
      'looks', (SELECT count(*) FROM gp_looks WHERE client_id = sc.id AND NOT coalesce(archived, false)),
      'capsules', (SELECT count(*) FROM gp_boards WHERE client_id = sc.id AND NOT is_deleted),
      'merged_into', sc.merged_into,
      'has_login', EXISTS (SELECT 1 FROM auth.users u WHERE u.raw_user_meta_data->>'microsite' = sc.microsite AND sc.microsite IS NOT NULL)),
    'rows', counts,
    'shared_categories', (SELECT coalesce(jsonb_agg(s.label ORDER BY s.label), '[]'::jsonb) FROM look_categories s
                           WHERE s.client_id = p_secondary AND EXISTS (SELECT 1 FROM look_categories p WHERE p.client_id = p_primary AND p.slug = s.slug)),
    'new_categories', (SELECT coalesce(jsonb_agg(s.label ORDER BY s.label), '[]'::jsonb) FROM look_categories s
                        WHERE s.client_id = p_secondary AND NOT EXISTS (SELECT 1 FROM look_categories p WHERE p.client_id = p_primary AND p.slug = s.slug)),
    'primary_has_others_merged', EXISTS (SELECT 1 FROM gp_clients WHERE merged_into = p_primary),
    'secondary_has_others_merged', EXISTS (SELECT 1 FROM gp_clients WHERE merged_into = p_secondary)
  );
END $$;

CREATE OR REPLACE FUNCTION merge_client_accounts(p_primary text, p_secondary text,
  p_primary_home text, p_secondary_home text, p_actor text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record; keys text[]; moved jsonb := '{}'::jsonb;
  ph_slug text := combine_slug(p_primary_home); sh_slug text := combine_slug(p_secondary_home);
  ph_id uuid; sh_id uuid; created_cats uuid[] := '{}'; residence_was jsonb := '{}'::jsonb;
  moved_look_cats uuid[]; moved_client_cats uuid[];
  primary_looks text[]; secondary_looks text[]; primary_boards text[]; secondary_boards text[];
  primary_pieces text[]; secondary_pieces text[];
  added_look_pairs jsonb; added_board_pairs jsonb; tagged_primary text[]; tagged_secondary text[];
  next_sort int; merge_id bigint; summary jsonb;
BEGIN
  -- Guards. Say what is wrong in words a stylist can act on.
  IF p_primary IS NULL OR p_secondary IS NULL OR p_primary = p_secondary THEN RAISE EXCEPTION 'Pick two different accounts.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM gp_clients WHERE id = p_primary) OR NOT EXISTS (SELECT 1 FROM gp_clients WHERE id = p_secondary) THEN RAISE EXCEPTION 'One of those accounts no longer exists.'; END IF;
  IF (SELECT merged_into FROM gp_clients WHERE id = p_primary) IS NOT NULL THEN RAISE EXCEPTION 'The main account has itself been combined into another account.'; END IF;
  IF (SELECT merged_into FROM gp_clients WHERE id = p_secondary) IS NOT NULL THEN RAISE EXCEPTION 'That account has already been combined.'; END IF;
  IF EXISTS (SELECT 1 FROM gp_clients WHERE merged_into = p_secondary) THEN RAISE EXCEPTION 'Other accounts were combined into that one. Combine into it instead, or undo those first.'; END IF;
  IF ph_slug = '' OR sh_slug = '' THEN RAISE EXCEPTION 'Give both homes a name.'; END IF;
  IF ph_slug = sh_slug THEN RAISE EXCEPTION 'The two homes need different names.'; END IF;

  -- Who was where, before anything moves.
  SELECT coalesce(array_agg(id), '{}') INTO primary_looks FROM gp_looks WHERE client_id = p_primary;
  SELECT coalesce(array_agg(id), '{}') INTO secondary_looks FROM gp_looks WHERE client_id = p_secondary;
  SELECT coalesce(array_agg(id), '{}') INTO primary_boards FROM gp_boards WHERE client_id = p_primary;
  SELECT coalesce(array_agg(id), '{}') INTO secondary_boards FROM gp_boards WHERE client_id = p_secondary;
  SELECT coalesce(array_agg(id), '{}') INTO primary_pieces FROM gp_closet_items WHERE client_id = p_primary AND NOT is_deleted;
  SELECT coalesce(array_agg(id), '{}') INTO secondary_pieces FROM gp_closet_items WHERE client_id = p_secondary AND NOT is_deleted;

  -- 1. Content rows.
  FOR r IN SELECT * FROM combine_tables() LOOP
    EXECUTE format('WITH m AS (UPDATE %I SET client_id = $1 WHERE client_id = $2 RETURNING %s AS k) SELECT coalesce(array_agg(k), ''{}'') FROM m', r.tbl, r.keyexpr)
      INTO keys USING p_primary, p_secondary;
    IF array_length(keys, 1) > 0 THEN moved := moved || jsonb_build_object(r.tbl, to_jsonb(keys)); END IF;
  END LOOP;
  -- Remember where the moved pieces came from (the sync's deletion step reads this).
  UPDATE gp_closet_items SET origin_client_id = p_secondary
   WHERE origin_client_id IS NULL AND id IN (SELECT jsonb_array_elements_text(coalesce(moved->'gp_closet_items', '[]'::jsonb)));
  -- A share link carries the microsite it opens on.
  UPDATE share_links SET microsite = (SELECT microsite FROM gp_clients WHERE id = p_primary)
   WHERE token::text IN (SELECT jsonb_array_elements_text(coalesce(moved->'share_links', '[]'::jsonb)));

  -- 2. Look categories. Same slug on both: the looks join the main account's category (pairs
  --    recorded); the second account's row stays where it is, unused. A slug only the second
  --    account has: the row moves to the main account.
  INSERT INTO look_category_assignments (look_id, category_id)
  SELECT a.look_id, p.id FROM look_category_assignments a
    JOIN look_categories s ON s.id = a.category_id AND s.client_id = p_secondary
    JOIN look_categories p ON p.client_id = p_primary AND p.slug = s.slug
  ON CONFLICT DO NOTHING;
  INSERT INTO board_category_assignments (board_id, category_id)
  SELECT a.board_id, p.id FROM board_category_assignments a
    JOIN look_categories s ON s.id = a.category_id AND s.client_id = p_secondary
    JOIN look_categories p ON p.client_id = p_primary AND p.slug = s.slug
  ON CONFLICT DO NOTHING;
  SELECT coalesce(max(sort_order), 0) INTO next_sort FROM look_categories WHERE client_id = p_primary;
  WITH m AS (
    UPDATE look_categories s SET client_id = p_primary, sort_order = next_sort + coalesce(s.sort_order, 0) + 1
     WHERE s.client_id = p_secondary
       AND NOT EXISTS (SELECT 1 FROM look_categories p WHERE p.client_id = p_primary AND p.slug = s.slug)
    RETURNING s.id)
  SELECT coalesce(array_agg(id), '{}') INTO moved_look_cats FROM m;
  -- Piece categories (client_categories): move the ones the main account does not have. Pieces
  -- carry slugs, so a shared slug already means the same thing on the main account.
  WITH m AS (
    UPDATE client_categories s SET client_id = p_primary
     WHERE s.client_id = p_secondary
       AND NOT EXISTS (SELECT 1 FROM client_categories p WHERE p.client_id = p_primary AND p.slug = s.slug)
    RETURNING s.id)
  SELECT coalesce(array_agg(id), '{}') INTO moved_client_cats FROM m;

  -- 3. The two homes, on the main account.
  SELECT coalesce(max(sort_order), 0) INTO next_sort FROM look_categories WHERE client_id = p_primary;
  SELECT id INTO ph_id FROM look_categories WHERE client_id = p_primary AND slug = ph_slug;
  IF ph_id IS NULL THEN
    INSERT INTO look_categories (client_id, slug, label, sort_order, is_residence) VALUES (p_primary, ph_slug, p_primary_home, next_sort + 1, true) RETURNING id INTO ph_id;
    created_cats := created_cats || ph_id;
  ELSE
    residence_was := residence_was || jsonb_build_object(ph_id::text, (SELECT coalesce(is_residence, false) FROM look_categories WHERE id = ph_id));
    UPDATE look_categories SET is_residence = true, is_hidden = false WHERE id = ph_id;
  END IF;
  SELECT id INTO sh_id FROM look_categories WHERE client_id = p_primary AND slug = sh_slug;
  IF sh_id IS NULL THEN
    INSERT INTO look_categories (client_id, slug, label, sort_order, is_residence) VALUES (p_primary, sh_slug, p_secondary_home, next_sort + 2, true) RETURNING id INTO sh_id;
    created_cats := created_cats || sh_id;
  ELSE
    residence_was := residence_was || jsonb_build_object(sh_id::text, (SELECT coalesce(is_residence, false) FROM look_categories WHERE id = sh_id));
    UPDATE look_categories SET is_residence = true, is_hidden = false WHERE id = sh_id;
  END IF;

  -- 4. File each side's looks and capsules under its home (only the pairs actually added are recorded).
  WITH ins AS (
    INSERT INTO look_category_assignments (look_id, category_id)
    SELECT x, ph_id FROM unnest(primary_looks) x UNION ALL SELECT x, sh_id FROM unnest(secondary_looks) x
    ON CONFLICT DO NOTHING RETURNING look_id, category_id)
  SELECT coalesce(jsonb_agg(jsonb_build_array(look_id, category_id)), '[]'::jsonb) INTO added_look_pairs FROM ins;
  WITH ins AS (
    INSERT INTO board_category_assignments (board_id, category_id)
    SELECT x, ph_id FROM unnest(primary_boards) x UNION ALL SELECT x, sh_id FROM unnest(secondary_boards) x
    ON CONFLICT DO NOTHING RETURNING board_id, category_id)
  SELECT coalesce(jsonb_agg(jsonb_build_array(board_id, category_id)), '[]'::jsonb) INTO added_board_pairs FROM ins;

  -- 5. Each side's pieces get its home under Also in (so a piece in no look still lands in a home).
  WITH t AS (UPDATE gp_closet_items SET custom_categories = coalesce(custom_categories, '{}') || ph_slug
              WHERE id = ANY(primary_pieces) AND NOT (ph_slug = ANY(coalesce(custom_categories, '{}'))) RETURNING id)
  SELECT coalesce(array_agg(id), '{}') INTO tagged_primary FROM t;
  WITH t AS (UPDATE gp_closet_items SET custom_categories = coalesce(custom_categories, '{}') || sh_slug
              WHERE id = ANY(secondary_pieces) AND NOT (sh_slug = ANY(coalesce(custom_categories, '{}'))) RETURNING id)
  SELECT coalesce(array_agg(id), '{}') INTO tagged_secondary FROM t;

  -- 6. The second account points at the main one.
  UPDATE gp_clients SET merged_into = p_primary WHERE id = p_secondary;

  summary := jsonb_build_object(
    'pieces', array_length(secondary_pieces, 1), 'looks', array_length(secondary_looks, 1),
    'capsules', array_length(secondary_boards, 1),
    'categories_moved', array_length(moved_look_cats, 1),
    'rows', (SELECT jsonb_object_agg(k, jsonb_array_length(v)) FROM jsonb_each(moved) AS e(k, v)));
  INSERT INTO client_merges (primary_id, secondary_id, primary_home_slug, secondary_home_slug, primary_home_label, secondary_home_label, actor, log, summary)
  VALUES (p_primary, p_secondary, ph_slug, sh_slug, p_primary_home, p_secondary_home, p_actor,
    jsonb_build_object('moved', moved, 'moved_look_categories', to_jsonb(moved_look_cats),
      'moved_client_categories', to_jsonb(moved_client_cats), 'created_categories', to_jsonb(created_cats),
      'residence_was', residence_was, 'added_look_pairs', added_look_pairs, 'added_board_pairs', added_board_pairs,
      'tagged', jsonb_build_object(ph_slug, to_jsonb(tagged_primary), sh_slug, to_jsonb(tagged_secondary))),
    summary)
  RETURNING id INTO merge_id;
  RETURN summary || jsonb_build_object('merge_id', merge_id, 'primary_home', ph_slug, 'secondary_home', sh_slug);
END $$;

CREATE OR REPLACE FUNCTION undo_client_merge(p_merge_id bigint, p_actor text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m client_merges; r record; keys jsonb; slug text; ids jsonb;
BEGIN
  SELECT * INTO m FROM client_merges WHERE id = p_merge_id FOR UPDATE;
  IF m.id IS NULL THEN RAISE EXCEPTION 'That combine was not found.'; END IF;
  IF m.undone_at IS NOT NULL THEN RAISE EXCEPTION 'That combine was already undone.'; END IF;

  -- 5. Untag pieces (only the tags this merge added).
  FOR slug, ids IN SELECT * FROM jsonb_each(m.log->'tagged') LOOP
    UPDATE gp_closet_items SET custom_categories = array_remove(custom_categories, slug)
     WHERE id IN (SELECT jsonb_array_elements_text(ids));
  END LOOP;
  -- 4. Remove the home filings this merge added.
  DELETE FROM look_category_assignments a USING jsonb_array_elements(m.log->'added_look_pairs') p
   WHERE a.look_id = p->>0 AND a.category_id = (p->>1)::uuid;
  DELETE FROM board_category_assignments a USING jsonb_array_elements(m.log->'added_board_pairs') p
   WHERE a.board_id = p->>0 AND a.category_id = (p->>1)::uuid;
  -- 3. Homes: delete the ones it created, put is_residence back on the ones it reused.
  DELETE FROM look_categories WHERE id IN (SELECT (jsonb_array_elements_text(m.log->'created_categories'))::uuid);
  UPDATE look_categories c SET is_residence = (e.value)::boolean
    FROM jsonb_each_text(m.log->'residence_was') e WHERE c.id = e.key::uuid;
  -- 2. Categories back, and the shared-slug pairs this merge added on the main account.
  UPDATE look_categories SET client_id = m.secondary_id WHERE id IN (SELECT (jsonb_array_elements_text(m.log->'moved_look_categories'))::uuid);
  UPDATE client_categories SET client_id = m.secondary_id WHERE id IN (SELECT (jsonb_array_elements_text(m.log->'moved_client_categories'))::uuid);
  DELETE FROM look_category_assignments a USING look_categories p, look_categories s, look_category_assignments sa
   WHERE a.category_id = p.id AND p.client_id = m.primary_id AND s.client_id = m.secondary_id AND s.slug = p.slug
     AND sa.category_id = s.id AND sa.look_id = a.look_id
     AND a.look_id IN (SELECT jsonb_array_elements_text(coalesce(m.log->'moved'->'gp_looks', '[]'::jsonb)));
  DELETE FROM board_category_assignments a USING look_categories p, look_categories s, board_category_assignments sa
   WHERE a.category_id = p.id AND p.client_id = m.primary_id AND s.client_id = m.secondary_id AND s.slug = p.slug
     AND sa.category_id = s.id AND sa.board_id = a.board_id
     AND a.board_id IN (SELECT jsonb_array_elements_text(coalesce(m.log->'moved'->'gp_boards', '[]'::jsonb)));
  UPDATE gp_closet_items SET origin_client_id = NULL
   WHERE origin_client_id = m.secondary_id AND id IN (SELECT jsonb_array_elements_text(coalesce(m.log->'moved'->'gp_closet_items', '[]'::jsonb)));
  -- 1. Rows back.
  FOR r IN SELECT * FROM combine_tables() LOOP
    keys := m.log->'moved'->r.tbl;
    IF keys IS NOT NULL THEN
      EXECUTE format('UPDATE %I SET client_id = $1 WHERE client_id = $2 AND %s IN (SELECT jsonb_array_elements_text($3))', r.tbl, r.keyexpr)
        USING m.secondary_id, m.primary_id, keys;
    END IF;
  END LOOP;
  UPDATE share_links SET microsite = (SELECT microsite FROM gp_clients WHERE id = m.secondary_id)
   WHERE token::text IN (SELECT jsonb_array_elements_text(coalesce(m.log->'moved'->'share_links', '[]'::jsonb)));

  UPDATE gp_clients SET merged_into = NULL WHERE id = m.secondary_id;
  UPDATE client_merges SET undone_at = now(), undone_by = p_actor WHERE id = m.id;
  RETURN jsonb_build_object('undone', m.id, 'secondary_id', m.secondary_id);
END $$;

REVOKE ALL ON FUNCTION merge_client_accounts(text, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION undo_client_merge(bigint, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION merge_client_accounts_preview(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION merge_client_accounts(text, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION undo_client_merge(bigint, text) TO service_role;
GRANT EXECUTE ON FUNCTION merge_client_accounts_preview(text, text) TO service_role;
GRANT ALL ON client_merges TO service_role;
GRANT USAGE, SELECT ON SEQUENCE client_merges_id_seq TO service_role;

NOTIFY pgrst, 'reload schema';
