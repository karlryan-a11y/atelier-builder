-- look-numbering-off-clients.sql (ADR-0161, 045). READ ONLY. Run after 045, before switching
-- anyone on: every client still OFF, whether the old check (031-039) called her a season-restart
-- client and whether the plan does now. A row with was_restart = true and restarts_now = false
-- is a client like Janet Foutty: one running series, her name typed more than one way.
--
--   supabase db query --linked -f ~/atelier-builder/scripts/look-numbering-off-clients.sql   (from ~/Downloads/wsg-dashboard)
WITH off AS (
  SELECT id, name FROM gp_clients WHERE NOT coalesce(looks_numbering_on, false)
), live AS (
  SELECT l.client_id,
         (regexp_match(coalesce(l.name, ''), '(?i)look\s*#?\s*(\d{1,6})'))[1]::integer AS t,
         btrim(regexp_replace(regexp_replace(regexp_replace(lower(coalesce(l.name, '')),
               'look\s*#?\s*\d{1,6}.*$', ''), 'to\s*be\s*tried', '', 'g'), '\s+', ' ', 'g')) AS stem
  FROM gp_looks l JOIN off ON off.id = l.client_id
  WHERE NOT coalesce(l.archived, false)
), was AS (
  SELECT client_id, count(*) >= 3 AS was_restart FROM (
    SELECT client_id, t FROM live WHERE t IS NOT NULL GROUP BY client_id, t HAVING count(DISTINCT stem) > 1
  ) x GROUP BY client_id
)
SELECT off.name, off.id, coalesce(was.was_restart, false) AS was_restart,
       coalesce((SELECT bool_or(p.restarts) FROM look_numbering_plan(off.id) p), false) AS restarts_now
FROM off LEFT JOIN was ON was.client_id = off.id
WHERE coalesce(was.was_restart, false)
ORDER BY restarts_now, off.name;
