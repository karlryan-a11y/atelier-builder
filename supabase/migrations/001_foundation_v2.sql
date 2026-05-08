-- Phase 1: Foundation schema migration (v2)
--
-- Existing GoodPix tables (DO NOT recreate):
--   looks, boards, clients, closet_items, content_tags, images
-- All use text IDs (MongoDB ObjectIDs). Scraper continues to write to these.
--
-- Strategy:
--   - ADD new columns to existing tables (nullable, won't break scraper)
--   - CREATE new tables for builder-only concepts
--   - A 'source' column distinguishes scraped vs builder-created rows

-- Enable pgvector (needed for Phase 5 embeddings)
create extension if not exists vector;

-- ============================================================
-- Extend existing looks table with builder columns
-- Scraper inserts will leave these NULL — that's fine.
-- ============================================================

alter table looks add column if not exists canvas_state jsonb;
alter table looks add column if not exists thumbnail_url text;
alter table looks add column if not exists tags text[];
alter table looks add column if not exists notes_internal text;
alter table looks add column if not exists notes_client text;
alter table looks add column if not exists created_by uuid references auth.users(id);
alter table looks add column if not exists source text default 'goodpix';

create index if not exists looks_tags_gin on looks using gin (tags);
create index if not exists looks_client_id on looks(client_id);
create index if not exists looks_source on looks(source);

-- ============================================================
-- Canonicalized tag system
-- Replaces content_tags over time (Phase 4). content_tags stays untouched.
-- ============================================================

create table if not exists tag_categories (
  id uuid primary key default gen_random_uuid(),
  name text unique,
  display_order int,
  client_visible boolean default true,
  created_at timestamptz default now()
);

create table if not exists tags (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references tag_categories(id),
  canonical_name text,
  display_name text,
  aliases text[],
  display_order int,
  created_at timestamptz default now(),
  unique(category_id, canonical_name)
);

create table if not exists closet_item_tags (
  closet_item_id text references closet_items(id) on delete cascade,
  tag_id uuid references tags(id) on delete cascade,
  primary key (closet_item_id, tag_id)
);

-- ============================================================
-- Categories (per-client custom override of garment_type tags)
-- ============================================================

create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  client_id text references clients(id),
  name text,
  display_order int,
  icon text,
  created_at timestamptz default now()
);

-- ============================================================
-- look_items junction (text FK to match looks.id)
-- ============================================================

create table if not exists look_items (
  look_id text references looks(id) on delete cascade,
  closet_item_id text references closet_items(id) on delete cascade,
  primary key (look_id, closet_item_id)
);

-- ============================================================
-- Capsules — NEW table (separate from GoodPix boards)
-- boards table stays for scraper; capsules is builder-only.
-- ============================================================

create table if not exists capsules (
  id uuid primary key default gen_random_uuid(),
  client_id text references clients(id),
  name text,
  canvas_state jsonb,
  thumbnail_url text,
  tags text[],
  trip_dates daterange,
  notes_internal text,
  notes_client text,
  created_by uuid references auth.users(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists capsules_tags_gin on capsules using gin (tags);
create index if not exists capsules_client_id on capsules(client_id);

-- Junction: capsules reference looks (text FK)
create table if not exists capsule_looks (
  capsule_id uuid references capsules(id) on delete cascade,
  look_id text references looks(id) on delete cascade,
  primary key (capsule_id, look_id)
);

-- ============================================================
-- Pinned comments (item, look, or capsule level)
-- ============================================================

create table if not exists comments (
  id uuid primary key default gen_random_uuid(),
  parent_type text check (parent_type in ('closet_item', 'look', 'capsule')),
  parent_id text,
  pin_x float,
  pin_y float,
  body text,
  visibility text check (visibility in ('internal', 'client')) default 'internal',
  created_by uuid references auth.users(id),
  created_at timestamptz default now()
);

-- ============================================================
-- Branded stickers library
-- ============================================================

create table if not exists stickers (
  id uuid primary key default gen_random_uuid(),
  brand text,
  variant text,
  asset_url text,
  display_order int,
  created_at timestamptz default now()
);

-- ============================================================
-- Stylist users (app-level profile, linked to auth.users by email)
-- ============================================================

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  display_name text,
  role text check (role in ('admin', 'stylist', 'support')),
  created_at timestamptz default now()
);

create table if not exists client_assignments (
  user_id uuid references users(id),
  client_id text references clients(id),
  primary key (user_id, client_id)
);

-- ============================================================
-- Vector embeddings on closet items (for AI matching, Phase 5)
-- ============================================================

alter table closet_items add column if not exists description_embedding vector(1536);
create index if not exists closet_items_embedding_hnsw on closet_items using hnsw (description_embedding vector_cosine_ops);

-- ============================================================
-- Enable Row Level Security on all new tables
-- (existing tables like looks/closet_items may already have RLS)
-- ============================================================

alter table tag_categories enable row level security;
alter table tags enable row level security;
alter table closet_item_tags enable row level security;
alter table categories enable row level security;
alter table looks enable row level security;
alter table look_items enable row level security;
alter table capsules enable row level security;
alter table capsule_looks enable row level security;
alter table comments enable row level security;
alter table stickers enable row level security;
alter table users enable row level security;
alter table client_assignments enable row level security;
