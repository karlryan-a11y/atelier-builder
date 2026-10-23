-- 044. EVERY NEW CLIENT STARTS WITH LOOK NUMBERS ON. ADR-0161 (amendment 3, 2026-10-23).
--
-- Karl, 2026-10-23, after switching Barbie Beltran on (her 6 looks had been built out of order,
-- so her page read Look 6, 3, 4, 5, 1, 2): "this should be auto turned on for all new client
-- profiles that are created moving forward."
--
-- THE CHOKE POINT IS THE COLUMN DEFAULT. Client profiles are created in three places today:
-- Create Client Site and paid enrollment (both wsg-dashboard src/lib/provisionClientSite.ts) and
-- the Proposal Builder preview (src/lib/proposalBuilder/preview.ts). A default covers the first
-- two and any path written later. The preview is a sample Atelier for a prospect, not a client
-- profile, and keeps its designed look names: it passes looks_numbering_on = false itself.
--
-- A client created ON has no looks yet, so there is nothing to renumber: her first look is
-- Look 1 (Look 1 Bali Dinner when the stylist types a title), the next Look 2, and so on, by the
-- same trigger and counter as every switched-on client (031/034/039). Undo is not offered for her
-- (there is no renumber run to undo); a stylist who wants her off flips the column.
--
-- Existing clients are untouched: ALTER ... SET DEFAULT changes only rows inserted from now on.
--
--   supabase db query --linked -f ~/atelier-builder/migrations/044_new_clients_numbered.sql   (from ~/Downloads/wsg-dashboard)

ALTER TABLE gp_clients ALTER COLUMN looks_numbering_on SET DEFAULT true;

COMMENT ON COLUMN gp_clients.looks_numbering_on IS
  'Look numbering on for this client (ADR-0161). Default true since 2026-10-23: every client created from then on is numbered from her first look. Older clients are switched on by Turn on look numbers in Client Management; Undo turns it off.';

INSERT INTO schema_migrations (version, source, verified, note) VALUES
 ('044_new_clients_numbered', 'atelier-builder/migrations',
  (select column_default from information_schema.columns
    where table_name='gp_clients' and column_name='looks_numbering_on') = 'true',
  'sig: gp_clients.looks_numbering_on DEFAULT true -- ADR-0161 amendment 3')
ON CONFLICT (version) DO UPDATE
  SET verified = excluded.verified, applied_at = now(), note = excluded.note;
