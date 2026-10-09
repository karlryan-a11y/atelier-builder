// Duplicate capsule (Cynthia Dada, 2026-10-06). FAILS before it: the capsule card had Edit and
// Rename only, and useLookCategories had no duplicateCapsule. Holds the parts that keep a copy safe:
// it is a draft (never on her site by itself), it is new on top, it keeps the board so it opens on
// the canvas, and it carries the original's categories.
import { readFileSync } from 'node:fs'
const hook = readFileSync('src/hooks/useLookCategories.ts', 'utf8')
const panel = readFileSync('src/components/categorize/CategorizePanel.tsx', 'utf8')
const fails = []
const need = (ok, msg) => { if (!ok) fails.push(msg) }
const fn = hook.slice(hook.indexOf('const duplicateCapsule'), hook.indexOf('const archiveCapsule'))
need(fn.length > 0, 'useLookCategories has no duplicateCapsule')
need(/published: false/.test(fn), 'the copy must be unpublished')
need(/is_deleted: false/.test(fn), 'the copy must not be archived')
need(/sort_order: null/.test(fn), 'the copy must sort to the top (sort_order null)')
need(/\.\.\.src/.test(fn) && /raw: \{ \.\.\.\(src\.raw/.test(fn), 'the copy must keep raw (canvas_state, picture)')
need(/board_category_assignments[\s\S]*insert/.test(fn), 'the copy must carry its categories')
need(/\(copy\)/.test(fn), 'the copy is named "<name> (copy)"')
need(/duplicateCapsule,/.test(hook.slice(hook.indexOf('\n  return {\n'))), 'useLookCategories must return duplicateCapsule')
const actions = panel.slice(panel.indexOf('const capsuleCardActions'), panel.indexOf('const capsuleCardActions') + 6000)
need(/data-duplicate-capsule/.test(actions) && /handleDuplicateCapsule\(capsule\)/.test(actions), 'capsule cards need a Duplicate button')
if (fails.length) { console.error('check-capsule-duplicate FAILED:\n  ' + fails.join('\n  ')); process.exit(1) }
console.log('check-capsule-duplicate: ok')
