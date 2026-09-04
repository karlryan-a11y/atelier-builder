-- 021_category_nesting.sql
-- Nesting categories in the closet (ADR-0113).
--
-- Julia asked for parent categories on Danielle York's Collection: Outerwear as
-- the heading, Jackets and Coats underneath it. Measured on her live rows, her
-- Collection offers 37 flat "Custom" chips in one alphabetical list, and the
-- Jewelry chip returns 41 pieces when she owns 251 -- because Earrings,
-- Necklaces, Bracelets, Rings, Pendants, Time Pieces and Brooches are each their
-- own category with nothing recording that they belong to Jewelry.
--
-- `client_categories` was created by migration 006 in June to hold exactly this
-- per-client taxonomy -- slug, label, kind, group_label, sort_order, is_hidden.
-- It has never had a row and nothing in either repo reads or writes it. This
-- migration adds the one thing it was missing and wires it up.
--
-- WHY A COLUMN AND NOT `group_label`: group_label is display-only text. A parent
-- has to be a category in its own right -- tappable, counted, and holding pieces
-- of its own (58 of Danielle's pieces are filed on Outerwear directly). A text
-- heading cannot be any of those things.
--
-- ADDITIVE + NULLABLE ONLY (shared-DB hard rule, ADR-0006). No renames, no drops,
-- SELECT stays open for the lookbook's anon key.

-- The parent of this category, as a slug in the SAME client's namespace.
-- NULL  => top level.
-- 'tops' => nested under Tops, whether or not Tops has a row of its own (a fixed
--           taxonomy slug is a valid parent and needs no row).
--
-- Deliberately NOT a foreign key to client_categories(client_id, slug): a stylist
-- can nest under a fixed category that has no row, and an FK would reject that.
-- The application resolves parents by slug and drops any that do not resolve.
ALTER TABLE client_categories ADD COLUMN IF NOT EXISTS parent_slug text;

-- Reading a client's whole tree is one query per page render, so index the way
-- it is read: everything for this client, ordered.
CREATE INDEX IF NOT EXISTS idx_client_categories_client
  ON client_categories(client_id, sort_order);

-- A category cannot be its own parent. Cycles longer than one hop are the
-- application's problem (the resolver is depth-capped and tracks visited slugs),
-- but the one-hop case is cheap to refuse outright and is the one a stylist will
-- actually create by mis-clicking a dropdown.
ALTER TABLE client_categories DROP CONSTRAINT IF EXISTS client_categories_no_self_parent;
ALTER TABLE client_categories ADD CONSTRAINT client_categories_no_self_parent
  CHECK (parent_slug IS NULL OR parent_slug <> slug);

-- Refresh PostgREST so the API exposes the new column immediately.
NOTIFY pgrst, 'reload schema';
