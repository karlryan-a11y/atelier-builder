#!/usr/bin/env node
/**
 * A RESTYLED GOODPIX LOOK KEEPS EVERY PIECE IN ITS BOX, WHATEVER PHOTO ATELIER HAS FOR IT.
 *
 * Cynthia Dada, 2026-10-21, Chris Cadieux: "If I open something on canvas after updating a photo
 * of a garment, it messed up the placement of the garment" (Look 11: the new Brunello jeans photo
 * came in too big), and "it made the belt and shoe small on this look and those weren't updated
 * images" (Look 24: the Magnanni belt and Tom Ford loafer came in tiny).
 *
 * The converter only carried GoodPix's box HEIGHT (`target_height`) and the board sized the photo
 * Atelier loads by that height alone. Whenever that photo is not the one GoodPix drew (a replaced
 * photo, a different crop, transparent padding around the piece), the piece comes out the wrong
 * size. lib/goodpixLayout.ts fitPiecesToPhotos now fits the photo's VISIBLE piece into the box,
 * and leaves a piece whose photo is GoodPix's own shape exactly as it was.
 *
 * Graded the way the board draws (LookCanvas: scale = target_height / naturalHeight, clamped), over
 * the SHIPPED converter. Offline: no database. Exits non-zero on any failure and on zero cases.
 */
const G = await import('../src/lib/goodpixLayout.ts')

const problems = []
let cases = 0
const ok = (name, c) => { cases++; if (!c) { problems.push(name); console.error(`   ❌ ${name}`) } }
const near = (a, b, tol) => Math.abs(a - b) <= tol

const H = 'b'.repeat(32)
const base = { v: 1, canvas: { width: 1080, height: 1080 }, v1_primary: { width: 1080, height: 1080 }, pool: [{ id: 'P1', urls: [`https://goodpix-co.s3.amazonaws.com/processed-original-${H}.png`] }] }
const img = (o) => ({ type: 'Image', scaleX: 1, scaleY: 1, src: `https://goodpix-co.s3.amazonaws.com/processed-large-${H}.png`, ...o })
const mirrorUrl = (k) => `https://example.invalid/${k}`

/** Convert one piece, fit it to `photo`, and say where the board draws its visible part.
 *  `gpPhoto` is the photo GoodPix itself drew in the box, when it was measured. */
function drawn(obj, photo, gpPhoto) {
  const conv = G.convertGoodPixLayout({ ...base, objects: [obj] }, { keep: () => true, mirrorUrl })
  const node0 = conv.canvas.nodes[0]
  const fitted = G.fitPiecesToPhotos(conv.canvas, conv.boxes, new Map([[node0.id, photo]]),
    gpPhoto ? new Map([[node0.id, gpPhoto]]) : undefined)
  const n = fitted.nodes[0]
  const s = Math.min(Math.max(n.target_height / photo.height, 0.03), 3.0)   // LookCanvas.tsx
  const c = photo.content ?? { x: 0, y: 0, width: photo.width, height: photo.height }
  const r = (n.rotation * Math.PI) / 180, cos = Math.cos(r), sin = Math.sin(r)
  const u = (c.x + c.width / 2) * s * (n.flipped ? -1 : 1), v = (c.y + c.height / 2) * s
  return {
    before: node0, node: n, box: conv.boxes[0],
    cx: n.x + cos * u - sin * v, cy: n.y + sin * u + cos * v,
    w: c.width * s, h: c.height * s,
  }
}

// 1. Look 24's belt: GoodPix drew a trimmed flat belt 300x14; Atelier's photo of the same belt is a
//    square with the belt across its middle. Today: 14 board px for the whole square, a speck.
{
  const d = drawn(img({ left: 700, top: 560, width: 600, height: 28, scaleX: 0.5, scaleY: 0.5 }),
    { width: 1000, height: 1000, content: { x: 0, y: 476, width: 1000, height: 48 } })
  ok('the belt (photo padded around the piece) is drawn the width of its GoodPix box', near(d.w, d.box.w, d.box.w * 0.05))
  ok('the belt is centred where GoodPix drew it', near(d.cx, d.box.cx, 2) && near(d.cy, d.box.cy, 2))
}

// 2. Look 24's loafer: GoodPix drew it 180x90; Atelier's photo is 1200x1200 with the shoe inside.
{
  const d = drawn(img({ left: 300, top: 900, width: 360, height: 180, scaleX: 0.5, scaleY: 0.5 }),
    { width: 1200, height: 1200, content: { x: 100, y: 400, width: 1000, height: 500 } })
  ok('the loafer fills its GoodPix box, not a sliver of it', near(d.w, d.box.w, d.box.w * 0.05) && near(d.h, d.box.h, d.box.h * 0.05))
  ok('the loafer is centred where GoodPix drew it', near(d.cx, d.box.cx, 2) && near(d.cy, d.box.cy, 2))
}

// 3. Look 11's jeans after the photo was replaced: GoodPix drew 220x520; the new photo is a wider
//    800x1000. Today: 520 tall and 416 wide, over the shoes and the label. Now it fits inside.
{
  const d = drawn(img({ left: 400, top: 300, width: 440, height: 1040, scaleX: 0.5, scaleY: 0.5 }),
    { width: 800, height: 1000, content: null })
  ok('the new jeans photo stays inside its GoodPix box', d.w <= d.box.w + 1 && d.h <= d.box.h + 1)
  ok('the new jeans photo fills the box on one side', near(d.w, d.box.w, 1) || near(d.h, d.box.h, 1))
  ok('the new jeans photo is centred in its box', near(d.cx, d.box.cx, 2) && near(d.cy, d.box.cy, 2))
}

// 3b. The tester on the preview, 2026-10-25, Looks 11 and 24: the new jeans ran from the shirt to
//     the bottom of the board, over both loafers, about 30% too tall. GoodPix's OWN jeans photo had
//     transparent space around the jeans, so its box is bigger than the jeans GoodPix drew. The new
//     photo has to fill the jeans GoodPix drew, not the box. GoodPix's photo here is the 2x copy
//     (880x2080) with the jeans at x 140..740, y 240..1600: in the box, 150 wide, 340 tall, from
//     (35, 60), so centred at (510, 530) on the board.
{
  const gp = { width: 880, height: 2080, content: { x: 140, y: 240, width: 600, height: 1360 } }
  const d = drawn(img({ left: 400, top: 300, width: 440, height: 1040, scaleX: 0.5, scaleY: 0.5 }),
    { width: 800, height: 1000, content: { x: 250, y: 0, width: 300, height: 1000 } }, gp)
  ok('the new jeans are no taller than the jeans GoodPix drew (not its padded box)', d.h <= 340 + 1)
  ok('the new jeans are no wider than the jeans GoodPix drew', d.w <= 150 + 1)
  ok('the new jeans fill the jeans GoodPix drew on one side', near(d.w, 150, 1) || near(d.h, 340, 1))
  ok('the new jeans sit where GoodPix drew the jeans', near(d.cx, 510, 2) && near(d.cy, 530, 2))
}
// 3c. GoodPix's photo measured with no see-through space: the whole box is the piece, as in 3.
{
  const gp = { width: 440, height: 1040, content: { x: 0, y: 0, width: 440, height: 1040 } }
  const d = drawn(img({ left: 400, top: 300, width: 440, height: 1040, scaleX: 0.5, scaleY: 0.5 }),
    { width: 800, height: 1000, content: null }, gp)
  ok('with a full GoodPix photo the new jeans fill the box on one side', near(d.w, d.box.w, 1) || near(d.h, d.box.h, 1))
  ok('with a full GoodPix photo the new jeans are centred in the box', near(d.cx, d.box.cx, 2) && near(d.cy, d.box.cy, 2))
}

// 4. Turned and mirrored pieces land in their box too (the frame math has to follow the node).
for (const flip of [{}, { flipX: true }, { flipY: true }, { flipX: true, flipY: true }]) {
  const d = drawn(img({ left: 500, top: 500, width: 400, height: 200, angle: 30, originX: 'center', originY: 'center', ...flip }),
    { width: 1000, height: 1000, content: { x: 50, y: 300, width: 900, height: 450 } })
  ok(`a turned piece ${JSON.stringify(flip)} is centred in its box`, near(d.cx, d.box.cx, 2) && near(d.cy, d.box.cy, 2))
  ok(`a turned piece ${JSON.stringify(flip)} is its box's size`, near(d.w, d.box.w, d.box.w * 0.05))
}

// 5. NOTHING MOVES when Atelier has GoodPix's own photo (same shape, any resolution), even if the
//    photo has transparent edges: that is how it looked in GoodPix too.
{
  const d = drawn(img({ left: 120, top: 80, width: 500, height: 700, scaleX: 0.6, scaleY: 0.6 }),
    { width: 1000, height: 1400, content: { x: 100, y: 100, width: 800, height: 1200 } })
  ok('a piece with its GoodPix photo opens exactly as before', JSON.stringify(d.node) === JSON.stringify(d.before))
}
{
  const conv = G.convertGoodPixLayout({ ...base, objects: [img({ left: 10, top: 10, width: 100, height: 200 })] }, { keep: () => true, mirrorUrl })
  const fitted = G.fitPiecesToPhotos(conv.canvas, conv.boxes, new Map())
  ok('a piece whose photo could not be measured opens exactly as before', JSON.stringify(fitted) === JSON.stringify(conv.canvas))
}

if (cases === 0) { console.error('\n❌ goodpix-fit: nothing inspected. Nothing was verified.\n'); process.exit(1) }
if (problems.length) { console.error(`\n❌ goodpix-fit: ${problems.length} of ${cases} case(s) failed.\n`); process.exit(1) }
console.log(`\n✅ goodpix-fit: ${cases} case(s), every piece opens in its GoodPix box.\n`)
