// Generates home-screen icons (apple-touch-icon + Android maskable/standard)
// from the WATSON glyph SVG, on a solid white tile with safe padding.
// Run: node scripts/gen-homescreen-icons.mjs
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pub = resolve(__dirname, '..', 'public');
const src = readFileSync(resolve(pub, 'brand', 'watson-icon-black.svg'));

// content fills this fraction of the tile; rest is white margin
const PAD = 0.82;
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };

const targets = [
  { name: 'apple-touch-icon.png', size: 180 },
  { name: 'icon-192.png', size: 192 },
  { name: 'icon-512.png', size: 512 },
];

for (const { name, size } of targets) {
  const inner = Math.round(size * PAD);
  const glyph = await sharp(src, { density: 400 })
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  await sharp({ create: { width: size, height: size, channels: 4, background: WHITE } })
    .composite([{ input: glyph, gravity: 'center' }])
    .png()
    .toFile(resolve(pub, name));

  console.log(`wrote public/${name} (${size}x${size})`);
}
