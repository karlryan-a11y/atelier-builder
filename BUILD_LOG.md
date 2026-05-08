# Atelier Builder — Build Log

## 2026-05-08

### Phase 0: Project Setup
- Scaffolded Vite + React + TypeScript
- Added Tailwind v4 via `@tailwindcss/vite`, shadcn/ui
- Initial deploy to Vercel (`atelier-builder.vercel.app`)
- Fixed TS 6.0 baseUrl deprecation with `ignoreDeprecations`
- Fixed shadcn files placed in literal `@/` directory instead of `src/`

### Phase 1: Auth + Foundation Schema

**Schema migrations (001, 002, 003):**
- `001_foundation_v2.sql`: ALTERs existing `looks` table (adds nullable builder columns + `source` discriminator). Creates new tables: tag_categories, tags, closet_item_tags, categories, look_items, capsules, capsule_looks, comments, stickers, users, client_assignments. All FKs to existing tables use `text` type to match GoodPix MongoDB ObjectIDs. `boards`/`content_tags` left untouched for scraper compatibility.
- `002_rls_policies.sql`: RLS policies with `is_admin()` and `is_assigned_to_client()` helper functions. Stylists see only assigned clients, admins see all.
- `003_fix_rls_email_match.sql`: Fixed RLS helper functions to match by email from JWT (`auth.jwt() ->> 'email'`) instead of UUID. The `users.id` is auto-generated and doesn't equal `auth.uid()`.

**Decisions:**
- Switched from magic-link to password auth. Magic link had redirect URL issues (Supabase Site URL pointed to atelierlooks.netlify.app) and rate limiting during testing. Password auth is simpler for an internal tool.
- Supabase pooler connection doesn't work programmatically (region mismatch?). All migrations run via SQL Editor for now.
- Vercel GitHub auto-deploy integration failed. Deploying via `vercel --prod --yes` CLI.

**Blockers resolved:**
- Blank screen on production: Vercel env vars (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) weren't set — `.env.local` is gitignored.
- Profile fetch failing: Karl's `users` table entry had a trailing newline in the email field. Fixed via service role API.
- "Margaux Ellery" showing in header: Production still had Phase 0 code (no auth). Redeployed.

**Brand system applied:**
- Copied fonts (Schnyder M Light, Neue Haas Grotesk 300/400/500/700) and logo SVGs from atelier-looks
- Updated CSS with proper WSG color tokens (text, blush, tile, cream, etc.)
- Login page: dark (#1A1A1A) background, white card with blush accent lines, WSG typography
- Header: dark background, inverse logo, uppercase tracking labels

**Auth credentials:**
- Karl Watson: `karl.ryan@watsonstylegroup.com` / `AtelierBuilder2026!` (admin)
- Auth user created via Supabase admin API, password set programmatically
