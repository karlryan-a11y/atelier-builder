# atelier-renderer

An always-on headless-browser box that keeps **look** and **capsule hero composites** in sync
when a stylist changes an item's photo.

## Why this exists

A look/capsule hero is a flattened composite PNG that's baked from the member item images **once**,
when a stylist saves the board in the Konva canvas, and stored in R2. Anywhere an item's image is
rendered *live* (the Collection grid, the "Pieces in this look" grid, the closet page) updates the
instant a photo is replaced/rotated/bg-removed — but the baked hero keeps showing the old photo,
because nothing re-renders it. There is no server-side renderer in the app; the composite only ever
came out of the in-browser builder canvas.

This service closes that gap. It runs the builder's **exact drawing code** (`render.html` →
`window.__atelierRender`, backed by `src/render/composite.ts` + `src/render/capsuleGrid.ts`) inside a
real Chromium via Playwright, so re-baked heroes come out pixel-identical to a stylist Save — fully
hands-off.

## Flow

1. Stylist replaces / rotates / removes-bg an item photo on `/style → Categorize → Collection`.
2. The builder pings `POST /regenerate { item_ids }` (see `atelier-builder/src/lib/renderer.ts`).
3. This box finds every affected **look** (builder look whose `canvas_state` styles the item) and
   **capsule** (`gp_boards`: board-composed capsules that style the item, plus look-grid capsules
   whose member looks changed), re-bakes each hero in the headless browser, uploads the PNG through
   the same `upload-image` edge function, and writes the new `raw.main_image_r2_key/main_image_url`
   (looks) / `raw.image_r2_key/image_url` (capsules).
4. **Looks are regenerated before capsules** — a look-grid capsule composite is built from its member
   looks' fresh thumbnails.

The lookbook and builder galleries already *read* these baked fields, so no reader changes are needed.

## Endpoints

- `GET  /health` → `{ ok: true }`
- `POST /regenerate` → `{ ok, looks, capsules, failures[] }`
  - Auth: a valid builder **JWT** in `Authorization: Bearer …`, or the `x-renderer-secret` header
    matching `RENDERER_SHARED_SECRET` (for trusted server-to-server callers).
  - Body: `{ "item_ids": ["…"] }` (or `{ "item_id": "…" }`).

## Run locally

```bash
cp .env.example .env   # fill in the Supabase values
npm install
npx playwright install chromium
npm run dev
```

Point the builder at it with `VITE_RENDERER_URL=http://localhost:8080` in `atelier-builder/.env`.

## Deploy (Fly.io)

```bash
fly launch --no-deploy          # first time; reuses fly.toml
fly secrets set \
  SUPABASE_URL=… SUPABASE_ANON_KEY=… SUPABASE_SERVICE_ROLE_KEY=… \
  RENDERER_SHARED_SECRET=…
fly deploy
```

Then set `VITE_RENDERER_URL=https://atelier-renderer.fly.dev` in the builder's Vercel env.

> The Dockerfile pins `mcr.microsoft.com/playwright:v1.49.1-jammy` — keep it in sync with the
> `playwright` version in `package.json`.

## Caveat worth knowing

An item's on-canvas size is `scale = target_height / image.naturalHeight`, so a replacement photo
with a **different aspect ratio** re-flows that item's size inside the hero (usually what you want,
but it can nudge a hand-arranged layout). This matches how the live builder would re-render the same
board, so the re-bake is faithful to the app's own logic.
