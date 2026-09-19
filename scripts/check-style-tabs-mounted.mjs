#!/usr/bin/env node
/**
 * Style tabs stay mounted (styling wave 3, item 2).
 *
 * The bug: App.tsx rendered `styleTab === 'canvas' ? <canvas panels/> : <CategorizePanel/>`, so
 * every Canvas <-> Categorize switch unmounted one side and mounted the other, and the closet,
 * the looks and the capsules were read again each time.
 *
 * This guard holds:
 *   1. The canvas panels (ClosetPanel, LookCanvas, LookItemsPanel, ChatPanel) and CategorizePanel
 *      are rendered in App.tsx, and NONE of them sits under a conditional (?:, &&) that tests
 *      `styleTab`. (Categorize may be lazily mounted on first visit via `categorizeMounted &&`.)
 *   2. The hidden side is hidden, not unmounted: each sits in a <StylePane active={styleTab === ...}>.
 *   3. The canvas keyboard shortcuts (a window listener) check the tab, or a Backspace in
 *      Categorize would delete the selected pieces on the hidden board.
 *   4. Coming back to a tab re-reads the small lists the other tab can change
 *      (hooks/useStyleTabRefresh.ts is called from App).
 *
 * Exits non-zero on a break AND on inspecting nothing.
 */
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const FILE = 'src/App.tsx'
const text = readFileSync(FILE, 'utf8')
const sf = ts.createSourceFile(FILE, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const failures = []
let checked = 0

const PANELS = ['ClosetPanel', 'LookCanvas', 'LookItemsPanel', 'ChatPanel', 'CategorizePanel']
const found = new Map(PANELS.map((p) => [p, 0]))

const mentionsStyleTab = (n) => /\bstyleTab\b/.test(n.getText(sf))

function conditionalAncestors(node) {
  const out = []
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isConditionalExpression(p)) out.push({ kind: '?:', cond: p.condition })
    if (ts.isBinaryExpression(p) && (p.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken || p.operatorToken.kind === ts.SyntaxKind.BarBarToken)) {
      out.push({ kind: p.operatorToken.getText(sf), cond: p.left })
    }
  }
  return out
}

function paneOf(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isJsxElement(p) && p.openingElement.tagName.getText(sf) === 'StylePane') {
      const active = p.openingElement.attributes.properties.find((a) => ts.isJsxAttribute(a) && a.name.getText(sf) === 'active')
      return active ? active.getText(sf) : 'StylePane without active='
    }
  }
  return null
}

const visit = (node) => {
  if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
    const tag = node.tagName.getText(sf)
    if (found.has(tag)) {
      found.set(tag, found.get(tag) + 1)
      const line = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1
      checked++
      for (const c of conditionalAncestors(node)) {
        if (mentionsStyleTab(c.cond)) {
          failures.push(`${FILE}:${line}: <${tag}/> is mounted by a styleTab conditional (${c.kind} ${c.cond.getText(sf).slice(0, 60)}), so switching tabs unmounts it and it reloads`)
        }
      }
      checked++
      const pane = paneOf(node)
      const want = tag === 'CategorizePanel' ? "'categorize'" : "'canvas'"
      if (!pane || !pane.includes(`styleTab === ${want}`)) {
        failures.push(`${FILE}:${line}: <${tag}/> is not inside <StylePane active={styleTab === ${want}}> (found: ${pane ?? 'none'})`)
      }
    }
  }
  ts.forEachChild(node, visit)
}
visit(sf)
for (const [tag, n] of found) {
  checked++
  if (n === 0) failures.push(`${FILE}: <${tag}/> is not rendered at all`)
}

// StylePane hides, it does not unmount.
checked++
const paneSrc = text.slice(text.indexOf('function StylePane'), text.indexOf('function App'))
if (!/invisible/.test(paneSrc) || !/inert=\{!active\}/.test(paneSrc) || /active\s*\?\s*children|active\s*&&\s*children/.test(paneSrc)) {
  failures.push(`${FILE}: StylePane must keep its children rendered and hide them (invisible + inert), not drop them`)
}

// The canvas is the base layer (never restyled on a switch: ~200 ms of WebKit style work on the
// ~20,000-element closet grid) and Categorize is the layer over it.
checked++
if (!/<StylePane active=\{styleTab === 'canvas'\} layer="base">/.test(text) || !/<StylePane active=\{styleTab === 'categorize'\} layer="over">/.test(text)) {
  failures.push(`${FILE}: the canvas must be the base StylePane and Categorize the layer over it`)
}

// 3. keyboard shortcuts on the hidden board
checked++
const canvas = readFileSync('src/components/canvas/LookCanvas.tsx', 'utf8')
const handlerAt = canvas.indexOf("window.addEventListener('keydown', handler)")
const handlerSrc = canvas.slice(canvas.lastIndexOf('const handler = (e: KeyboardEvent) => {', handlerAt), handlerAt)
if (handlerAt < 0 || !/useViewStore\.getState\(\)\.styleTab !== 'canvas'\) return/.test(handlerSrc.slice(0, 400))) {
  failures.push("src/components/canvas/LookCanvas.tsx: the window keydown handler does not return early when styleTab !== 'canvas'")
}

// 4. background refresh on show
checked++
if (!/useRefreshStyleListsOnShow\(/.test(text)) failures.push(`${FILE}: useRefreshStyleListsOnShow is not called, so a tab can show what the other tab already changed`)

console.log(`check-style-tabs-mounted: ${checked} assertions over ${[...found.values()].reduce((a, b) => a + b, 0)} panel mounts`)
if (failures.length) {
  console.log(`FAIL (${failures.length}):`)
  for (const f of failures) console.log('  - ' + f)
  process.exit(1)
}
console.log('PASS - Canvas and Categorize stay mounted across a tab switch; the hidden one takes no keys and refreshes on return.')
