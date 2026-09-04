-- Maegan Watson's three homes (ADR-0111). Run AFTER migration 020.
--
-- Slugs chosen to be exactly what the Categorize rail's own slugify() would produce from
-- these labels, so if anyone ever re-creates one by hand it lands on the same key instead of
-- a silent duplicate. The slug is permanent and invisible; the label is theirs to rename.
--
-- These are NEW rows. They do not collide with her existing work-looks-new-york /
-- work-looks-sayulita / work-looks-mexico-city, which stay as ordinary categories.
--
-- Mexico City is deliberately NOT here. Madeline asked for three. If they want it as a
-- fourth home they can tick Home on it themselves, which is the point of ADR-0111.

INSERT INTO look_categories (client_id, slug, label, sort_order, is_hidden, is_residence)
VALUES
  ('6890cc7485fc040b2458bcf3', 'new-york', 'New York', 1, false, true),
  ('6890cc7485fc040b2458bcf3', 'chicago',  'Chicago',  2, false, true),
  ('6890cc7485fc040b2458bcf3', 'sayulita', 'Sayulita', 3, false, true)
ON CONFLICT DO NOTHING;

-- What she will see immediately, and what she will not:
--
--   Collection home picker: New York and Chicago appear at once, because 13 pieces read
--     "new-york-studio" and 27 read "chicago studio" in the legacy category field and the
--     resolver now reads those. Sayulita has no pieces marked yet.
--   Home page tiles: NONE until looks are filed into these three categories. A home with no
--     published looks does not get a tile (ADR-0108), and her 116 published looks are
--     currently filed under occasion categories only.
--
-- So the filing in Categorize is what makes the home page appear. That is Madeline's and
-- Paige's work, not a code step.

SELECT slug, label, sort_order, is_residence
  FROM look_categories
 WHERE client_id = '6890cc7485fc040b2458bcf3'
 ORDER BY is_residence DESC, sort_order;
