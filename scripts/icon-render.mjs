// Draws the app icon as PNG with no image libraries — a tiny rasterizer + Node's zlib.
// Shared by the web icons (gen-icons.mjs) and the Android app icons (android-setup.mjs).
import { deflateSync } from 'node:zlib';

const FROM = [37, 99, 235];
const TO = [14, 116, 144];
const BAND = [199, 219, 255];
const WHITE = [255, 255, 255];
/** Diagonal sapphire → teal gradient (the app's primary gradient). */
const grad = (u, v) => {
  const t = Math.min(1, Math.max(0, (u + v) / 2));
  return FROM.map((c, i) => c + (TO[i] - c) * t);
};

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const inRoundRect = (x, y, x0, y0, x1, y1, r) => {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};

/**
 * Icon shapes:
 *  rounded  — rounded tile, artwork full size (web "any" icons)
 *  maskable — full bleed, artwork in the central safe zone (web maskable, iOS)
 *  adaptive — full bleed, artwork inside Android's 66/108 adaptive-icon safe zone
 *  circle   — round tile (Android legacy round icon)
 */
const ART_SCALE = { rounded: 1, maskable: 0.72, adaptive: 0.6, circle: 0.82 };

function shade(u, v, shape) {
  const inside =
    shape === 'rounded' ? inRoundRect(u, v, 0, 0, 1, 1, 0.22) : shape === 'circle' ? (u - 0.5) ** 2 + (v - 0.5) ** 2 <= 0.25 : true;
  if (!inside) return null;
  const s = ART_SCALE[shape];
  const x = (u - 0.5) / s + 0.5;
  const y = (v - 0.5) / s + 0.5;
  if (inRoundRect(x, y, 0.19, 0.31, 0.81, 0.75, 0.07)) {
    if (y >= 0.4 && y <= 0.48) return BAND; // card band
    const d = (x - 0.69) ** 2 + (y - 0.6) ** 2;
    if (d <= 0.066 ** 2) return d <= 0.027 ** 2 ? WHITE : grad(u, v); // clasp
    return WHITE;
  }
  return grad(u, v);
}

/** PNG bytes of the icon at `size`×`size` pixels. */
export function renderIcon(size, shape = 'rounded') {
  const ss = 4; // 4×4 supersampling for smooth edges
  const out = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const c = shade((px + (sx + 0.5) / ss) / size, (py + (sy + 0.5) / ss) / size, shape);
          if (c) { r += c[0]; g += c[1]; b += c[2]; a++; }
        }
      }
      const i = (py * size + px) * 4;
      if (a) { out[i] = r / a; out[i + 1] = g / a; out[i + 2] = b / a; }
      out[i + 3] = Math.round((a / (ss * ss)) * 255);
    }
  }
  return png(size, out);
}
