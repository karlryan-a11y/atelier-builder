-- 032: a client's category can be the SAME AS a standard one (ADR-0163, 2026-10-02).
--
-- Stylists own a category map per client. Each of a client's categories is kept separate, put
-- INSIDE a standard one (group_label, ADR-0113, unchanged), or made the SAME AS a standard one:
-- "handbags" read as Handbags (slug `bags`), "short" as Shorts. Nothing on a piece is rewritten;
-- this is a reading rule applied where categories are resolved, so it is undone by clearing it.
--
-- Additive and nullable (ADR-0006). No grant changes: the column inherits the table's, and the
-- lookbook already reads this table under RLS `client_categories_read USING (true)`.
alter table public.client_categories add column if not exists same_as text;

comment on column public.client_categories.same_as is
  'Slug this category is read as (ADR-0163). NULL = itself. When set, group_label is ignored.';

notify pgrst, 'reload schema';
