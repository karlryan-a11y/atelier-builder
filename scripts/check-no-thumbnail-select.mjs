#!/usr/bin/env node
/**
 * Guard: no browser read of gp_looks / looks downloads the stored base64 pictures.
 *
 * gp_looks.thumbnail_url holds a base64 2160x2160 JPEG per builder look (641+ looks, ~199 MB).
 * Three hooks selected it for every look of the open client, so opening Danielle York pulled
 * ~50 MB per request before the grid could paint. Surfaces show a look with
 * lookImageUrl(raw) (src/lib/lookImage.ts) instead.
 *
 * Fails when any query chain under src/ that starts at .from('gp_looks') or .from('looks'):
 *   - names thumbnail_url in its .select(...)
 *   - selects '*'
 *   - calls .select() with no columns (PostgREST returns every column, same as '*')
 *   - selects through an identifier this script cannot resolve to a string constant
 *
 * Reports how many chains and selects it inspected; zero of either is a failure (HARD-RULES).
 * SRC=<dir> points it somewhere else (used to prove it fails on the old code).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.env.SRC ?? 'src'
const files = []
const walk = (d) => {
  for (const n of readdirSync(d)) {
    const p = join(d, n)
    if (statSync(p).isDirectory()) walk(p)
    else if (/\.(ts|tsx)$/.test(n) && !/\.d\.ts$/.test(n)) files.push(p)
  }
}
walk(ROOT)

// Block comments keep their newlines so reported line numbers match the file.
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, '')).replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

// Read the argument list of a call whose "(" is at index i. Returns [argsText, endIndex].
function readArgs(s, i) {
  let depth = 0, q = null
  for (let j = i; j < s.length; j++) {
    const c = s[j]
    if (q) { if (c === '\\') { j++; continue } if (c === q) q = null; continue }
    if (c === "'" || c === '"' || c === '`') { q = c; continue }
    if (c === '(') depth++
    else if (c === ')') { depth--; if (depth === 0) return [s.slice(i + 1, j), j] }
  }
  return [s.slice(i + 1), s.length]
}

const failures = []
let chains = 0, selects = 0

for (const f of files) {
  const src = stripComments(readFileSync(f, 'utf8'))
  const consts = new Map()
  for (const m of src.matchAll(/const\s+([A-Za-z_$][\w$]*)\s*=\s*(['"`])([^'"`]*)\2/g)) consts.set(m[1], m[3])

  const re = /\.from\(\s*(['"])(gp_looks|looks)\1\s*\)/g
  let m
  while ((m = re.exec(src))) {
    chains++
    // The chain continues while the next non-space text is ".something(" (a builder method).
    let i = m.index + m[0].length
    const line = src.slice(0, m.index).split('\n').length
    for (;;) {
      const rest = src.slice(i)
      const mm = rest.match(/^\s*\.\s*([A-Za-z_$][\w$]*)\s*(?=\()/)
      if (!mm) break
      const open = i + mm[0].length
      const [args, end] = readArgs(src, open)
      if (mm[1] === 'select') {
        selects++
        const a = args.trim()
        const first = a.split(',')[0]?.trim() ?? ''
        const where = `${relative(join(ROOT, '..'), f)}:${line} .from('${m[2]}')`
        let cols = null
        if (a === '') failures.push(`${where} .select() with no columns returns every column, thumbnail_url included`)
        else if (/^(['"`])/.test(first)) cols = a.match(/^(['"`])([\s\S]*?)\1/)?.[2] ?? ''
        else if (consts.has(first.split(/\s/)[0])) cols = consts.get(first.split(/\s/)[0])
        else failures.push(`${where} .select(${first}) cannot be resolved to a column list`)
        if (cols !== null) {
          if (/(^|[\s,])\*($|[\s,])/.test(cols)) failures.push(`${where} selects '*'`)
          if (/\bthumbnail_url\b/.test(cols)) failures.push(`${where} selects thumbnail_url`)
        }
      }
      i = end + 1
    }
  }
}

console.log(`check-no-thumbnail-select: inspected ${files.length} files, ${chains} gp_looks/looks query chains, ${selects} selects`)
if (chains === 0 || selects === 0) {
  console.error('FAIL - inspected nothing; a guard that measured nothing is a failure')
  process.exit(1)
}
if (failures.length) {
  console.error(`FAIL - ${failures.length} read(s) would download the stored base64 pictures:`)
  for (const x of failures) console.error('  ' + x)
  process.exit(1)
}
console.log('PASS - no browser read of gp_looks/looks selects thumbnail_url or every column.')
