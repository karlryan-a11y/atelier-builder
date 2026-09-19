#!/usr/bin/env node
/**
 * Style render-scope guard (styling wave 3, item 1).
 *
 * The bug: a tap on the canvas re-rendered the closet grid beside it, up to ~1,300 draggable
 * tiles, on every selection, drag and nudge. App.tsx and ClosetPanel.tsx read the WHOLE canvas
 * store (`useCanvasStore()` with no selector), so any change to the board re-rendered App, App
 * re-rendered ClosetPanel, and the un-memoised tiles all rendered again. ChatPanel did the same
 * with the looks gallery.
 *
 * Three rules, and this guard holds all of them:
 *   1. App, ClosetPanel and ChatPanel never subscribe to the whole canvas store.
 *   2. They never subscribe to the selection or to the whole board state either (a narrow
 *      selector that returns `s.state` or `s.selectedNodeIds` is the same bug in a new shape).
 *   3. The closet tile (DraggableItem) is memoised, and the grid hands it only the cached item,
 *      its index and callbacks that do not change identity (no inline arrow functions).
 * The runtime proof is scripts/perf/style-harness.mjs (tile renders per board tap = 0).
 *
 * Exits non-zero on a break AND on inspecting nothing.
 */
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const FILES = ['src/App.tsx', 'src/components/layout/ClosetPanel.tsx', 'src/components/layout/ChatPanel.tsx']
const failures = []
let checked = 0
let calls = 0

for (const file of FILES) {
  const text = readFileSync(file, 'utf8')
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'useCanvasStore') {
      calls++
      checked++
      const line = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1
      if (node.arguments.length === 0) {
        failures.push(`${file}:${line}: useCanvasStore() with no selector re-renders this component on every board change`)
      } else {
        const sel = node.arguments[0].getText(sf)
        checked++
        if (/=>\s*\(?\s*s\.state\s*\)?\s*$/.test(sel) || /\bs\.selectedNodeIds\b/.test(sel) || /=>\s*s\s*$/.test(sel)) {
          failures.push(`${file}:${line}: selector ${sel.replace(/\s+/g, ' ').slice(0, 80)} subscribes to the whole board or the selection`)
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
}
if (calls === 0) failures.push('found no useCanvasStore subscriptions to inspect in App / ClosetPanel / ChatPanel')

// ── 3. the memoised tile ──
{
  const file = 'src/components/layout/ClosetPanel.tsx'
  const text = readFileSync(file, 'utf8')
  checked++
  if (!/const DraggableItem = memo\(function DraggableItem\(/.test(text)) {
    failures.push(`${file}: DraggableItem is not wrapped in memo(), so every panel render re-renders every tile`)
  }
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let usages = 0
  const visit = (node) => {
    if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && node.tagName.getText(sf) === 'DraggableItem') {
      usages++
      for (const attr of node.attributes.properties) {
        if (!ts.isJsxAttribute(attr) || !attr.initializer || !ts.isJsxExpression(attr.initializer)) continue
        const expr = attr.initializer.expression
        checked++
        if (expr && (ts.isArrowFunction(expr) || ts.isFunctionExpression(expr) || ts.isObjectLiteralExpression(expr))) {
          failures.push(`${file}: <DraggableItem ${attr.name.getText(sf)}={...}> is a new ${ts.isObjectLiteralExpression(expr) ? 'object' : 'function'} every render, which defeats memo()`)
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  checked++
  if (usages === 0) failures.push(`${file}: no <DraggableItem> found to inspect`)
}

console.log(`check-style-render-scope: ${checked} assertions, ${calls} canvas-store subscriptions in ${FILES.length} files`)
if (failures.length) {
  console.log(`FAIL (${failures.length}):`)
  for (const f of failures) console.log('  - ' + f)
  process.exit(1)
}
console.log('PASS - a tap on the board re-renders neither the app shell, the closet grid nor the looks panel.')
