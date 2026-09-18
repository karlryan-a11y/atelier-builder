#!/usr/bin/env node
// A secret may never ship in browser code.
//
// This exists because an Anthropic key (VITE_ANTHROPIC_API_KEY, used by src/lib/compose.ts with
// dangerouslyAllowBrowser) was compiled into the public bundle and served at
// atelierbywatson.com/style with no login: 108 characters, findable with one text search. Browser
// code is public by definition, so the rule is not "hide it better", it is "it is never there".
//
// Checks, in order:
//   1. SOURCE  - no import.meta.env.VITE_* name that looks like a secret (KEY/SECRET/TOKEN/PASSWORD),
//      allowing only the two that are public by design (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY).
//   2. BUNDLE  - no secret-shaped string in dist/ (build output).
//   3. LIVE    - with --live <url>, fetch the deployed page's JS and scan that too.
//
// Reports the count inspected. Zero files inspected is a FAILURE, not a pass: a guard that measured
// nothing is how this got missed in the first place.

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, extname } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
// Public by design. The Supabase anon key is guarded by the database's row rules; the Google
// Picker developer key and client id are browser credentials by Google's own design and must be
// restricted by HTTP referrer in the Google Cloud console, which is where that is enforced.
const ALLOWED_VITE = new Set([
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'VITE_GOOGLE_API_KEY',
  'VITE_GOOGLE_CLIENT_ID',
  'VITE_GOOGLE_APP_ID',
])

// Secret shapes. The Supabase ANON key is a JWT too, so JWTs are matched only when the payload
// says service_role (decoded below), never on shape alone.
const PATTERNS = [
  { name: 'Anthropic API key', re: /sk-ant-[A-Za-z0-9_-]{20,}/g },
  // OpenAI keys carry - and _ in the body. An earlier version of this pattern allowed only
  // [A-Za-z0-9] and therefore MISSED the live sk-proj- key entirely: a guard that matches the
  // wrong shape reports a clean pass over a real secret.
  { name: 'OpenAI API key', re: /sk-(?:proj-)?(?!ant-)[A-Za-z0-9_-]{20,}/g },
  { name: 'Stripe secret key', re: /sk_(?:live|test)_[A-Za-z0-9]{16,}/g },
  { name: 'Photoroom API key', re: /sandbox_[A-Za-z0-9]{24,}/g },
  // NOT listed: the AIza... Google Picker key. Google issues it as a browser credential, so it
  // belongs in the bundle; its protection is the HTTP-referrer restriction on the key itself.
]

const failures = []
let filesInspected = 0
let bytesInspected = 0

function scanText(label, text) {
  filesInspected++
  bytesInspected += text.length
  for (const { name, re } of PATTERNS) {
    const hit = text.match(re)
    if (hit) failures.push(`${label}: ${name} (${hit.length} occurrence${hit.length > 1 ? 's' : ''})`)
  }
  for (const m of text.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.([A-Za-z0-9_-]{20,})\./g)) {
    try {
      const payload = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8'))
      if (payload?.role === 'service_role') failures.push(`${label}: Supabase SERVICE-ROLE key`)
    } catch {
      /* not a JWT we can read - ignore */
    }
  }
}

function walk(dir, exts, onFile) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git') continue
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, exts, onFile)
    else if (exts.has(extname(entry))) onFile(full)
  }
}

// 1. SOURCE
let sourceFiles = 0
walk(join(ROOT, 'src'), new Set(['.ts', '.tsx', '.js', '.jsx']), (file) => {
  sourceFiles++
  const text = readFileSync(file, 'utf8')
  for (const m of text.matchAll(/import\.meta\.env\.(VITE_[A-Z0-9_]+)/g)) {
    const name = m[1]
    if (ALLOWED_VITE.has(name)) continue
    if (/(KEY|SECRET|TOKEN|PASSWORD)/.test(name)) {
      failures.push(`src: ${name} is read in browser code (${file.replace(ROOT, '')})`)
    }
  }
  scanText(`src ${file.replace(ROOT, '')}`, text)
})
if (sourceFiles === 0) failures.push('src: inspected 0 files')

// 2. BUNDLE
const dist = join(ROOT, 'dist')
let bundleFiles = 0
if (existsSync(dist)) {
  walk(dist, new Set(['.js', '.css', '.html', '.map']), (file) => {
    bundleFiles++
    scanText(`dist ${file.replace(ROOT, '')}`, readFileSync(file, 'utf8'))
  })
  if (bundleFiles === 0) failures.push('dist: inspected 0 files')
}

// 3. LIVE
const liveIdx = process.argv.indexOf('--live')
let liveFiles = 0
if (liveIdx !== -1) {
  const base = process.argv[liveIdx + 1]
  if (!base) {
    failures.push('--live needs a URL')
  } else {
    const page = await fetch(base).then((r) => (r.ok ? r.text() : null))
    if (!page) failures.push(`live: could not load ${base}`)
    else {
      const assets = [...page.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map((m) => m[1])
      if (assets.length === 0) failures.push(`live: found 0 assets at ${base}`)
      for (const rel of assets) {
        const url = new URL(rel, base).href
        const body = await fetch(url).then((r) => (r.ok ? r.text() : null))
        if (body === null) {
          failures.push(`live: could not load ${url}`)
          continue
        }
        liveFiles++
        scanText(`live ${url}`, body)
      }
    }
  }
}

const where = [`${sourceFiles} source files`]
if (existsSync(dist)) where.push(`${bundleFiles} built files`)
if (liveIdx !== -1) where.push(`${liveFiles} live files`)
console.log(
  `check-no-browser-secrets: inspected ${where.join(', ')} (${(bytesInspected / 1e6).toFixed(1)} MB)`
)

if (failures.length) {
  console.error('\nFAIL - a secret is reachable from a browser:')
  for (const f of failures) console.error(`  - ${f}`)
  console.error('\nMove the call to api/ (see api/ai.ts) so the key stays on the server.')
  process.exit(1)
}
console.log('PASS - no secret in browser code.')
