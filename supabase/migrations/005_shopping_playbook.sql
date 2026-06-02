-- Migration 005: shopping_playbook (OPTIONAL)
-- Run via Supabase SQL Editor only if you want to edit the WSG sourcing playbook
-- WITHOUT a code deploy. Until this table exists, the app uses the bundled
-- DEFAULT_PLAYBOOK in src/lib/shopping-playbook.ts (loadPlaybook falls back
-- gracefully). Once the table has an active row, that row's content is used.
-- Follows ADR-0006: RLS with SELECT USING (true) on shared tables.

create table if not exists shopping_playbook (
  id uuid primary key default gen_random_uuid(),
  content text not null,
  is_active boolean default true,
  updated_by uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table shopping_playbook enable row level security;

create policy "Allow authenticated read" on shopping_playbook for select using (true);
create policy "Allow authenticated write" on shopping_playbook for all using (true) with check (true);

create trigger set_updated_at before update on shopping_playbook
  for each row execute function update_updated_at();

-- To seed: paste the current DEFAULT_PLAYBOOK (from src/lib/shopping-playbook.ts)
-- as the content of one row, then edit it here whenever the team's sourcing
-- standards change:
--   insert into shopping_playbook (content) values ('<paste playbook text>');
