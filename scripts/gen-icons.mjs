// Generate the extension icons (PNG, RGBA) with no external dependencies.
// The mark is a rounded dark card holding a "C" — a ring open to the right, its
// stroke sweeping through the palette the UI itself uses. It carries both halves
// of the name: the initial, and one way running through the colors.
//
// Output goes to public/icons/, which build.mjs copies verbatim into every
// dist/<target>/. Run with: node scripts/gen-icons.mjs

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { root } from "./version.mjs";

const outDir = join(root, "public", "icons");

// tokens.css: --fg for the card, then --accent, --ok, --warn, --danger as the stops the
// stroke travels through. Three flat segments read as a well-known multicolor ring; a
// sweep does not, and says what the name says — one way, running through the colors.
const CARD = [0x16, 0x18, 0x1d];
const STOPS = [
  [0x2f, 0x81, 0xf7],
  [0x16, 0xa3, 0x4a],
  [0xd9, 0x77, 0x06],
  [0xdc, 0x26, 0x26],
];

const SIZES = [16, 32, 48, 128];
const SS = 4; // supersampling factor, for anti-aliased edges

/** Is (u,v) inside the rounded rectangle [x0,y0,x1,y1] with corner radius r? */
function insideRoundRect(u, v, x0, y0, x1, y1, r) {
  if (u < x0 || u > x1 || v < y0 || v > y1) return false;
  const dx = Math.max(x0 + r - u, 0, u - (x1 - r));
  const dy = Math.max(y0 + r - v, 0, v - (y1 - r));
  return dx * dx + dy * dy <= r * r;
}

// The ring, in unit-square coordinates around the card's center. The thickness is what
// keeps the C readable at 16px, where the stroke is under 3px wide.
const RING_OUTER = 0.36;
const RING_INNER = 0.185;

// The C's opening, centered on the 3 o'clock direction.
const MOUTH = 92; // degrees, total
const STROKE_START = MOUTH / 2;
const STROKE_SPAN = 360 - MOUTH;

/** The stop color at `t` (0 at the mouth's upper lip, 1 at its lower one). */
function strokeColor(t) {
  const segments = STOPS.length - 1;
  const scaled = t * segments;
  const index = Math.min(Math.floor(scaled), segments - 1);
  const from = STOPS[index];
  const to = STOPS[index + 1];
  const f = scaled - index;
  return [
    from[0] + (to[0] - from[0]) * f,
    from[1] + (to[1] - from[1]) * f,
    from[2] + (to[2] - from[2]) * f,
  ];
}

/** The color at a point of the unit square, or null where the icon is transparent. */
function sample(u, v) {
  if (!insideRoundRect(u, v, 0.04, 0.04, 0.96, 0.96, 0.2)) return null;

  const dx = u - 0.5;
  const dy = 0.5 - v; // image space grows downward; flip it so angles read as usual
  const radius = Math.hypot(dx, dy);
  if (radius >= RING_INNER && radius <= RING_OUTER) {
    // Counter-clockwise from the mouth's upper lip — the direction a C is written in.
    const degrees = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
    if (degrees >= STROKE_START && degrees <= STROKE_START + STROKE_SPAN) {
      return strokeColor((degrees - STROKE_START) / STROKE_SPAN);
    }
  }
  return CARD;
}

function renderPixel(size, px, py) {
  let r = 0;
  let g = 0;
  let b = 0;
  let covered = 0;
  for (let sy = 0; sy < SS; sy++) {
    for (let sx = 0; sx < SS; sx++) {
      const c = sample((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size);
      if (!c) continue;
      r += c[0];
      g += c[1];
      b += c[2];
      covered++;
    }
  }
  if (covered === 0) return [0, 0, 0, 0];
  // Average only the covered subsamples, so an edge pixel keeps the shape's own
  // color and fades through alpha instead of through a muddied color.
  return [
    Math.round(r / covered),
    Math.round(g / covered),
    Math.round(b / covered),
    Math.round((covered / (SS * SS)) * 255),
  ];
}

/** The image as PNG scanlines: one leading filter byte per row, then RGBA pixels. */
function rawImage(size) {
  const rowLen = size * 4 + 1;
  const raw = Buffer.alloc(rowLen * size);
  for (let y = 0; y < size; y++) {
    raw[y * rowLen] = 0; // filter type: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = renderPixel(size, x, y);
      const off = y * rowLen + 1 + x * 4;
      raw[off] = r;
      raw[off + 1] = g;
      raw[off + 2] = b;
      raw[off + 3] = a;
    }
  }
  return raw;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(size) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  const idat = deflateSync(rawImage(size), { level: 9 });
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync(outDir, { recursive: true });
for (const size of SIZES) {
  writeFileSync(join(outDir, `icon-${size}.png`), encodePng(size));
  console.log(`wrote public/icons/icon-${size}.png`);
}
