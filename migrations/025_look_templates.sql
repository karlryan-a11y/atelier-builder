-- 025: the library the Style (✨) button arranges from (ADR-0128).
--
-- One row per GoodPix look that carries an arrangement (gp_looks.gp_layout, ADR-0127): its pieces
-- reduced to slots (type, centre, size, angle, flip, layer) and the label the stylist put beside
-- each piece (offset, font, size). Built by atelier-builder scripts/build-look-templates.mjs from
-- the shipped converter; ✨ reads rows whose mix matches the pieces on the board.
--
-- Derived data: safe to truncate and rebuild. Additive (ADR-0006). Read by stylists only — no
-- anon grant, and it holds no client-facing content beyond look names and positions.
CREATE TABLE IF NOT EXISTS look_templates (
  look_id     text PRIMARY KEY,
  look_name   text,
  client_id   text NOT NULL,
  board_id    text,
  mix_key     text NOT NULL,
  types_key   text NOT NULL,
  piece_count integer NOT NULL,
  board_w     integer NOT NULL,
  board_h     integer NOT NULL,
  slots       jsonb NOT NULL,
  labels      jsonb NOT NULL DEFAULT '[]'::jsonb,
  built_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS look_templates_mix_key ON look_templates (mix_key);
CREATE INDEX IF NOT EXISTS look_templates_types_key ON look_templates (types_key);
ALTER TABLE look_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS look_templates_read ON look_templates;
CREATE POLICY look_templates_read ON look_templates FOR SELECT TO authenticated USING (true);
REVOKE ALL ON look_templates FROM anon;
GRANT SELECT ON look_templates TO authenticated;
NOTIFY pgrst, 'reload schema';
