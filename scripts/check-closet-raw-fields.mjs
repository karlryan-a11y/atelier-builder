#!/usr/bin/env node
/**
 * Closet raw-field contract (styling wave 3, item 4).
 *
 * The closet read no longer selects gp_closet_items.raw whole (it was ~75% of the bytes: Cynthia
 * Lippe 3.86 MB -> 0.99 MB). It selects the three picture fields out of it by alias. ADR-0103:
 * a field left out of a SELECT answers every question with `undefined`, silently, for every
 * client. So this check fails if ANY code can read a raw field the SELECT no longer provides.
 *
 *   1. The SELECT (CLOSET_SELECT) does not take bare `raw`, and every raw path it takes is
 *      folded back under the key the type promises.
 *   2. ClosetItemRaw (lib/images.ts) has no index signature, and every key it declares is
 *      provided by the SELECT. With no index signature, TypeScript itself rejects
 *      `item.raw.description` anywhere in src (npm run build).
 *   3. The type checker walks every expression of type ClosetItemRaw in src and fails if one
 *      leaves the three known keys: read by a computed key, passed whole to a function
 *      (e.g. lookImageUrl(item.raw) would read main_image_url and get undefined), cast to another
 *      type, or spread/assigned into a new object outside the closet read itself.
 *
 * Exits non-zero on a break AND on inspecting nothing.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const failures = []
let checked = 0

// ── 1. the SELECT ──
const HOOK = 'src/hooks/useClosetItems.ts'
const hookSrc = readFileSync(HOOK, 'utf8')
const m = hookSrc.match(/export const CLOSET_SELECT\s*=\s*((?:\s*'[^']*'\s*\+?)+)/)
checked++
if (!m) {
  failures.push(`${HOOK}: CLOSET_SELECT not found`)
}
const select = m ? [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1]).join('') : ''
const cols = select.split(',').map((c) => c.trim()).filter(Boolean)
checked++
if (cols.includes('raw') || cols.some((c) => /^raw\s*$/.test(c.split(':').pop()))) {
  failures.push(`${HOOK}: CLOSET_SELECT selects the whole raw column again`)
}
// alias -> raw key it provides
const provided = new Map()
for (const c of cols) {
  const a = c.match(/^(\w+):raw(?:->>(\w+)|->(\w+)->>0)$/)
  if (a) provided.set(a[2] ?? a[3], a[1])
}
checked++
if (provided.size === 0) failures.push(`${HOOK}: CLOSET_SELECT provides no raw fields at all; the closet would have no pictures`)
// each alias must be folded back into raw under that key
for (const [key, alias] of provided) {
  checked++
  const folded = new RegExp(`raw\\.${key}\\s*=\\s*(\\[\\s*)?${alias}\\b`).test(hookSrc)
  if (!folded) failures.push(`${HOOK}: ${alias} (raw.${key}) is selected but never folded back into item.raw.${key}`)
}

// ── 2. the type ──
const IMAGES = 'src/lib/images.ts'
const imagesSrc = readFileSync(IMAGES, 'utf8')
const iface = imagesSrc.match(/export interface ClosetItemRaw \{([\s\S]*?)\n\}/)
checked++
if (!iface) failures.push(`${IMAGES}: interface ClosetItemRaw not found`)
const declared = iface ? [...iface[1].matchAll(/^\s*(\w+)\??\s*:/gm)].map((x) => x[1]) : []
checked++
if (iface && /\[\s*\w+\s*:\s*string\s*\]/.test(iface[1])) failures.push(`${IMAGES}: ClosetItemRaw has an index signature, so reading any raw field compiles and answers undefined`)
checked++
if (!/^\s*raw: ClosetItemRaw$/m.test(imagesSrc)) failures.push(`${IMAGES}: ClosetItem.raw is not typed ClosetItemRaw`)
for (const k of declared) {
  checked++
  if (!provided.has(k)) failures.push(`${IMAGES}: ClosetItemRaw declares raw.${k}, but CLOSET_SELECT does not provide it (every closet item would read undefined)`)
}

// ── 3. every use of a ClosetItemRaw value ──
const cfgPath = ts.findConfigFile('.', ts.sys.fileExists, 'tsconfig.app.json')
const cfg = ts.readConfigFile(cfgPath, ts.sys.readFile)
const parsed = ts.parseJsonConfigFileContent(cfg.config, ts.sys, path.dirname(cfgPath))
const program = ts.createProgram(parsed.fileNames, { ...parsed.options, noEmit: true })
const checker = program.getTypeChecker()
const isRawType = (t) => {
  if (!t) return false
  if (t.isUnion()) return t.types.some(isRawType)
  const s = t.aliasSymbol ?? t.getSymbol()
  return s?.getName() === 'ClosetItemRaw'
}
let rawUses = 0
let filesScanned = 0
const keys = new Set(declared)
for (const sf of program.getSourceFiles()) {
  const abs = path.resolve(sf.fileName)
  if (sf.isDeclarationFile || !abs.startsWith(path.resolve('src') + path.sep)) continue
  filesScanned++
  const rel = path.relative(process.cwd(), abs)
  const insideRead = rel === HOOK
  const where = (n) => `${rel}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`
  const visit = (node) => {
    const candidate =
      (ts.isPropertyAccessExpression(node) && node.name.text === 'raw') ||
      (ts.isIdentifier(node) && /raw/i.test(node.text) && !ts.isPropertyAccessExpression(node.parent))
    if (candidate && !(ts.isIdentifier(node) && (ts.isBindingElement(node.parent) || ts.isVariableDeclaration(node.parent) || ts.isParameter(node.parent) || ts.isPropertySignature(node.parent) || ts.isPropertyAssignment(node.parent) && node.parent.name === node))) {
      let t
      try { t = checker.getTypeAtLocation(node) } catch { t = null }
      if (isRawType(t)) {
        rawUses++
        checked++
        const p = node.parent
        if (ts.isPropertyAccessExpression(p) && p.expression === node) {
          if (!keys.has(p.name.text)) failures.push(`${where(node)}: reads raw.${p.name.text}, which the closet SELECT does not provide`)
        } else if (ts.isElementAccessExpression(p) && p.expression === node) {
          const k = ts.isStringLiteral(p.argumentExpression) ? p.argumentExpression.text : null
          if (!k || !keys.has(k)) failures.push(`${where(node)}: reads raw[${p.argumentExpression.getText(sf)}], which may not be provided`)
        } else if (ts.isCallExpression(p) && p.arguments.includes(node)) {
          failures.push(`${where(node)}: passes a closet item's raw whole to ${p.expression.getText(sf)}(); it holds only ${[...keys].join(', ')}`)
        } else if (ts.isAsExpression(p) || ts.isTypeAssertionExpression?.(p)) {
          failures.push(`${where(node)}: casts a closet item's raw to another type; it holds only ${[...keys].join(', ')}`)
        } else if ((ts.isSpreadAssignment(p) || ts.isSpreadElement(p) || ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && !insideRead) {
          failures.push(`${where(node)}: copies a closet item's raw into a new object; if that is written back it would erase every other raw field`)
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
}
checked++
if (filesScanned < 50) failures.push(`type-checked only ${filesScanned} files; expected the whole src tree`)
checked++
if (rawUses === 0) failures.push('found no use of a closet item raw value at all; the scan is not seeing the code')

console.log(`check-closet-raw-fields: ${checked} assertions; SELECT provides raw.{${[...provided.keys()].join(', ')}}; ${rawUses} uses of ClosetItemRaw in ${filesScanned} type-checked files`)
if (failures.length) {
  console.log(`FAIL (${failures.length}):`)
  for (const f of failures) console.log('  - ' + f)
  process.exit(1)
}
console.log('PASS - every raw field any closet screen reads is one the closet SELECT still provides.')
