-- Fix RLS policies to match users by email from JWT instead of UUID
-- The users.id is auto-generated and doesn't equal auth.uid()

-- Fix is_admin() to use email matching
create or replace function is_admin()
returns boolean as $$
  select exists (
    select 1 from users
    where email = (auth.jwt() ->> 'email')
    and role = 'admin'
  );
$$ language sql security definer stable;

-- Fix is_assigned_to_client() to use email-based user lookup
create or replace function is_assigned_to_client(p_client_id text)
returns boolean as $$
  select exists (
    select 1 from client_assignments ca
    join users u on u.id = ca.user_id
    where u.email = (auth.jwt() ->> 'email')
    and ca.client_id = p_client_id
  ) or is_admin();
$$ language sql security definer stable;

-- Fix users table select policy
drop policy if exists "users_select_self" on users;
create policy "users_select_self" on users
  for select using (
    email = (auth.jwt() ->> 'email')
    or is_admin()
  );

-- Fix assignments select policy
drop policy if exists "assignments_select" on client_assignments;
create policy "assignments_select" on client_assignments
  for select using (
    exists (
      select 1 from users
      where users.id = client_assignments.user_id
      and users.email = (auth.jwt() ->> 'email')
    )
    or is_admin()
  );
