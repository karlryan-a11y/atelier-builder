#!/usr/bin/env node
/**
 * THE STANDARD NESTING SET AND HER REQUESTS (2026-10-28, Julia Driscoll and Paige).
 *
 * Every client's Collection starts nested the standard way (Jewelry holding Necklaces, Earrings and
 * the rest), and a client can ask for her own group, which waits in the Nesting categories tab.
 * atelier-looks holds the same rule (tests/standardNesting.test.ts); if the two disagree a stylist
 * sees one tree and the client another.
 *
 * Guards:
 *  1. the rule itself (the real file, compiled): Thea Guido's jewelry rolls up, a stylist's row wins;
 *  2. the builder reads the tree through it, with her requests kept out of her tree;
 *  3. the Nesting categories tab shows her requests with Apply and Dismiss;
 *  4. the twin in atelier-looks is the same file, when it is beside this checkout.
 * Fails on inspecting nothing (ADR-0106).
 */
import { readFileSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import ts from 'typescript'

const ROOT = new URL('..', import.meta.url).pathname
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8')
const problems = []
const fail = (m) => { problems.push(m); console.error(`   ❌ ${m}`) }
let checks = 0

// 1. The rule.
const src = read('src/lib/categoryNesting.ts')
const dir = mkdtempSync(path.join(tmpdir(), 'nest-'))
writeFileSync(path.join(dir, 'categoryNesting.mjs'), ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText)
const N = await import(path.join(dir, 'categoryNesting.mjs'))
const cases = [
  ['necklaces', 'jewelry'], ['costume-earrings', 'jewelry'], ['time-pieces', 'jewelry'], ['jackets', 'outerwear'], ['coat', 'outerwear'],
  ['jeans', 'pants'], ['low-heel-jeans', 'pants'], ['heel', 'shoes'], ['sneakers', 'shoes'], ['shortsleeves', 'tops'], ['bodysuits', 'tops'],
  ['sweatshirts', 'sweaters'], ['swimwear', 'swim'], ['jewelry', null], ['49ers', null], ['blazers', null], ['s/s', null],
]
for (const [slug, want] of cases) { checks++; const got = N.standardParentOf?.(slug) ?? null; if (got !== want) fail(`standardParentOf("${slug}") is ${got}, expected ${want}`) }
checks++
const tree = N.parentMapFrom(N.withStandardNesting([{ slug: 'heels', parent_slug: null, label: null, sort_order: 0 }], ['heels', 'sandals', 'earrings']))
if (tree.get('heels') !== undefined || tree.get('sandals') !== 'shoes' || tree.get('earrings') !== 'jewelry') fail("a stylist's row does not win over the standard, or the standard is not applied")
checks++
const req = N.parentMapFrom(N.withStandardNesting([{ slug: 'request:dog-walking', parent_slug: 'shoes', label: 'Shoes', sort_order: 0, kind: 'request' }], ['dog-walking']))
if (req.size !== 0) fail('a client request became part of her tree before a stylist applied it')

// 2. The builder reads the tree through it.
const hook = read('src/hooks/useClientCategories.ts')
checks++; if (!/parentMapFrom\(withStandardNesting\(rows, slugsInUse\)\)/.test(hook)) fail('useClientCategories does not apply the standard set to her tree')
checks++; if (!/filter\(\(r\) => !isRequestRow\(r\)\)/.test(hook)) fail('useClientCategories lets her requests into her tree and her categories')
checks++; if (!/standardNestingOn\(/.test(hook)) fail('useClientCategories ignores the clients kept on their hand-made nesting (raw.standard_nesting)')

// 3. The tab shows her requests.
const tab = read('src/components/categorize/NestingTab.tsx')
checks++; if (!/<NestingRequests/.test(tab)) fail('the Nesting categories tab never shows the groups she asked for')
const panel = read('src/components/categorize/NestingRequests.tsx')
checks++; if (!/\bApply\b/.test(panel) || !panel.includes('Dismiss')) fail('her request has no Apply or no Dismiss')

// 4. The twin.
const twin = [path.join(ROOT, '../atelier-looks/src/lib/categoryNesting.ts')].find(existsSync)
if (twin) {
  checks++
  const strip = (s) => s.split('\n').filter((l) => !l.includes('KEEP IN STEP WITH THE TWIN')).join('\n')
  if (strip(readFileSync(twin, 'utf8')) !== strip(src)) fail('atelier-looks src/lib/categoryNesting.ts differs from this one: the client would see another tree')
} else {
  console.log('   (atelier-looks is not beside this checkout: twin comparison not run)')
}

console.log(`check-standard-nesting: ${checks} check(s)`)
if (!checks) { console.error('❌ inspected nothing'); process.exit(1) }
if (problems.length) { console.error(`❌ standard-nesting: ${problems.length} failure(s)`); process.exit(1) }
console.log('✅ standard-nesting: every client starts nested, her own rows win, and her requests wait for the stylist.')
