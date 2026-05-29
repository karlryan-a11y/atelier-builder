-- Migration 004: Shopping workflow tables
-- Client profile tables (shared, no prefix) + shopping workflow tables (shopping_ prefix)
-- Run via Supabase SQL Editor
-- Follows ADR-0006: RLS with SELECT USING (true) on shared tables
-- Follows ADR-0008: shopping_ prefix convention

-- ============================================================
-- Client Profile Tables (shared across builder features)
-- ============================================================

-- Extended profile data for clients — sizes, measurements, style preferences
-- References gp_clients via the clients compatibility view
create table if not exists client_profiles (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,  -- soft ref to clients (a view over gp_clients; FK to a view is not allowed)

  -- Default sizes per category
  size_top text,
  size_bottom text,
  size_dress text,
  size_outerwear text,
  size_shoe text,
  size_intimates text,
  size_accessories text,

  -- Measurements: CURRENT snapshot for convenience. Full dated history lives
  -- in client_measurements (see below). On a new measurement, write a row there
  -- AND refresh this snapshot.
  measurements jsonb default '{}',

  -- Body identity (lead fields on every Cheat Sheet — drive sourcing)
  body_type text,
  color_season text,

  -- Per-category fit preferences keyed by category, e.g.
  -- {"top": {"size": "M", "fit": "relaxed through shoulder"}, ...}
  -- Default sizes above are the quick denormalized view; this holds the nuance.
  fit_notes jsonb default '{}',

  -- Style identity
  style_story text,
  occasions text[],
  color_palette jsonb default '{}',
  fabric_preferences jsonb default '{}',

  -- Logistics
  ship_to_primary jsonb,
  ship_to_alternate jsonb,

  -- No-fly list — silhouettes, details, prints client doesn't wear
  no_fly_list text,

  -- Gap notes — what client already owns
  gap_notes text,

  -- Return tolerance (WSG-set)
  return_tolerance text default 'standard' check (return_tolerance in ('standard', 'aggressive', 'conservative')),

  -- Provenance — where this profile data came from
  source text default 'intake_form' check (source in ('intake_form', 'historical_import', 'session', 'manual')),

  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  unique(client_id)
);

-- Dated measurement snapshots — the Style Profiles carry versioned measurements
-- (bodies change; we keep history rather than overwrite). The latest row also
-- refreshes client_profiles.measurements for quick reads.
create table if not exists client_measurements (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,  -- soft ref to clients (a view over gp_clients; FK to a view is not allowed)

  -- Date the measurements were taken (not the row insert time)
  measured_on date not null,

  -- Structured measurements, e.g.
  -- {"bust": 36, "waist": 28, "hips": 38, "inseam": 30, "height": "5'6\"", ...}
  measurements jsonb not null default '{}',

  measured_by uuid,
  source text default 'intake_form' check (source in ('intake_form', 'historical_import', 'session', 'manual')),
  note text,
  created_at timestamptz default now(),

  unique(client_id, measured_on)
);

-- Brand-specific sizing map — the core of the styling intelligence moat
-- Updates on every keep/return cycle
create table if not exists client_brand_sizing (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,  -- soft ref to clients (a view over gp_clients; FK to a view is not allowed)
  brand text not null,
  category text not null check (category in ('top', 'bottom', 'dress', 'outerwear', 'shoe', 'intimates', 'accessory')),
  size text not null,
  fit_note text,
  confidence text default 'worn_once' check (confidence in ('worn_once', 'worn_multiple', 'confirmed_keeper')),
  last_updated timestamptz default now(),

  unique(client_id, brand, category)
);

-- Structured brand preferences — allowlist, neutral, blocklist
create table if not exists client_brand_preferences (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,  -- soft ref to clients (a view over gp_clients; FK to a view is not allowed)
  brand text not null,
  preference text not null check (preference in ('preferred', 'neutral', 'blocked')),
  note text,
  created_at timestamptz default now(),

  unique(client_id, brand)
);

-- Free-text stylist observations — timestamped, tagged by context
-- This is the "stylist talking out loud" data that builds intelligence over time
create table if not exists client_notes (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,  -- soft ref to clients (a view over gp_clients; FK to a view is not allowed)
  stylist_id uuid,
  note_type text default 'general' check (note_type in ('general', 'style', 'fit', 'preference', 'session', 'shopping')),
  content text not null,
  session_id uuid,
  created_at timestamptz default now()
);

-- ============================================================
-- Shopping Workflow Tables (shopping_ prefix)
-- ============================================================

-- A buying season for a client (e.g. "FW23", "SS26"). Tracks the seasonal
-- budget and open-to-buy (OTB) carried over from the prior season — the
-- Client Notes track both, and carryover can't be expressed on a single session.
create table if not exists shopping_seasons (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,  -- soft ref to clients (a view over gp_clients; FK to a view is not allowed)

  label text not null,              -- "FW23", "SS26", etc.
  season_type text check (season_type in ('SS', 'FW', 'resort', 'pre_fall', 'other')),
  year int,

  -- Budgeting
  budget_total numeric,             -- planned spend for the season
  otb_carryover numeric default 0,  -- open-to-buy carried in from prior season
  spent_to_date numeric default 0,  -- rolling actual, updated as orders land

  status text default 'planning' check (status in ('planning', 'active', 'closed')),
  notes text,
  source text default 'intake_form' check (source in ('intake_form', 'historical_import', 'session', 'manual')),

  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  unique(client_id, label)
);

-- A shopping session tied to a client + stylist
create table if not exists shopping_sessions (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,  -- soft ref to clients (a view over gp_clients; FK to a view is not allowed)
  season_id uuid references shopping_seasons(id) on delete set null,
  stylist_id uuid,
  assistant_stylist_id uuid,

  status text default 'draft' check (status in (
    'draft',
    'brief_locked',
    'sourcing',
    'review_round_1',
    'review_round_2',
    'cart_ready',
    'checkout',
    'ordered',
    'delivered',
    'tryon',
    'complete'
  )),

  -- Budget
  budget_total numeric,
  budget_per_slot jsonb default '{}',

  -- Logistics
  deliver_by date,
  ship_to jsonb,

  -- Cowork integration
  cowork_prompt_md text,
  cowork_output_raw text,

  -- Timestamps
  brief_locked_at timestamptz,
  sourcing_started_at timestamptz,
  review_started_at timestamptz,
  checkout_at timestamptz,
  completed_at timestamptz,

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Individual items to shop for — the slot list
create table if not exists shopping_slots (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references shopping_sessions(id) on delete cascade,

  description text not null,
  category text,
  quality_bar text default 'daily_rotation' check (quality_bar in ('daily_rotation', 'hero_piece')),
  budget_guidance numeric,
  slot_notes text,

  status text default 'pending' check (status in ('pending', 'sourced', 'approved', 'rejected', 'escalated')),
  display_order int default 0,

  created_at timestamptz default now()
);

-- Product options found by Cowork — 3 per slot for round 1, alternates for round 2
create table if not exists shopping_options (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid references shopping_slots(id) on delete cascade,
  session_id uuid references shopping_sessions(id) on delete cascade,

  round int default 1 check (round in (1, 2)),

  -- Product data
  product_name text,
  brand text,
  retailer text,
  price numeric,
  currency text default 'USD',
  product_url text,
  image_url text,
  image_r2_key text,

  -- Availability
  sizes_available text[],
  colors_available text[],
  selected_size text,
  selected_color text,

  -- Logistics
  ship_timeline text,
  return_policy text,
  in_stock boolean default true,

  -- Intelligence
  confidence text default 'low' check (confidence in ('high', 'medium', 'low')),

  -- Commission (backend only — stylist never sees this)
  commission_rate numeric,
  commission_source text,

  -- Consignment tracking
  is_consignment boolean default false,

  created_at timestamptz default now()
);

-- Stylist review actions on options
create table if not exists shopping_reviews (
  id uuid primary key default gen_random_uuid(),
  option_id uuid references shopping_options(id) on delete cascade,
  session_id uuid references shopping_sessions(id) on delete cascade,

  action text not null check (action in ('approve', 'reject', 'swap')),
  round int default 1,

  -- Rejection reason tags (structured signal for the moat)
  rejection_reasons text[],

  -- Swap / feedback note (qualitative gold)
  feedback_note text,

  -- Size/color change on approve
  size_override text,
  color_override text,

  reviewed_by uuid,
  reviewed_at timestamptz default now()
);

-- Completed orders per retailer
create table if not exists shopping_orders (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references shopping_sessions(id) on delete cascade,

  retailer text,
  order_number text,
  order_total numeric,
  order_confirmation_url text,
  tracking_number text,
  tracking_url text,

  -- Affiliate
  affiliate_link_used boolean default false,
  affiliate_source text,

  status text default 'placed' check (status in ('placed', 'shipped', 'delivered', 'partial_return', 'full_return')),

  placed_at timestamptz default now(),
  shipped_at timestamptz,
  delivered_at timestamptz
);

-- Junction: which options belong to which order
create table if not exists shopping_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references shopping_orders(id) on delete cascade,
  option_id uuid references shopping_options(id) on delete cascade,

  final_size text,
  final_color text,
  final_price numeric,

  unique(order_id, option_id)
);

-- Try-on results — post-fitting lifecycle
create table if not exists shopping_tryon (
  id uuid primary key default gen_random_uuid(),
  option_id uuid references shopping_options(id) on delete cascade,
  session_id uuid references shopping_sessions(id) on delete cascade,
  order_item_id uuid references shopping_order_items(id),

  result text not null check (result in ('kept', 'returned', 'exchanged')),
  reason text,
  exchange_details text,

  -- When kept, this links to the closet item created
  closet_item_id text,  -- soft ref to closet_items (a view; FK to a view is not allowed)

  reviewed_by uuid,
  reviewed_at timestamptz default now()
);

-- ============================================================
-- Retailer + Commission reference table (for future commission optimization)
-- ============================================================

create table if not exists shopping_retailers (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  domain text,
  affiliate_program text,
  affiliate_id text,
  default_commission_rate numeric,
  return_policy_default text,
  ship_timeline_default text,
  is_active boolean default true,
  notes text,
  created_at timestamptz default now()
);

-- Brand-retailer commission rates (for same-item commission optimization)
create table if not exists shopping_brand_commissions (
  id uuid primary key default gen_random_uuid(),
  retailer_id uuid references shopping_retailers(id) on delete cascade,
  brand text not null,
  commission_rate numeric,
  commission_type text default 'percentage' check (commission_type in ('percentage', 'flat')),
  updated_at timestamptz default now(),

  unique(retailer_id, brand)
);

-- ============================================================
-- Indexes
-- ============================================================

create index if not exists idx_client_profiles_client on client_profiles(client_id);
create index if not exists idx_client_measurements_client on client_measurements(client_id);
create index if not exists idx_client_measurements_date on client_measurements(client_id, measured_on desc);
create index if not exists idx_shopping_seasons_client on shopping_seasons(client_id);
create index if not exists idx_shopping_sessions_season on shopping_sessions(season_id);
create index if not exists idx_client_brand_sizing_client on client_brand_sizing(client_id);
create index if not exists idx_client_brand_sizing_brand on client_brand_sizing(brand);
create index if not exists idx_client_brand_prefs_client on client_brand_preferences(client_id);
create index if not exists idx_client_notes_client on client_notes(client_id);
create index if not exists idx_client_notes_type on client_notes(note_type);

create index if not exists idx_shopping_sessions_client on shopping_sessions(client_id);
create index if not exists idx_shopping_sessions_status on shopping_sessions(status);
create index if not exists idx_shopping_slots_session on shopping_slots(session_id);
create index if not exists idx_shopping_options_slot on shopping_options(slot_id);
create index if not exists idx_shopping_options_session on shopping_options(session_id);
create index if not exists idx_shopping_reviews_option on shopping_reviews(option_id);
create index if not exists idx_shopping_reviews_session on shopping_reviews(session_id);
create index if not exists idx_shopping_orders_session on shopping_orders(session_id);
create index if not exists idx_shopping_tryon_session on shopping_tryon(session_id);
create index if not exists idx_shopping_tryon_option on shopping_tryon(option_id);

-- ============================================================
-- RLS — keep SELECT open per ADR-0006
-- ============================================================

alter table client_profiles enable row level security;
alter table client_measurements enable row level security;
alter table shopping_seasons enable row level security;
alter table client_brand_sizing enable row level security;
alter table client_brand_preferences enable row level security;
alter table client_notes enable row level security;
alter table shopping_sessions enable row level security;
alter table shopping_slots enable row level security;
alter table shopping_options enable row level security;
alter table shopping_reviews enable row level security;
alter table shopping_orders enable row level security;
alter table shopping_order_items enable row level security;
alter table shopping_tryon enable row level security;
alter table shopping_retailers enable row level security;
alter table shopping_brand_commissions enable row level security;

-- Open SELECT for all authenticated users (matches existing pattern)
create policy "Allow authenticated read" on client_profiles for select using (true);
create policy "Allow authenticated read" on client_measurements for select using (true);
create policy "Allow authenticated read" on shopping_seasons for select using (true);
create policy "Allow authenticated read" on client_brand_sizing for select using (true);
create policy "Allow authenticated read" on client_brand_preferences for select using (true);
create policy "Allow authenticated read" on client_notes for select using (true);
create policy "Allow authenticated read" on shopping_sessions for select using (true);
create policy "Allow authenticated read" on shopping_slots for select using (true);
create policy "Allow authenticated read" on shopping_options for select using (true);
create policy "Allow authenticated read" on shopping_reviews for select using (true);
create policy "Allow authenticated read" on shopping_orders for select using (true);
create policy "Allow authenticated read" on shopping_order_items for select using (true);
create policy "Allow authenticated read" on shopping_tryon for select using (true);
create policy "Allow authenticated read" on shopping_retailers for select using (true);
create policy "Allow authenticated read" on shopping_brand_commissions for select using (true);

-- Allow authenticated users to insert/update/delete (internal tool, all stylists trusted)
create policy "Allow authenticated write" on client_profiles for all using (true) with check (true);
create policy "Allow authenticated write" on client_measurements for all using (true) with check (true);
create policy "Allow authenticated write" on shopping_seasons for all using (true) with check (true);
create policy "Allow authenticated write" on client_brand_sizing for all using (true) with check (true);
create policy "Allow authenticated write" on client_brand_preferences for all using (true) with check (true);
create policy "Allow authenticated write" on client_notes for all using (true) with check (true);
create policy "Allow authenticated write" on shopping_sessions for all using (true) with check (true);
create policy "Allow authenticated write" on shopping_slots for all using (true) with check (true);
create policy "Allow authenticated write" on shopping_options for all using (true) with check (true);
create policy "Allow authenticated write" on shopping_reviews for all using (true) with check (true);
create policy "Allow authenticated write" on shopping_orders for all using (true) with check (true);
create policy "Allow authenticated write" on shopping_order_items for all using (true) with check (true);
create policy "Allow authenticated write" on shopping_tryon for all using (true) with check (true);
create policy "Allow authenticated write" on shopping_retailers for all using (true) with check (true);
create policy "Allow authenticated write" on shopping_brand_commissions for all using (true) with check (true);

-- ============================================================
-- Updated_at trigger
-- ============================================================

create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger set_updated_at before update on client_profiles
  for each row execute function update_updated_at();

create trigger set_updated_at before update on shopping_seasons
  for each row execute function update_updated_at();

create trigger set_updated_at before update on shopping_sessions
  for each row execute function update_updated_at();
