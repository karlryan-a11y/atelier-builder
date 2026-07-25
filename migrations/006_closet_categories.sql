-- 006_closet_categories.sql
-- Phase B of the closet categorization work (ADR-0025).
-- Adds the stylist-editable category layer: a garment-category override + custom
-- many-to-many groupings on items, plus a per-client category config table.
--
-- ADDITIVE + NULLABLE ONLY (shared-DB hard rules). Run via the Supabase SQL Editor.
--
-- IMPORTANT: `category` and `custom_categories` are DOWNSTREAM-OWNED columns.
-- The goodpix-scraper MUST NEVER write them. Its upsert_closet_items() is
-- column-explicit, so re-syncs preserve these as long as that column list is
-- not expanded to include them (see ADR-0025 "When to revisit").

-- 1. Item-level: garment override (single) + custom groupings (many-to-many).
ALTER TABLE gp_closet_items ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE gp_closet_items ADD COLUMN IF NOT EXISTS custom_categories text[];

-- AI first-pass SUGGESTION (pending stylist approval). The lookbook NEVER reads
-- this — only `category`. The Builder shows it as an "AI suggests …" chip; on
-- Approve the value is copied into `category` (goes live), on Dismiss it's cleared.
-- So no AI guess is ever visible to a client without a stylist signing off.
ALTER TABLE gp_closet_items ADD COLUMN IF NOT EXISTS category_suggested text;

CREATE INDEX IF NOT EXISTS idx_closet_items_category
  ON gp_closet_items(client_id, category);
CREATE INDEX IF NOT EXISTS idx_closet_items_custom_cats
  ON gp_closet_items USING gin (custom_categories);

-- 2. Per-client category config (label / order / visibility / custom categories).
--    Absent rows for a client => the lookbook renders the default template,
--    so uncustomized clients automatically inherit future taxonomy changes.
CREATE TABLE IF NOT EXISTS client_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   text NOT NULL,                  -- soft ref to gp_clients (matches client_* pattern)
  slug        text NOT NULL,                  -- garment slug or a stylist-created custom slug
  label       text NOT NULL,                  -- stylist-facing display name
  kind        text NOT NULL DEFAULT 'garment',-- 'garment' | 'custom'
  group_label text,                           -- display-only section header (Clothing/Accessories/...)
  sort_order  int  NOT NULL DEFAULT 0,
  is_hidden   boolean NOT NULL DEFAULT false,
  created_at  timestamptz DEFAULT now(),
  UNIQUE (client_id, slug)
);

ALTER TABLE client_categories ENABLE ROW LEVEL SECURITY;

-- Lookbook (anon) must be able to read (hard rule: keep SELECT open on shared tables).
DROP POLICY IF EXISTS client_categories_read ON client_categories;
CREATE POLICY client_categories_read ON client_categories
  FOR SELECT USING (true);

-- Writes: authenticated stylists/admins only. Mirror the existing Builder write
-- policy used on the other client_* tables.
DROP POLICY IF EXISTS client_categories_write ON client_categories;
CREATE POLICY client_categories_write ON client_categories
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- NOTE: we intentionally do NOT recreate the `closet_items` view here. CREATE OR
-- REPLACE VIEW must keep the live view's columns as an exact prefix, and a mismatch
-- aborts (and rolls back) the whole migration. The Builder reads these new override
-- columns straight from `gp_closet_items` instead (the lookbook already does), so
-- the view is left untouched. gp_closet_items already has an authenticated UPDATE
-- policy (cynthia_item_write, migration 009), so stylist writes to `category` work.

-- Refresh PostgREST so the API exposes the new columns immediately.
NOTIFY pgrst, 'reload schema';
