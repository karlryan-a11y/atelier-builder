-- 024: the GoodPix arrangement of every scraped look (ADR-0127).
--
-- GoodPix never exported a look's layout through the endpoints the scraper read, so 0 of
-- 15,065 GoodPix looks had a canvas and every Restyle / Rebuild in canvas was a plain grid.
-- The layout DOES exist: GoodPix's own editor loads it from
--   GET v2.api.goodpix.co/v2/content-items/boards/with-canvas-state/<board>?representation=canonical
-- (120 of 120 sampled boards on 2026-09-18 had one, handwriting included).
--
-- Stored as GoodPix wrote it (a slimmed copy of its Fabric.js objects plus the board's piece
-- pool), NOT converted: the conversion to an Atelier canvas lives once, in atelier-builder
-- src/lib/goodpixLayout.ts, so it can be corrected without refetching 15,000 boards.
--
-- Deliberately NOT written into canvas_state. A GoodPix look is never edited in place
-- (ADR-0076); a populated canvas_state would make the builder treat it as editable and a save
-- would overwrite the original's raw pointer.
--
-- Additive and nullable (ADR-0006). Table-level grants already cover new columns.
ALTER TABLE gp_looks ADD COLUMN IF NOT EXISTS gp_layout jsonb;
ALTER TABLE gp_looks ADD COLUMN IF NOT EXISTS gp_layout_fetched_at timestamptz;
COMMENT ON COLUMN gp_looks.gp_layout IS
  'GoodPix board layout (slimmed Fabric objects + piece pool), fetched from with-canvas-state. Converted by atelier-builder src/lib/goodpixLayout.ts. ADR-0127.';
NOTIFY pgrst, 'reload schema';
