#!/usr/bin/env node
/**
 * Guard: the category styling note (ADR-0110) is readable everywhere it is written.
 *
 * Two failure modes this exists to catch, both of which have happened here before:
 *
 * 1. A COLUMN LEFT OUT OF A SELECT (ADR-0103). `look_categories` is read in several places.
 *    Miss `description` in one of them and that surface silently renders `undefined` for
 *    every client, with no error anywhere. Cheap to do, invisible once done.
 *
 * 2. A HOVER-ONLY CONTROL (ADR-0108). The rename pencil sat at `opacity-0` until hover,
 *    and the stylists work on iPads where hover does not exist, which is why Maegan
 *    believed renaming was impossible. A note nobody can see is the same bug.
 *
 * It also checks the client boundary: atelier-looks must NOT select this column, because
 * the note is for the stylist ("he will never wear jeans") and never for the client.
 *
 * Reports the count inspected and exits non-zero at zero, per HARD-RULES: a check that
 * measured nothing is a failure, and a green tick over an empty set is how a broken guard
 * survived three weeks here.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, extname } from 'node:path'

const errors = []
const notes = []

// ── 1. every look_categories SELECT in the builder names `description` ──
const HOOK = 'src/hooks/useLookCategories.ts'
const hook = readFileSync(HOOK, 'utf8')

// Column lists selected from look_categories look like: .select('id, slug, label, ...')
const selects = [...hook.matchAll(/\.select\(\s*'([^']*\bslug\b[^']*)'\s*\)/g)].map((m) => m[1])
if (selects.length === 0) {
  errors.push(`${HOOK}: found ZERO look_categories column selects to inspect. The guard cannot see what it is guarding.`)
}
for (const cols of selects) {
  if (!/\bdescription\b/.test(cols)) {
    errors.push(`${HOOK}: SELECT '${cols}' omits \`description\`. That surface renders undefined for every client.`)
  }
}
notes.push(`${HOOK}: ${selects.length} look_categories SELECT(s) inspected, all naming description`)

// The type has to carry it or nothing downstream can read it.
if (!/interface LookCategory\s*\{[^}]*\bdescription\b/s.test(hook)) {
  errors.push(`${HOOK}: LookCategory has no \`description\` field.`)
}
// And there must be a way to write one.
if (!/setCategoryDescription/.test(hook)) {
  errors.push(`${HOOK}: no setCategoryDescription mutator — the note can be read but never written.`)
}

// ── 2. the note is reachable without hover, on both stylist surfaces ──
const SURFACES = [
  { file: 'src/components/categorize/CategorizePanel.tsx', needle: /cat\.description/, what: 'the Categorize rail' },
  { file: 'src/components/canvas/SaveLookDialog.tsx', needle: /selectedNotes/, what: 'the canvas Save Look dialog' },
]
let surfacesChecked = 0
for (const { file, needle, what } of SURFACES) {
  if (!existsSync(file)) { errors.push(`${file}: missing — ${what} cannot render the note.`); continue }
  const src = readFileSync(file, 'utf8')
  surfacesChecked++
  if (!needle.test(src)) {
    errors.push(`${file}: ${what} never reads the category note, so a stylist cannot see it there.`)
    continue
  }
  // The note text itself must not sit inside an opacity-0 / hover-only container.
  for (const m of src.matchAll(/^.*(?:cat\.description|selectedNotes\.map).*$/gm)) {
    if (/opacity-0\b/.test(m[0])) {
      errors.push(`${file}: the note is rendered inside an opacity-0 container. Hover does not exist on the iPad the stylists use (ADR-0108).`)
    }
  }
}
if (surfacesChecked === 0) errors.push('ZERO stylist surfaces inspected. Nothing was measured.')
notes.push(`${surfacesChecked} stylist surface(s) inspected for a non-hover-gated note`)

// ── 3. the client boundary: atelier-looks must not select this column ──
const LOOKS_CANDIDATES = [
  join(process.env.HOME ?? '', 'Downloads/atelier-looks/src/lib/queries.ts'),
  join(process.env.HOME ?? '', 'Downloads/atelier-looks/src/pages/[microsite]/index.astro'),
]
let clientFilesChecked = 0
for (const f of LOOKS_CANDIDATES) {
  if (!existsSync(f)) continue
  clientFilesChecked++
  const src = readFileSync(f, 'utf8')
  for (const m of src.matchAll(/from\('look_categories'\)[\s\S]{0,200}?\.select\(\s*'([^']*)'/g)) {
    if (/\bdescription\b/.test(m[1]) || /\*/.test(m[1])) {
      errors.push(`${f}: the CLIENT lookbook selects '${m[1]}'. The styling note is written for the stylist and must never reach the client's page.`)
    }
  }
}
notes.push(
  clientFilesChecked > 0
    ? `${clientFilesChecked} client-lookbook file(s) inspected, none selecting description`
    : 'client lookbook not on this machine, boundary not inspected here',
)

// ── 4. LIVE GRANTS: every column the client lookbook selects must be readable by anon ──
//
// This is the check that would have caught the 2026-09-04 incident. Migration 020 revoked
// anon's table-wide SELECT and re-granted a hand-typed column list. A concurrent session had
// added `is_residence` in between, the lookbook reads it, and the client home tiles returned
// 42501 for six minutes. A list of columns typed by hand goes stale the moment anyone adds
// one; asking the live database is the only version that cannot.
const LOOKS_DIR = join(process.env.HOME ?? '', 'Downloads/atelier-looks/src')
function loadEnv() {
  const out = {}
  if (existsSync('.env.local')) {
    for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (m) out[m[1]] = m[2]
    }
  }
  return {
    url: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || out.VITE_SUPABASE_URL,
    key: process.env.SUPABASE_ANON_KEY || out.VITE_SUPABASE_ANON_KEY,
  }
}
const { url, key } = loadEnv()
if (!url || !key) {
  notes.push('live grant check SKIPPED (no anon creds) — grants NOT verified')
} else {
  // Collect every column the lookbook selects from look_categories, across all its files.
  const wanted = new Set()
  const stack = [LOOKS_DIR]
  const files = []
  while (stack.length) {
    const dir = stack.pop()
    if (!existsSync(dir)) continue
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name)
      if (e.isDirectory()) { if (e.name !== 'node_modules') stack.push(full) }
      else if (['.ts', '.astro', '.tsx', '.js'].includes(extname(e.name))) files.push(full)
    }
  }
  for (const f of files) {
    const src = readFileSync(f, 'utf8')
    for (const m of src.matchAll(/from\(\s*'look_categories'\s*\)[\s\S]{0,900}?\.select\(\s*'([^']*)'/g)) {
      for (const c of m[1].split(',')) { const t = c.trim(); if (t && t !== '*') wanted.add(t) }
    }
  }
  if (files.length === 0) {
    notes.push('live grant check SKIPPED (atelier-looks not on this machine) — grants NOT verified')
  } else if (wanted.size === 0) {
    errors.push('parsed the lookbook but found ZERO look_categories columns. The grant check measured nothing.')
  } else {
    const ask = async (cols) => {
      const r = await fetch(`${url}/rest/v1/look_categories?select=${cols}&limit=1`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
      })
      return r.status
    }
    const status = await ask([...wanted].join(','))
    if (status !== 200) {
      errors.push(
        `anon CANNOT read the columns the client lookbook selects (HTTP ${status}). ` +
        `Columns the lookbook needs: ${[...wanted].sort().join(', ')}. ` +
        `A client page will 42501. Grant the missing column to anon.`,
      )
    }
    const leak = await ask('id,description')
    if (leak === 200) {
      errors.push('anon CAN read look_categories.description. The stylist note is public.')
    }
    notes.push(
      `live grants: ${wanted.size} lookbook column(s) checked against the real database ` +
      `(${[...wanted].sort().join(', ')}) — readable by anon: ${status === 200 ? 'yes' : 'NO'}; ` +
      `description readable by anon: ${leak === 200 ? 'YES' : 'no'}`,
    )
  }
}

// ── report ──
for (const n of notes) console.log(`  ${n}`)
if (errors.length) {
  console.error('\ncheck-category-description FAILED:')
  for (const e of errors) console.error(`  - ${e}`)
  process.exit(1)
}
console.log('check-category-description PASSED')
