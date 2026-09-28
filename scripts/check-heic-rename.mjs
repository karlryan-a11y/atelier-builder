#!/usr/bin/env node
// Every converted HEIC must leave convertHeicToJpeg() named .jpg.
//
// The upload server rejects any file NAMED .heic/.heif, even when its bytes are now JPEG. The
// server-side path renamed; the browser fallback kept file.name, so a fallback "success" was still
// bounced (Thalia, IMG_0961.HEIC, 9/28). Every File built inside convertHeicToJpeg must use jpgName.
//
// Reports the count inspected; zero is a failure.

import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../src/lib/heic.ts', import.meta.url), 'utf8')
const start = src.indexOf('export async function convertHeicToJpeg')
const end = src.indexOf('\nexport ', start + 1)
const body = start >= 0 ? src.slice(start, end < 0 ? undefined : end) : ''
const builds = [...body.matchAll(/new File\(\[[^\]]*\],\s*([^,]+),/g)].map((m) => m[1].trim())

console.log(`check-heic-rename: inspected ${builds.length} File constructions in convertHeicToJpeg`)
const bad = builds.filter((n) => n !== 'jpgName')
if (builds.length === 0 || bad.length) {
  console.error(builds.length === 0 ? 'FAIL - found nothing to inspect' : `FAIL - output named ${bad.join(', ')} instead of jpgName; the server will reject it as HEIC`)
  process.exit(1)
}
console.log('PASS - every conversion path outputs a .jpg name.')
