#!/usr/bin/env node
/**
 * Build the Style (✨) button's library (look_templates) from every GoodPix look that carries its
 * arrangement (gp_looks.gp_layout). ADR-0128.
 *
 * Uses the SHIPPED converter (src/lib/goodpixLayout.ts) and template builder
 * (src/lib/styleFromTemplates.ts), so the library is exactly what those files say a look is.
 * Derived data: every run rebuilds each row it touches. Safe to re-run; run after the layout carry
 * (goodpix-scraper resync_layouts.py) so new and re-styled looks join the library.
 *
 *   node scripts/build-look-templates.mjs            # every look with a layout
 *   node scripts/build-look-templates.mjs --dry      # count only
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
const G = await import('../src/lib/goodpixLayout.ts')
const T = await import('../src/lib/styleFromTemplates.ts')

const env = { ...process.env }
for (const f of ['../.env.local', '../.env']) {
  let t; try { t = readFileSync(new URL(f, import.meta.url), 'utf8') } catch { continue }
  for (const l of t.split('\n')) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !(m[1] in env)) env[m[1]] = m[2].replace(/^["']|["']$/g, '') }
}
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const DRY = process.argv.includes('--dry')

// Every piece's name + saved category, once. PostgREST caps a select at 1000: page it.
const typeOf = new Map()
for (let f = 0; ; f += 1000) {
  // ORDER BY is not optional: PostgREST pages without one overlap and skip rows, which read
  // 39% of pieces as 'unknown' on the first build (2026-09-18).
  const { data, error } = await sb.from('gp_closet_items').select('id, name, name_override, category').order('id').range(f, f + 999)
  if (error) throw error
  for (const r of data) typeOf.set(r.id, T.pieceType(r.name_override?.trim() || r.name, r.category))
  if (data.length < 1000) break
}

let looks = 0, built = 0, empty = 0, labels = 0, other = 0, slotsTotal = 0
const rows = []
const flush = async () => {
  if (DRY || !rows.length) { rows.length = 0; return }
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await sb.from('look_templates').upsert(rows.slice(i, i + 200), { onConflict: 'look_id' })
    if (error) throw error
  }
  rows.length = 0
}
for (let f = 0; ; f += 300) {
  const { data, error } = await sb.from('gp_looks')
    .select('id, name, client_id, gp_layout').not('gp_layout', 'is', null).order('id').range(f, f + 299)
  if (error) throw error
  for (const r of data) {
    looks++
    const conv = G.convertGoodPixLayout(r.gp_layout, { keep: () => true, mirrorUrl: (k) => k })
    const tpl = T.templateFromConversion(conv, (id) => typeOf.get(id) ?? 'other', {
      look_id: r.id, look_name: r.name?.trim() || null, client_id: r.client_id, board_id: r.gp_layout.board_id ?? null,
    })
    if (!tpl) { empty++; continue }
    built++; labels += tpl.labels.length; slotsTotal += tpl.slots.length
    other += tpl.slots.filter((s) => s.type === 'other').length
    rows.push({ ...tpl, piece_count: tpl.slots.length, board_w: Math.round(tpl.board_w), board_h: Math.round(tpl.board_h), built_at: new Date().toISOString() })
  }
  await flush()
  if (data.length < 300) break
}
console.log(`${looks} looks with a layout | ${built} templates${DRY ? ' (dry run, nothing written)' : ' written'} | ${empty} with no piece of hers | ${slotsTotal} slots, ${other} of unknown type (${(100 * other / Math.max(1, slotsTotal)).toFixed(1)}%) | ${labels} labels`)
if (built === 0) { console.error('nothing built'); process.exit(1) }
