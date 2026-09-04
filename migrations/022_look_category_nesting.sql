-- 022_look_category_nesting.sql
-- Nesting for LOOK categories (ADR-0113, second half).
--
-- Cynthia Dada, on Janet Foutty: "is it possible to merge her categories and then
-- make the looks searchable by that category plus the season? For example, she has
-- the category 'SS Office Casual' and 'FW Office Casual'. I want to make all those
-- looks go into a category called 'Office Casual' but then have the looks in there
-- be searchable by season as well."
--
-- That is nesting: Office Casual on top, the seasonal ones inside it. Tapping the
-- group returns both; tapping a child returns one season. And she does NOT have to
-- merge anything, so no look is re-tagged and nothing is destroyed -- which is the
-- better half of the answer, because a merge cannot be undone.
--
-- Measured on Janet's 16 live categories: 12 are named by season, and four are real
-- SS/FW pairs (Weekend Casual, Easy Professional, Item Capsule, Business
-- Professional). Grouping those takes her from 16 filters to 12. Her example is
-- slightly off -- there is no "FW Office Casual"; she has "FW Office Denim".
--
-- WHY A COLUMN HERE WHEN THE CLOSET NEEDED NONE: client_categories had an unused
-- `group_label` to borrow. look_categories has no spare -- every column is in use,
-- and the only empty one is `description`, which is the stylist styling note from
-- ADR-0110 and is not up for grabs.
--
-- `parent_slug`, not `parent_id`, deliberately: slug is unique per client, it is
-- what the shared tree helpers already speak (src/lib/categoryNesting.ts), and it
-- keeps the looks tree and the closet tree the same shape. Not a foreign key, for
-- the same reason as the closet: a parent needs no row of its own.
--
-- ADDITIVE + NULLABLE ONLY (ADR-0006).

ALTER TABLE look_categories ADD COLUMN IF NOT EXISTS parent_slug text;

COMMENT ON COLUMN look_categories.parent_slug IS
  'The category this one sits inside, as a slug in the same client''s namespace. NULL = top level. Set from the Groups control in Categorize; never inferred. (ADR-0113)';

-- A category cannot be its own parent. Longer cycles are the application's problem
-- (the resolver is depth-capped and tracks visited slugs), but the one-hop case is
-- the one a stylist creates by mis-clicking, and it is free to refuse here.
ALTER TABLE look_categories DROP CONSTRAINT IF EXISTS look_categories_no_self_parent;
ALTER TABLE look_categories ADD CONSTRAINT look_categories_no_self_parent
  CHECK (parent_slug IS NULL OR parent_slug <> slug);

NOTIFY pgrst, 'reload schema';
