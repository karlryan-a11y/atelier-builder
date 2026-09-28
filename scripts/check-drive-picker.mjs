#!/usr/bin/env node
// The Drive picker must offer a view that shows files the stylist OWNS inside a folder someone
// else shared with her.
//
// Cynthia Dada, 2026-09-25: Peyton Wheeler > ... > Exploration > Dresses showed "No items in this
// folder". The only way into a shared folder was the "Shared with me" tab, which is
// setOwnedByMe(false): the subfolders (someone else's) showed, the photos she uploaded herself
// did not. "My Drive" is setParent('root') and never reaches the shared folder; "Shared drives" is
// team drives only.
//
// Passes when at least one DocsView has no ownership filter, no root parent and is not the
// shared-drives view. Reports the count of views inspected; zero is a failure.

import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../src/lib/googleDrive.ts', import.meta.url), 'utf8')
const views = [...src.matchAll(/new picker\.DocsView\([^)]*\)([\s\S]*?)(?=\n\s*\n|\n\s*const |\n\s*\/\/)/g)].map((m) => m[1])
const open = views.filter((v) => !/setOwnedByMe/.test(v) && !/setParent\(/.test(v) && !/setEnableDrives/.test(v))
console.log(`check-drive-picker: inspected ${views.length} picker views, ${open.length} show owned files in shared folders`)
if (views.length === 0 || open.length === 0) {
  console.error(views.length === 0 ? 'FAIL - found no picker views to inspect' :
    'FAIL - every view hides something: a photo she uploaded into a shared folder is unreachable')
  process.exit(1)
}
console.log('PASS')
