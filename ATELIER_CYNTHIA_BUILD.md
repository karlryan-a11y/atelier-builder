# Atelier Builder — STAGING Build (Master Brief)

**You are a fresh Claude Code session with no memory of how this file was created. Read this whole file before touching anything.**

This staging build has **two workstreams. Build them in order:**
1. **Workstream 1 — Styling/Lookbook parity (this file).** Fully autonomous, parity-blocking, self-contained. Build and verify it completely first.
2. **Workstream 2 — Client ↔ Stylist Chat (`ATELIER_CHAT_BUILD.md`).** Bigger, partly greenfield (a PWA + Slack + push + SLA cron), and partly credential-gated (Slack app, Resend, test destinations from Karl). Build everything that doesn't need a secret; batch one consolidated ask for the rest; **never message a real client during the staging build** (see that file's §0c).

Both workstreams share the **HARD GUARDRAILS** below and the **§7 staging-only deploy**. Keep one running `BUILD_LOG.md` and one final `CYNTHIA_BUILD_REPORT.md` covering both.

---

## Workstream 1 — Cynthia Styling-Parity Build

It is the complete spec for Workstream 1.

Mission: implement the styling/lookbook feature set below so WSG stylists can stop using GoodPix for styling. Build and verify **entirely on the STAGING stack**. Do not touch live. When done, write a report and stop — Karl promotes to live himself.

Repo: `~/atelier-builder` (Vite + React + TS, Konva/react-konva canvas, Supabase, zustand, dnd-kit, TanStack Query, shadcn/base-ui, Cloudflare R2).

---

## HARD GUARDRAILS — violating any of these is a failed run

1. **NEVER deploy to live.** The repo's `.vercel/project.json` is linked to the **live** project `atelier-builder` (`prj_myJjUDCtBU70DajBFi6sB1cb8qxP`). Therefore:
   - **DO NOT run `npm run deploy`, `npm run ship`, or any bare `vercel deploy`/`vercel --prod`.** Those push to LIVE PROD.
   - Deploy to staging ONLY via the explicit env-var-scoped command in §7.
2. **NEVER run migrations/SQL against live Supabase** (`lejwzpwntjaleqgrcakq`). All schema work targets **staging Supabase `yuoxmcujmpfuujjchkcl`** only. Triple-check the project ref before every `supabase`/SQL call.
3. **Schema changes are ADDITIVE + NULLABLE only.** New columns nullable, new tables fine. No `DROP`, no `ALTER ... TYPE`, no `NOT NULL` on existing tables, no destructive backfills.
4. **Shared-table RLS rules (these tables are read by the public lookbook with the anon key, no auth session):**
   - Keep every existing/new shared table's `SELECT` policy `USING (true)`. Do **not** add restrictive SELECT policies to `gp_looks`, `gp_closet_items`, `gp_clients`, `look_items`, `client_categories`, etc.
   - Restrict only INSERT/UPDATE/DELETE (to `authenticated`), mirroring `client_categories_write`.
5. **Never touch Supabase Auth passwords / existing auth users.** Don't create or modify auth users.
6. **Scraper-owned vs downstream-owned columns.** The GoodPix scraper does column-explicit upserts into `gp_closet_items` and will **overwrite** any column in its write list on the next sync. `category` and `custom_categories` are already safe downstream-owned columns. **Any new editable item field (name override, color, style note) MUST be a NEW downstream-owned column the scraper never writes** — do NOT make the builder write the scraper's `name`/`title` column directly, or stylist edits get clobbered on re-sync. Use override columns.
7. **Don't clobber Karl's WIP.** `main` has uncommitted work. Work on a dedicated branch (§2). Never `git checkout .`/`reset --hard`/`stash drop` against his changes.
8. **Stay on staging data.** Confirm `.env.local` points at the staging Supabase host (`yuoxmcuj...`) before running the app or any data test (§2).

If any guardrail blocks the task, STOP and write the blocker into `BUILD_LOG.md` rather than working around it.

---

## 1. Context: what we're building and why

WSG is a luxury personal-styling firm migrating its stylists off GoodPix onto Atelier. Stylists build "looks" (outfit collages) on a Konva canvas from a client's digitized closet ("garments"/"closet items"), organize looks into categories, group looks into "capsules" (e.g. packing capsules for a trip), and publish to each client's lookbook. This batch closes the GoodPix-parity gaps the lead stylist (Cynthia) called out. Source of truth for the asks is §3.

Key existing pieces you'll touch:
- Canvas: `src/components/canvas/` — `LookCanvas.tsx`, `CanvasToolbar.tsx`, `LookGallery.tsx`, `SaveLookDialog.tsx`, `CanvasAdapter.ts`
- Canvas model: `src/types/canvas.ts`, `src/stores/canvasStore.ts`
- Data hooks: `src/hooks/useClosetItems.ts`, `src/hooks/useLooks.ts`, `src/hooks/useCanvasImages.ts`, `src/hooks/useClients.ts`
- Collection/closet UI: `src/components/intake/` (item cards/detail), plus wherever the client collection grid + Looks list render
- Schema so far: `supabase/migrations/001_foundation_v2.sql` … `005_…`, and `migrations/006_closet_categories.sql`. Add new migrations as `migrations/007_*.sql`, `008_*.sql`, … (sequential).

Schema facts you can rely on (verify against the live staging DB before writing migrations):
- Core tables use a `gp_` prefix: `gp_closet_items`, `gp_clients`, `gp_looks`, `gp_boards`.
- `gp_closet_items` already has `category text` (single garment override) and `custom_categories text[]` (downstream-owned, scraper never writes).
- `client_categories` (per-client garment-category config: `slug,label,kind,group_label,sort_order,is_hidden`) already exists — this is the **collection/garment** taxonomy.
- `gp_looks` has builder columns: `canvas_state jsonb`, `tags text[]` (string tags — the bulk-rename footgun), `notes_internal`, `notes_client`, `thumbnail_url`, `source`, `client_id`.
- `look_items` junction: `(look_id text, closet_item_id text)`.
- `TextNode` (canvas) currently has only `content, font_family, font_size, fill, x, y, rotation, z_index` — no bold/underline/align/width yet.
- `LookCanvasState.canvas` is `{width,height,background}`; look default is portrait `1200×1500`.

---

## 2. Setup (do this first, in order)

1. **Branch cleanly without disturbing WIP:**
   ```bash
   cd ~/atelier-builder
   git stash push -u -m "cynthia-build-autostash" || true   # park Karl's WIP safely (recoverable)
   git checkout -b feature/cynthia-styling
   git stash pop || true                                     # restore WIP onto the new branch
   ```
   If `stash pop` conflicts, STOP and log it — do not force.
2. **Point the app at STAGING:**
   ```bash
   cp -n .env.local .env.local.live.bak    # back up the live env once
   cp .env.staging.local .env.local        # staging Supabase (yuoxmcuj...) — prepared for you
   ```
   Confirm: `grep VITE_SUPABASE_URL .env.local` must show `yuoxmcuj`. If it shows `lejwzpwntjaleqgrcakq` (live), STOP.
3. **Install + boot:** `npm install` then `npm run dev`. Use the preview tooling to load the app and confirm it connects to staging.
4. **Verify staging has stylable test data.** You need at least one client with closet items AND a few looks to exercise color search, category filter, looks categories, and the large-look viewer. Query staging `gp_clients`/`gp_closet_items`/`gp_looks`. **If there's no usable test client, seed one** (e.g. a `client_test_cynthia` with ~15 garments across categories + 4–5 looks, images can reuse existing R2 URLs already present in staging). Log what you seeded. Never seed into live.
5. Create/append `BUILD_LOG.md` with a "Cynthia build" section; keep it current with decisions, schema choices, and blockers as you go.

---

## 3. Features to build

Group A is launch-blocking. Build A → B → C in order; verify each before moving on. Each item lists **Acceptance** = the observable behavior that proves it's done.

### GROUP A — launch blockers

**A1. Category filter rail on the Style canvas (garment palette).**
- The left-hand garment palette in the styling view must be filterable by the client's garment categories (reuse the `client_categories` taxonomy + `gp_closet_items.category`/`custom_categories`). Multi-select chips with counts; "All" default.
- Acceptance: in the styling view, clicking "Bags" shows only that client's bags; multi-select unions; counts match.

**A2. Search the collection by color.**
- Add structured color to garments and make search use it. Today color only matches when it's in the item title.
- Schema (migration `007`): `ALTER TABLE gp_closet_items ADD COLUMN IF NOT EXISTS color text;` (downstream-owned — scraper must never write it). Optionally `color_family text` for normalized buckets (blue/navy/red/...). Index `(client_id, color_family)`.
- Populate: map the digitization AI's existing color description into the structured `color`/`color_family` on approval, and provide a backfill for already-approved items (derive `color_family` from existing description/title text). Log coverage %.
- Search: collection/palette search must match across name(+override), `color`, `color_family`, and description.
- Acceptance: searching "blue" returns blue items that do NOT have "blue" in their name; "navy" and "blue" are distinguishable.

**A3. Edit item metadata after it's already in the lookbook.**
- Inline edit on any garment (in collection AND in the styling palette detail) for: **name, color, category, custom categories**.
- Name editing MUST write a downstream-owned override, not the scraper's title. Migration `007`: `ALTER TABLE gp_closet_items ADD COLUMN IF NOT EXISTS name_override text;`. Everywhere the UI shows an item name, use `coalesce(name_override, <scraper name/title col>)`.
- Acceptance: rename one garment to "Navy Valentino pants", reload — change persists; color edit persists; a simulated scraper re-sync (re-running its column-explicit upsert) does NOT erase the override (reason about the scraper's write-list; document it).

**A4. Looks categories = their own per-client taxonomy, customizable, carried over from GoodPix.**
- The Looks page currently shows *garment* categories (hats/pants/bags) — wrong. Looks need a **separate** taxonomy.
- Schema (migration `008`): create `look_categories` (mirror `client_categories`): `id uuid pk, client_id text, slug text, label text, sort_order int, is_hidden bool, created_at` + `UNIQUE(client_id, slug)`; RLS SELECT `USING(true)`, write `authenticated`. Assign looks by **ID**, not string: either add `gp_looks.look_category_id uuid` (nullable) or a `look_category_assignments(look_id text, look_category_id uuid)` junction. **Do not** drive categories off the existing `gp_looks.tags text[]` strings — that's the GoodPix bulk-rename problem.
- Migrate any existing GoodPix look-category data into `look_categories` + assignments (best-effort; log).
- Looks page filters/groups by these categories; categories are editable per client (add/rename/reorder/hide).
- Acceptance: Looks page shows looks-categories (not garment categories); you can create a category, assign looks, filter by it.

**A5. Bulk-rename a looks category (the GoodPix dealbreaker).**
- Renaming a `look_categories.label` updates every look in it with zero per-look edits — which is automatic once A4 uses FK-by-ID.
- Acceptance: rename "Business Casual" → "Grab & Go"; all previously-assigned looks remain, now under the new label; one DB update, no per-look migration.

**A6. Landscape board size on the canvas (alongside square/portrait).**
- Add a board-size switcher offering at least **Square** (Instagram standard, 1:1) and **Landscape 1600×1200**. Keep the current portrait default available. Setting the size updates `LookCanvasState.canvas.{width,height}` (and capsule canvas analogously). Existing nodes shouldn't be destroyed on switch (reflow/keep positions sanely).
- Acceptance: switch a look to Landscape; canvas becomes 1600×1200; save + reopen preserves it; export/thumbnail uses the right aspect.

### GROUP B — parity + trust

**B1. Internal styling note at the item level.**
- Migration `007`: `ALTER TABLE gp_closet_items ADD COLUMN IF NOT EXISTS style_note text;` (downstream-owned). Stylist-only; editable from item detail (collection + palette). Distinct from the existing look-level `notes_internal`.
- Acceptance: add "must be styled with heels" to a garment; it persists and shows on that item only, not on looks.

**B2. "What looks is this garment in" — large viewer, no zoom, no per-click.**
- From a garment, open a viewer (modal or panel) listing every look containing it (`look_items` join), rendered **large** (use look `thumbnail_url`/`canvas_state`), not the current tiny un-clickable thumbnails. Mirror GoodPix's hanger-icon affordance.
- Acceptance: open it on a garment used in ≥2 looks; looks render large and legibly without zooming; each opens its look.

**B3. Approval step before looks publish to the client lookbook.**
- Saved looks should not auto-appear on the client site. Add a status (e.g. `gp_looks.review_status text default 'pending'` with `pending|approved`, downstream-owned/nullable) and a reviewer queue; only `approved` looks are read by the public lookbook. **Important:** verify how the public lookbook (atelier-looks) queries looks before changing visibility — do not break public reads, and keep SELECT open (filter by status in the query/app layer, not via a restrictive RLS SELECT). If unsure whether the live lookbook filters on this, default to app-layer filtering and document the assumption.
- Acceptance: a newly saved look is `pending` and absent from the (staging) client view; approving it makes it appear.

**B4. Canvas text formatting: bold, underline, center.**
- Extend `TextNode` with `bold?: boolean`, `underline?: boolean`, `align?: 'left'|'center'|'right'`. Render via Konva `Text` (`fontStyle:'bold'`, `textDecoration:'underline'`, `align`). Add toggles to `CanvasToolbar` when a text node is selected. Default new text to backwards-compatible values.
- Acceptance: select text, toggle bold/underline/center; renders correctly; persists in `canvas_state`; reopen preserves.

**B5. Fonts: add Playfair Display SC + a clean plain/sans option.**
- Existing client looks use **Playfair Display SC** — add it to the canvas `FONT_FAMILIES` (in `CanvasToolbar.tsx`) and load the webfont (fontsource or self-host) so Konva renders + exports it correctly (ensure font is loaded before canvas text measures/export). Keep a clean sans for plain labels (e.g. a city name).
- Acceptance: pick Playfair Display SC on a text node; it renders and survives PNG export; a plain sans is also selectable.

**B6. Darker grid lines.**
- The toggle-able alignment grid in `LookCanvas.tsx` is too faint. Increase stroke contrast/opacity so spacing is clearly visible when on (don't make it bleed into exports — grid should not be part of the exported PNG).
- Acceptance: toggle grid on; lines are clearly visible; exported look/thumbnail contains no grid.

### GROUP C — speed delighters

**C1. Copy/paste garments via keyboard (⌘C / ⌘V).**
- Keyboard handlers in the canvas to copy selected node(s) and paste clones at an offset (reuse `duplicateNodes` logic in `canvasStore`). Support multi-select. Don't hijack copy when the user is typing in an input/textarea.
- Acceptance: select an item, ⌘C then ⌘V pastes an offset clone; works for multiple selected nodes; doesn't break text-field copy.

**C2. "Text dragger" — width handle that wraps/stacks text.**
- Cynthia's ask: a handle to make a text box narrower so a multi-word label (e.g. "Valentino Garavani") wraps onto stacked lines instead of running side-by-side. Implement by adding `width?: number` to `TextNode` and a side resize anchor in `LookCanvas` that sets Konva `Text.width` (Konva auto-wraps to that width). Combine with B4's `align:'center'` so stacked lines center. (See screenshots Cynthia tagged "text dragger" — ask Karl for them if needed; the behavior above is the intent.)
- Acceptance: drag a text node's side handle narrower; the text reflows to multiple centered lines within the same text node; width persists in `canvas_state`.

---

## 4. Also fix (data-correctness, surfaced in the same review)

**Purchases vs. Shopping Boards separation.** Shopping-board / recommendation items must NOT appear under a client's **Purchases** tab — purchases come from invoices only. If the Purchases view currently reads from shopping/board data (this showed up on the Margo test client), make Purchases read only the invoice/purchase source and keep shopping recommendations on their own named, dated boards. Verify on staging; if Purchases is already invoice-only, just confirm and log. Keep shopping recommendations as **named boards** (titled + dated), not a flat list. (Related: the shopping_* tables / Shopping Board feature.)

---

## 5. Architectural rules for this build
- Canvas state is always the custom JSON schema in `src/types/canvas.ts` — never Konva's native `toJSON`. Bump/extend types backward-compatibly (all new fields optional with safe defaults so old saved looks still load).
- Every new table gets RLS: SELECT `USING(true)`, writes `authenticated` only.
- Keep changes additive; new migrations are sequential SQL files under `migrations/` (next is `007`). Run them against **staging** (`yuoxmcujmpfuujjchkcl`) and record the exact command + result in `BUILD_LOG.md`.
- Match the existing brand system and component patterns (shadcn/base-ui, Tailwind). iPad-responsive where the styling/collection UI is touched (stylists use iPads).

## 6. Verify each feature (don't report done without this)
- Use the preview/browser tooling to load the running staging app and exercise the actual UI for every Acceptance bullet — screenshots/snapshots, not assumptions.
- Check console + network for errors after each feature.
- Confirm saved looks reload correctly (canvas_state round-trips) and PNG export still works after canvas changes (B4/B5/B6/C2).
- `npm run build` must pass (tsc + vite) with no type errors before deploy.

## 7. Deploy to STAGING (the ONLY allowed deploy)
Do **not** use `npm run deploy`/`ship`. Deploy to the staging Vercel project with explicit IDs so the live link is bypassed:
```bash
cd ~/atelier-builder
mv .vercel/project.json /tmp/atelier-live-project.json     # detach live link
VERCEL_ORG_ID=team_7qhkvdiUYPjNNS7jZbwSMR7p \
VERCEL_PROJECT_ID=prj_XeW9Ms10AANtkiUAX61OAsNXReCz \
vercel deploy --prod --yes                                 # → atelier-staging-alpha.vercel.app (STAGING project)
mv /tmp/atelier-live-project.json .vercel/project.json     # restore live link
```
Then open **https://atelier-staging-alpha.vercel.app/** and smoke-test the built features there. (Staging frontend env already points at staging Supabase.) If the staging Vercel project's env vars are missing any VITE_* keys, set them on that project (staging only) — never on the live project.

## 8. When done
- Restore Karl's env if you want, but leave `.env.local.live.bak` in place regardless.
- Commit on `feature/cynthia-styling` with clear messages. **Do not** merge to `main`, do not push to live, do not deploy to live.
- Write `CYNTHIA_BUILD_REPORT.md`: what shipped per feature, the migrations run (with the staging ref), test-data seeded, screenshots/links, anything deferred or blocked, and the exact steps for Karl to promote to live (run migrations `007/008` on live `lejwzpwntjaleqgrcakq`, merge branch, deploy live). List every guardrail-adjacent decision so Karl can audit before promoting.
- Stop. Karl promotes to live.

---
### Open questions to resolve autonomously (don't block on Karl unless truly stuck)
- Exact scraper `name`/`title` column on `gp_closet_items` → inspect the table + the scraper's upsert to pick the right column to coalesce over.
- How atelier-looks (public lookbook) filters looks today → inspect before B3; default to app-layer status filtering, keep SELECT open.
- Whether GoodPix look-category data exists to migrate in A4 → inspect; if none, just stand up the new taxonomy.
Only stop for: missing credentials you can't derive, a genuinely destructive action on live, or being stuck after 2+ real attempts. Otherwise execute and log.
