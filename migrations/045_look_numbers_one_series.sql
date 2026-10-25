-- 045. HER NAME TYPED TWO WAYS IS NOT A NEW SEASON. ADR-0161 (amendment 4, 2026-10-24).
--
-- Cynthia Dada, #watson-atelier, 2026-10-19, on Janet Foutty's Look numbers window: her looks
-- should keep the numbers they have now (Look 245 stays Look 245), and only the looks with no
-- number or a shared number get the next numbers after 344. The preview instead renumbered her
-- from Look 1 season by season and said "Her old numbers start again each season".
--
-- Why: the season-restart check (031, kept by 034/039) flags a client when 3 or more numbers each
-- appear under 2+ title starts. Janet's numbers are one running series, 47 to 344, but stylists
-- typed her name three ways ("Janet Foutty Look N", "Janet F Look N", plain "Look N"), and 53,
-- 288, 289, 291, 292, 294, 295, 296 were each typed under two of them. So Rule 4 (keep numbers)
-- was skipped for her.
--
-- THE FIX: the check now compares title starts with the client's own name taken out: her name's
-- words, any shortening of one ("Janet F", "Jan") and her initials ("JF"). "Janet Foutty",
-- "Janet F" and nothing are then the same start. A real season is still a start of its own:
-- "Margaux Ellery SS25" and "Margaux Ellery FW25" are "ss25" and "fw25", so a client who truly
-- restarts each season is still numbered season by season. Only the yes/no flag changes; the
-- season-by-season order a restarting client gets is the same as before.
--
-- Clients already switched on keep their numbers: the flag only steers looks with no number yet,
-- and Rule 4 never runs for a client who is on.
--
-- NO SCHEMA CHANGE: look_numbering_plan is replaced with the same signature and result columns,
-- so look_numbering_apply/sync and the Client Management route read it unchanged.
--
--   supabase db query --linked -f ~/atelier-builder/migrations/045_look_numbers_one_series.sql   (from ~/Downloads/wsg-dashboard)

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
  ),
  -- Her name as written on the client (before any " - Location" suffix), one word per row.
  name_words AS (
    SELECT w.word, w.ord
    FROM c, regexp_split_to_table(lower(btrim(split_part(coalesce(c.client_name, ''), '-', 1))), '[^[:alnum:]]+')
         WITH ORDINALITY AS w(word, ord)
    WHERE w.word <> ''
  ),
  -- A title start with her name, a shortening of it or her initials taken out: what is left is
  -- the season or trip ("ss25"), or nothing.
  starts AS (
    SELECT live.t, coalesce((
      SELECT string_agg(x.tok, ' ' ORDER BY x.ord)
      FROM regexp_split_to_table(live.stem, '[^[:alnum:]]+') WITH ORDINALITY AS x(tok, ord)
      WHERE x.tok <> ''
        AND NOT EXISTS (SELECT 1 FROM name_words n WHERE starts_with(n.word, x.tok))
        AND x.tok IS DISTINCT FROM (SELECT string_agg(left(n.word, 1), '' ORDER BY n.ord) FROM name_words n)
    ), '') AS season
    FROM live WHERE live.t IS NOT NULL
  ), restarts AS (
    SELECT count(*) >= 3 AS yes FROM (
      SELECT t FROM starts GROUP BY t HAVING count(DISTINCT season) > 1
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

NOTIFY pgrst, 'reload schema';

INSERT INTO schema_migrations (version, source, verified, note) VALUES
 ('045_look_numbers_one_series', 'atelier-builder/migrations',
  pg_get_functiondef('look_numbering_plan(text)'::regprocedure) LIKE '%name_words%',
  'sig: look_numbering_plan restart check ignores her own name in title starts -- ADR-0161 amendment 4')
ON CONFLICT (version) DO UPDATE
  SET verified = excluded.verified, applied_at = now(), note = excluded.note;
