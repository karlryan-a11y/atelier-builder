-- 009_item_overrides.sql  (LIVE)
-- A3 + B1: item-level stylist-editable fields. ADDITIVE + NULLABLE only.
--
-- name_override + style_note are DOWNSTREAM-OWNED: the goodpix scraper's
-- column-explicit upsert must NEVER write them, so stylist edits survive re-syncs.
-- The UI shows coalesce(name_override, name). `color` already exists on live
-- (verified) — scraper-owned for goodpix items, safe to edit on intake items.
--
-- NOTE ON THE VIEW: this was tailored to the LIVE `closet_items` view, whose
-- column list is the 25 columns below ending at `intake_item_id` (it does NOT
-- include embedding_status, unlike staging). CREATE OR REPLACE VIEW requires the
-- existing columns to remain an exact prefix; we only append the 3 new columns.

ALTER TABLE gp_closet_items ADD COLUMN IF NOT EXISTS name_override text;
ALTER TABLE gp_closet_items ADD COLUMN IF NOT EXISTS style_note   text;

-- color_family: normalized bucket derived from free-text `color`, for reliable
-- color filtering/grouping later (A2 search already covers the free-text color).
ALTER TABLE gp_closet_items ADD COLUMN IF NOT EXISTS color_family text;
CREATE INDEX IF NOT EXISTS idx_gp_closet_items_color_family
  ON gp_closet_items(client_id, color_family);

-- Allow authenticated stylists to edit item metadata from the Builder.
-- SELECT stays open (existing read policy). This adds writes only.
DROP POLICY IF EXISTS cynthia_item_write ON gp_closet_items;
CREATE POLICY cynthia_item_write ON gp_closet_items
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- Recreate the view to expose the 3 new columns (frozen column list otherwise
-- hides them). The first 25 columns exactly match the current live view; the
-- 3 new columns are appended last.
CREATE OR REPLACE VIEW public.closet_items AS
  SELECT id, client_id, user_id, type, name, brand, price, retailer, color, size,
         primary_image_hash, processed_image_hash, affiliate_data, display_order,
         is_deleted, content_tag_ids, raw, added_at, last_modified, extracted_at,
         description_embedding, source, original_garment_photo_r2_key,
         original_tag_photo_r2_key, intake_item_id,
         name_override, style_note, color_family
  FROM gp_closet_items;

-- Refresh PostgREST so the API exposes the new columns immediately.
NOTIFY pgrst, 'reload schema';
