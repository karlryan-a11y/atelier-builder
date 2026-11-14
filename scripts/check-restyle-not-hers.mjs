#!/usr/bin/env node
/**
 * NOTHING SHE NO LONGER HAS GOES ON A RESTYLE BOARD, AND EVERY SUCH PIECE IS NAMED.
 *
 * Paige Berndt, 2026-09-24: "these tall black boots do not show up as a transition item when I
 * click on the look and they show up on the board but they are not in her closet. This has
 * happened for multiple looks." GoodPix names a board picture's piece in `productId`. When that
 * id was not one of her pieces today, the converter drew it as a plain picture and nobody named
 * it: 83 such pictures on Alicia Hidalgo's 18 pulled looks on 2026-10-27, none of them a shop
 * product. lib/restyleBoard.ts now treats them as pieces she no longer has.
 *
 * The board below is shaped on Alicia Miami Capsule (Day): her pieces, a transitioned piece,
 * old pieces GoodPix no longer sends, and shop products, which must still come across as pictures
 * (Karl, 2026-09-18). Imports the SHIPPED planner.
 *
 *   node scripts/check-restyle-not-hers.mjs            # the shipped planner: must pass
 *   node scripts/check-restyle-not-hers.mjs --legacy   # the board before this fix: must FAIL
 */
const G = await import('../src/lib/goodpixLayout.ts')
const S = await import('../src/lib/restyleSelection.ts')
const LEGACY = process.argv.includes('--legacy')
const B = LEGACY ? null : await import('../src/lib/restyleBoard.ts')

const problems = []
let checks = 0
const ok = (name, cond) => { checks++; if (!cond) { problems.push(name); console.error(`   ❌ ${name}`) } }

const H = (c) => c.repeat(32)
const s3 = (h) => `https://goodpix-co.s3.amazonaws.com/compressed-large-${h}.png`
const img = (o) => ({ type: 'Image', width: 300, height: 400, scaleX: 1, scaleY: 1, left: 10, top: 10, ...o })
const layout = {
  v: 1, canvas: { width: 1080, height: 1080 }, v1_primary: null,
  pool: [{ id: 'HERS1', urls: [s3(H('a'))] }],
  objects: [
    img({ productId: 'HERS1', src: s3(H('a')) }),                                 // hers, still owned
    img({ productId: 'HERS2', src: 'https://goodpix-co.s3.amazonaws.com/cloudinary/goodpix-dev/x1.jpg' }), // hers, by id only
    img({ productId: 'TRANS1', src: s3(H('b')) }),                                 // hers, transitioned out
    img({ productId: 'GONE1', src: 'https://d1h0n5niljcjo3.cloudfront.net/400x0/GoodPix/Contents/t/content_GONE1_0.png', mirror: 'boots.png' }), // the tall boots
    img({ productId: 'GONE2', src: 'https://goodpix-co.s3.amazonaws.com/cloudinary/goodpix-dev/lezd1lsm7m.jpg' }),
    img({ productId: 'GONE1', src: 'https://d1h0n5niljcjo3.cloudfront.net/400x0/GoodPix/Contents/t/content_GONE1_0.png', mirror: 'boots.png', left: 500 }), // same boots twice
    img({ productId: 'SHOP1', src: 'https://goodpix-co.s3.amazonaws.com/cloudinary/goodpix-dev/shop1.jpg' }),  // on the board's product list
    img({ productId: 'SHOP2', src: 'https://bottega-veneta.dam.kering.com/m/bag.jpg' }),                     // a retailer's own picture
    img({ src: 'https://example.com/sticker.png' }),                                                        // a picture with no id
    { type: 'Textbox', text: 'Look 5:', left: 1, top: 1, width: 100, fontSize: 30 },
  ],
}
const closetItemIds = ['HERS1', 'HERS2', 'TRANS1', 'POOLONLY']
const piece = (id, o = {}) => [id, { id, name: `name of ${id}`, brand: null, urls: [], ...o }]
const pieces = new Map([
  piece('HERS1', { urls: [s3(H('a'))] }),
  piece('HERS2'),
  piece('TRANS1', { transitionedAt: '2026-09-08T00:00:00Z', urls: [s3(H('b'))] }),
  piece('POOLONLY'),
])
const storeProducts = new Set(['SHOP1'])
const mirrorUrl = (k) => `https://mirror.invalid/${k}`

let plan
if (LEGACY) {
  // lib/goodpixBoard.ts as it was: no `gone`, so an id that is not hers is a picture.
  const extraUrls = new Map([...pieces].map(([id, p]) => [id, p.urls]))
  const inPicture = G.piecesInLayout(layout, extraUrls)
  const { keep, omitted } = S.selectRestylePieces(inPicture, pieces)
  const keepSet = new Set(keep)
  const conversion = G.convertGoodPixLayout(layout, { keep: (id) => keepSet.has(id), extraUrls, mirrorUrl, idPrefix: 'look01' })
  const shown = new Set(inPicture)
  const notInPicture = closetItemIds.filter((id) => !shown.has(id) && pieces.has(id)).map((id) => ({ id, reason: 'not_in_picture' }))
  plan = { conversion, omitted, notInPicture }
} else {
  plan = B.planGoodPixBoard('look01', layout, closetItemIds, pieces, storeProducts, mirrorUrl)
}
const nodes = plan.conversion.canvas.nodes
const onBoardPieces = nodes.filter((n) => n.type === 'closet_item').map((n) => n.closet_item_id)
const onBoardProducts = nodes.filter((n) => n.type === 'picture').map((n) => n.product_id)
const omittedIds = plan.omitted.map((o) => o.id)

ok('her pieces stay on the board', onBoardPieces.includes('HERS1') && onBoardPieces.includes('HERS2'))
ok('a transitioned piece is left off and named as transitioned out',
  !onBoardPieces.includes('TRANS1') && plan.omitted.some((o) => o.id === 'TRANS1' && o.reason === 'transitioned'))
ok('a piece GoodPix no longer sends is not on the board, as a piece or as a picture',
  !onBoardPieces.includes('GONE1') && !onBoardProducts.includes('GONE1') && !onBoardProducts.includes('GONE2'))
ok('every piece she no longer has is named once', omittedIds.filter((id) => id === 'GONE1').length === 1 && omittedIds.includes('GONE2'))
const boots = plan.omitted.find((o) => o.id === 'GONE1')
ok('it is named as no longer in her collection, with its picture',
  !!boots && boots.reason === 'missing' && boots.name === S.MISSING_NAME && boots.image === mirrorUrl('boots.png'))
ok('a shop product on the board\'s list is still a picture (Karl, 2026-09-18)', onBoardProducts.includes('SHOP1'))
ok('a retailer\'s own picture is still a picture', onBoardProducts.includes('SHOP2'))
ok('a picture with no id is still a picture', onBoardProducts.includes(null))
ok('shop products are not called pieces she no longer has', !omittedIds.includes('SHOP1') && !omittedIds.includes('SHOP2'))
ok('handwriting still comes across', nodes.some((n) => n.type === 'text' && n.content === 'Look 5:'))
ok('"Not in the original picture" stays its own list',
  plan.notInPicture.map((o) => o.id).join() === 'POOLONLY' && !omittedIds.includes('POOLONLY'))
// Nothing on the board that is not hers today: every piece node is one she still owns.
const stillHers = (id) => { const p = pieces.get(id); return !!p && !S.omitReason(p) }
ok('every piece on the board is in her closet today', onBoardPieces.every(stillHers))

if (checks === 0) { console.error('\n❌ restyle-not-hers: nothing checked.\n'); process.exit(1) }
if (problems.length) {
  console.error(`\n❌ restyle-not-hers: ${problems.length} of ${checks} failed${LEGACY ? ' (--legacy: this is the point)' : ''}.\n`)
  process.exit(1)
}
console.log(`\n✅ restyle-not-hers: ${checks} checks; nothing she no longer has reaches the board, and each is named.\n`)
