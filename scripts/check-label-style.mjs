#!/usr/bin/env node
/**
 * New labels come in styled like her last one (Cynthia Dada, 2026-10-20: "you style a label the
 * way you like (say Neue Haas, 32, bold, underlined) → you start the next look or capsule and tap
 * Add text → the new label already has that same font, size, bold and underline, just like
 * GoodPix"). Add text used to start every label in Amalfi Coast, remembered the size only until a
 * reload, and never remembered bold or underline.
 *
 * Checks the rule (src/lib/labelStyle.ts) against a stand-in for the phone's storage, then that
 * Add text and every style control on a selected label go through it.
 * Exits non-zero on a break AND on inspecting nothing.
 */
import { readFileSync, existsSync } from 'node:fs'

const failures = []
let checked = 0
const is = (name, got, want) => {
  checked++
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g !== w) failures.push(`${name}: expected ${w}, got ${g}`)
}

const toolbar = readFileSync(new URL('../src/components/canvas/CanvasToolbar.tsx', import.meta.url), 'utf8')
const addText = toolbar.match(/const handleAddText = \(\) => \{[\s\S]*?\n  \}\n/)?.[0] ?? ''
is('Add text is found', addText.length > 0, true)
is('Add text does not force Amalfi Coast', /font_family: DEFAULT_FONT/.test(addText), false)
is('Add text takes the remembered style', /newLabelStyle\(\)/.test(addText), true)
is('Bold on a label is remembered', /bold: !tn\.bold[^\n]*rememberTextStyle/.test(toolbar), true)
is('Underline on a label is remembered', /underline: !tn\.underline[^\n]*rememberTextStyle/.test(toolbar), true)
is('Font on a label is remembered', /font_family: e\.target\.value[^\n]*rememberTextStyle/.test(toolbar), true)
is('Size on a label is remembered', /font_size: Number\(e\.target\.value\)[^\n]*rememberTextStyle/.test(toolbar), true)

const lib = new URL('../src/lib/labelStyle.ts', import.meta.url)
checked++
if (!existsSync(lib)) {
  failures.push('src/lib/labelStyle.ts is missing: nothing remembers a label style across looks or reloads')
} else {
  const { labelStyleFor, rememberLabelStyle, BRAND_LABEL_STYLE } = await import(lib.href)
  const device = () => {
    const m = new Map()
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }
  }
  const NEUE = "'Neue Haas', 'Helvetica Neue', Arial, sans-serif"
  const phone = device()

  is('a stylist who never styled a label gets Amalfi Coast 32, plain', labelStyleFor(phone, 'cynthia'),
    { font_family: "'Amalfi Coast', cursive", font_size: 32, bold: false, underline: false })
  is('the brand default is Amalfi Coast 32, plain', BRAND_LABEL_STYLE,
    { font_family: "'Amalfi Coast', cursive", font_size: 32, bold: false, underline: false })

  rememberLabelStyle(phone, 'cynthia', { font_family: NEUE, font_size: 32, bold: true, underline: true })
  is('the next label is Neue Haas 32, bold, underlined', labelStyleFor(phone, 'cynthia'),
    { font_family: NEUE, font_size: 32, bold: true, underline: true })

  // A reload or the next day: a new page reads the same device storage.
  is('it survives a reload', labelStyleFor(phone, 'cynthia').font_family, NEUE)

  rememberLabelStyle(phone, 'cynthia', { font_family: "'Schnyder', Georgia, serif", font_size: 32, bold: true, underline: true })
  is('a new font choice wins', labelStyleFor(phone, 'cynthia').font_family, "'Schnyder', Georgia, serif")

  is('another stylist on the same device keeps her own default', labelStyleFor(phone, 'maegan'), BRAND_LABEL_STYLE)

  const junk = device()
  junk.setItem('atelier-label-style:dana', '{not json')
  is('a broken saved value falls back to the default', labelStyleFor(junk, 'dana'), BRAND_LABEL_STYLE)
  junk.setItem('atelier-label-style:dana', JSON.stringify({ font_family: 7, font_size: 'big', bold: 'yes' }))
  is('a nonsense saved value falls back to the default', labelStyleFor(junk, 'dana'), BRAND_LABEL_STYLE)

  const broken = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } }
  rememberLabelStyle(broken, 'cynthia', { font_family: NEUE, font_size: 40, bold: false, underline: true })
  is('without storage it still remembers for this visit', labelStyleFor(broken, 'cynthia'),
    { font_family: NEUE, font_size: 40, bold: false, underline: true })
  is('no storage at all gives the default', labelStyleFor(null, 'nobody'), BRAND_LABEL_STYLE)
}

// AI-composed labels keep the brand script.
const compose = readFileSync(new URL('../src/lib/compose.ts', import.meta.url), 'utf8')
is('Compose labels stay Amalfi Coast', /const BRAND_LABEL_FONT = 'Amalfi Coast/.test(compose), true)
is('Compose does not read the remembered style', /labelStyle/.test(compose), false)

if (checked === 0) { console.error('check-label-style: inspected nothing'); process.exit(1) }
if (failures.length) { console.error('check-label-style FAILED:\n  ' + failures.join('\n  ')); process.exit(1) }
console.log(`check-label-style OK (${checked} checks)`)
