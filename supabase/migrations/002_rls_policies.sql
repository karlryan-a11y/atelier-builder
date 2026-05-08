-- Phase 1: RLS Policies
-- Stylists see only their assigned clients. Admins see all.
-- Service role bypasses RLS automatically.

-- Helper function: check if current user is admin
create or replace function is_admin()
returns boolean as $$
  select exists (
    select 1 from users
    where id = auth.uid()
    and role = 'admin'
  );
$$ language sql security definer stable;

-- Helper function: check if current user is assigned to a client
create or replace function is_assigned_to_client(p_client_id text)
returns boolean as $$
  select exists (
    select 1 from client_assignments
    where user_id = auth.uid()
    and client_id = p_client_id
  ) or is_admin();
$$ language sql security definer stable;

-- ============================================================
-- users table: users can read themselves, admins can read/write all
-- ============================================================

create policy "users_select_self" on users
  for select using (id = auth.uid() or is_admin());

create policy "users_insert_admin" on users
  for insert with check (is_admin());

create policy "users_update_admin" on users
  for update using (is_admin());

create policy "users_delete_admin" on users
  for delete using (is_admin());

-- ============================================================
-- client_assignments: admins manage, users can see their own
-- ============================================================

create policy "assignments_select" on client_assignments
  for select using (user_id = auth.uid() or is_admin());

create policy "assignments_insert_admin" on client_assignments
  for insert with check (is_admin());

create policy "assignments_delete_admin" on client_assignments
  for delete using (is_admin());

-- ============================================================
-- looks: scoped to assigned clients
-- ============================================================

create policy "looks_select" on looks
  for select using (is_assigned_to_client(client_id));

create policy "looks_insert" on looks
  for insert with check (is_assigned_to_client(client_id));

create policy "looks_update" on looks
  for update using (is_assigned_to_client(client_id));

create policy "looks_delete" on looks
  for delete using (is_assigned_to_client(client_id));

-- ============================================================
-- look_items: follows look access
-- ============================================================

create policy "look_items_select" on look_items
  for select using (
    exists (select 1 from looks where looks.id = look_id and is_assigned_to_client(looks.client_id))
  );

create policy "look_items_insert" on look_items
  for insert with check (
    exists (select 1 from looks where looks.id = look_id and is_assigned_to_client(looks.client_id))
  );

create policy "look_items_delete" on look_items
  for delete using (
    exists (select 1 from looks where looks.id = look_id and is_assigned_to_client(looks.client_id))
  );

-- ============================================================
-- capsules: scoped to assigned clients
-- ============================================================

create policy "capsules_select" on capsules
  for select using (is_assigned_to_client(client_id));

create policy "capsules_insert" on capsules
  for insert with check (is_assigned_to_client(client_id));

create policy "capsules_update" on capsules
  for update using (is_assigned_to_client(client_id));

create policy "capsules_delete" on capsules
  for delete using (is_assigned_to_client(client_id));

-- ============================================================
-- capsule_looks: follows capsule access
-- ============================================================

create policy "capsule_looks_select" on capsule_looks
  for select using (
    exists (select 1 from capsules where capsules.id = capsule_id and is_assigned_to_client(capsules.client_id))
  );

create policy "capsule_looks_insert" on capsule_looks
  for insert with check (
    exists (select 1 from capsules where capsules.id = capsule_id and is_assigned_to_client(capsules.client_id))
  );

create policy "capsule_looks_delete" on capsule_looks
  for delete using (
    exists (select 1 from capsules where capsules.id = capsule_id and is_assigned_to_client(capsules.client_id))
  );

-- ============================================================
-- comments: scoped to parent's client access
-- ============================================================

create policy "comments_select" on comments
  for select using (
    (parent_type = 'look' and exists (
      select 1 from looks where looks.id::text = parent_id and is_assigned_to_client(looks.client_id)
    ))
    or (parent_type = 'capsule' and exists (
      select 1 from capsules where capsules.id::text = parent_id and is_assigned_to_client(capsules.client_id)
    ))
    or (parent_type = 'closet_item' and exists (
      select 1 from closet_items where closet_items.id = parent_id and is_assigned_to_client(closet_items.client_id)
    ))
  );

create policy "comments_insert" on comments
  for insert with check (true);

create policy "comments_update" on comments
  for update using (created_by = auth.uid() or is_admin());

create policy "comments_delete" on comments
  for delete using (created_by = auth.uid() or is_admin());

-- ============================================================
-- tag_categories, tags, closet_item_tags: readable by all authenticated
-- ============================================================

create policy "tag_categories_select" on tag_categories
  for select using (auth.uid() is not null);

create policy "tag_categories_admin" on tag_categories
  for all using (is_admin());

create policy "tags_select" on tags
  for select using (auth.uid() is not null);

create policy "tags_admin" on tags
  for all using (is_admin());

create policy "closet_item_tags_select" on closet_item_tags
  for select using (auth.uid() is not null);

create policy "closet_item_tags_admin" on closet_item_tags
  for all using (is_admin());

-- ============================================================
-- categories: readable by all authenticated, admin manages
-- ============================================================

create policy "categories_select" on categories
  for select using (auth.uid() is not null);

create policy "categories_admin" on categories
  for all using (is_admin());

-- ============================================================
-- stickers: readable by all authenticated, admin manages
-- ============================================================

create policy "stickers_select" on stickers
  for select using (auth.uid() is not null);

create policy "stickers_admin" on stickers
  for all using (is_admin());
