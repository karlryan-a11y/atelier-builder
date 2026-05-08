import pg from 'pg'
import { readFileSync } from 'fs'
import { config } from 'dotenv'

config({ path: '.env.local' })

const pool = new pg.Pool({
  connectionString: process.env.SUPABASE_DB_URL || `postgresql://postgres.lejwzpwntjaleqgrcakq:${process.env.SUPABASE_DB_PASSWORD}@aws-0-us-east-1.pooler.supabase.com:5432/postgres`,
  ssl: { rejectUnauthorized: false },
})

const DDL = `
CREATE TABLE IF NOT EXISTS tag_categories (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  category_id TEXT NOT NULL REFERENCES tag_categories(id),
  aliases TEXT[] DEFAULT '{}',
  legacy_content_tag_ids TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(category_id, canonical_name)
);

CREATE TABLE IF NOT EXISTS closet_item_tags (
  closet_item_id TEXT NOT NULL,
  tag_id UUID NOT NULL REFERENCES tags(id),
  PRIMARY KEY (closet_item_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_closet_item_tags_tag ON closet_item_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_tags_category ON tags(category_id);

ALTER TABLE tag_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE closet_item_tags ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='tag_categories' AND policyname='tag_categories_select') THEN
    CREATE POLICY tag_categories_select ON tag_categories FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='tags' AND policyname='tags_select') THEN
    CREATE POLICY tags_select ON tags FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='closet_item_tags' AND policyname='closet_item_tags_select') THEN
    CREATE POLICY closet_item_tags_select ON closet_item_tags FOR SELECT USING (true);
  END IF;
END $$;
`

async function main() {
  const client = await pool.connect()
  try {
    console.log('Connected to Postgres. Running DDL...')
    await client.query(DDL)
    console.log('Tables created successfully!')

    const { rows } = await client.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ('tag_categories', 'tags', 'closet_item_tags')
      ORDER BY table_name
    `)
    console.log('Verified tables:', rows.map(r => r.table_name))
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch(e => { console.error(e); process.exit(1) })
