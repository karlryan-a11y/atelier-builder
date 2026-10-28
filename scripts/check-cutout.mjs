#!/usr/bin/env node
/**
 * Remove BG never keeps a result that cut into the piece, and can be undone (Cynthia Dada, 10/14:
 * Mr. C's white pinstripe Dior shirt came back with only its stripes; the only fix was a new photo).
 *
 * Holds:
 *   - lib/cutoutCheck.mjs refuses a pinstripe shirt whose white cloth went see-through, and a cutout
 *     that is nearly empty; it keeps a whole shirt, a shirt with a real opening (a bag handle), and
 *     a fine chain necklace (see-through by design).
 *   - Every Remove BG in the builder goes through api/remove-bg.ts (which runs that check and puts
 *     the photo back), never straight to the intake-remove-bg-item function.
 *   - The Edit piece dialog offers Undo Remove BG while a Remove BG result is showing.
 * Fails on the code before this change (no lib/cutoutCheck.mjs, four direct remover calls, no Undo).
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
let checked = 0
const failures = []
const ok = (c, m) => { checked++; if (!c) failures.push(m) }
// `node scripts/check-cutout.mjs <another checkout>` reads that checkout's code (how it was seen
// failing on the old code); the pictures are always judged with this checkout's lib.
const ROOT = process.argv[2] || new URL('..', import.meta.url).pathname

if (!existsSync(join(ROOT, 'lib/cutoutCheck.mjs')) || !existsSync(join(ROOT, 'api/remove-bg.ts'))) {
  console.error('check-cutout: FAIL - no lib/cutoutCheck.mjs / api/remove-bg.ts, so Remove BG saves whatever comes back, even a shirt with its cloth cut out')
  process.exit(1)
}
const sharp = (await import('sharp')).default
const { judgeCutout } = await import(new URL('../lib/cutoutCheck.mjs', import.meta.url).pathname)

// A 600x800 picture with a shirt-shaped piece. paint(x, y) says whether a pixel is the piece.
async function cutout(paint) {
  const W = 600, H = 800
  const px = Buffer.alloc(W * H * 4)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4
    px[i] = 240; px[i + 1] = 240; px[i + 2] = 240
    px[i + 3] = paint(x, y) ? 255 : 0
  }
  return sharp(px, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer()
}
const body = (x, y) => (x >= 150 && x < 450 && y >= 120 && y < 720) || (y >= 120 && y < 260 && x >= 60 && x < 540)

const whole = await judgeCutout(await cutout(body), null, { category: 'shirts', name: 'Pinstripe Dress Shirt' })
ok(whole.ok, `a whole shirt must be kept (holes ${whole.holes})`)

// Mr. C's case: only the pinstripes (2 px every 7 px) survived; the white cloth between went see-through.
const stripes = await judgeCutout(await cutout((x, y) => body(x, y) && x % 7 < 2), null, { category: 'shirts', name: 'Pinstripe Dress Shirt' })
ok(!stripes.ok && stripes.holes > 0.5, `a pinstripe shirt with its white cloth cut out must be refused (holes ${stripes.holes})`)
ok(/couldn't be removed cleanly/.test(stripes.reason || '') && /unchanged/.test(stripes.reason || ''), 'the refusal must say, in plain words, that the photo is unchanged')

// Small patches eaten out of the middle of the body (Cynthia's screenshot): 8 px blocks, one in three.
const speckle = await judgeCutout(await cutout((x, y) => body(x, y) && !(x > 180 && x < 420 && y > 300 && y < 650 && ((x >> 3) + (y >> 3)) % 3 === 0)), null, { category: '', name: 'White Shirt' })
ok(!speckle.ok, `a shirt with speckled holes through its body must be refused (holes ${speckle.holes})`)

// A real opening is not damage: a 60 px hole (a bag handle's opening) in a solid piece.
const handle = await judgeCutout(await cutout((x, y) => body(x, y) && !((x - 300) ** 2 + (y - 450) ** 2 < 60 ** 2)), null, { category: 'handbags', name: 'Tote' })
ok(handle.ok, `a piece with a real opening must be kept (holes ${handle.holes})`)

// A fine chain necklace is see-through by design.
const chain = await judgeCutout(await cutout((x, y) => Math.abs(Math.hypot(x - 300, (y - 400) * 0.7) - 220) < 6 && (x + y) % 6 < 3), null, { category: 'jewelry', name: 'Long Necklace' })
ok(chain.ok, `a chain necklace must be kept (holes ${chain.holes})`)

const empty = await judgeCutout(await cutout((x, y) => x > 290 && x < 300 && y > 390 && y < 400), null, { category: 'shirts', name: 'Shirt' })
ok(!empty.ok, 'a cutout with almost nothing left must be refused')

// Compared with an earlier cutout of the same size: a third of the shirt gone is refused.
const halfGone = await judgeCutout(await cutout((x, y) => body(x, y) && y < 420), await cutout(body), { category: 'shirts', name: 'Shirt' })
ok(!halfGone.ok && halfGone.drop > 0.3, `a cutout that lost a large part of the shirt must be refused (drop ${halfGone.drop})`)

// Every Remove BG goes through the checked route.
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : /\.(tsx?|mjs)$/.test(f) ? [p] : [] })
const direct = walk(join(ROOT, 'src')).filter((f) => readFileSync(f, 'utf8').includes('intake-remove-bg-item'))
ok(direct.length === 0, `Remove BG called without the check in: ${direct.map((f) => f.replace(ROOT, '')).join(', ')}`)
const api = readFileSync(join(ROOT, 'api/remove-bg.ts'), 'utf8')
ok(/intake-remove-bg-item/.test(api) && /judgeCutout\(/.test(api), 'api/remove-bg.ts must run the remover and then the check')
ok(/damaged: true/.test(api) && /patchFor\([^)]*before/.test(api), 'a refused cutout must put the photo from before back')
ok(/action === 'undo'/.test(api) && /bg_backup/.test(api), 'api/remove-bg.ts must put back raw.bg_backup on Undo')
ok(/requireStaff\(req, res\)/.test(api) && /Authorization: `Bearer \$\{token\}`/.test(api), 'reads and writes must go out with the caller\'s own sign-in (a limited stylist reaches only her clients)')

const lib = readFileSync(join(ROOT, 'src/lib/removeBackground.ts'), 'utf8')
ok(/\/api\/remove-bg/.test(lib), 'src/lib/removeBackground.ts must call api/remove-bg')
const col = readFileSync(join(ROOT, 'src/components/categorize/CollectionTab.tsx'), 'utf8')
ok(/removeBackground\(editing\.id/.test(col) && /removeBackground\(item\.id/.test(col), 'the Edit dialog and bulk Remove background must both use removeBackground')
ok(/onUndoRemoveBackground=\{isRemoveBgResult\(editing\)/.test(col), 'the Edit piece dialog must offer Undo while a Remove BG result is showing')
ok(/undoRemoveBg[\s\S]{0,400}requestHeroRefresh\(editing\.id\)/.test(col), 'Undo must refresh the look and capsule heroes, like Replace photo')
const dlg = readFileSync(join(ROOT, 'src/components/layout/EditItemDialog.tsx'), 'utf8')
ok(/onUndoRemoveBackground && \(/.test(dlg) && /Undo Remove BG/.test(dlg), 'the Edit piece dialog has no Undo Remove BG button')

if (failures.length) {
  console.error(`check-cutout: FAIL (${failures.length} of ${checked})`)
  for (const f of failures) console.error('  - ' + f)
  process.exit(1)
}
console.log(`check-cutout: ok (${checked} assertions: whole, pinstripes, speckle, opening, chain, empty, drop, one route, undo)`)
