#!/usr/bin/env node
// Add Item: the AI's suggestions may only fill fields the stylist has left EMPTY at the moment
// they arrive, never ones she typed into while the photo was processing.
//
// Cynthia Dada, 2026-09-25: "I already have the name from the product's website ... don't need
// atelier to populate a title." onPick() checked `!name` from when the photo was PICKED, so
// anything typed during "Processing photo..." was overwritten when the AI answered. Every AI
// fill must use a functional update (setX(cur => ...)), which sees what she has typed since.
//
// Reports the count inspected; zero is a failure.

import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../src/components/layout/AddItemDialog.tsx', import.meta.url), 'utf8')
const fills = src.split('\n').filter((l) => /\bfields\.\w+/.test(l) && /\bset[A-Z]\w*\(/.test(l))
const stale = fills.filter((l) => !/\bset[A-Z]\w*\(\s*\w+\s*=>/.test(l))
console.log(`check-additem-keeps-typing: inspected ${fills.length} AI field fills, ${stale.length} read a stale value`)
if (fills.length === 0 || stale.length) {
  console.error(fills.length === 0 ? 'FAIL - found no AI fills to inspect' : 'FAIL - these overwrite what she typed while the photo processed:')
  for (const l of stale) console.error('  ' + l.trim())
  process.exit(1)
}
console.log('PASS')
