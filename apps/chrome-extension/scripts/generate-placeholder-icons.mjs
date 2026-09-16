/**
 * Generates the placeholder extension icons.
 *
 * `manifest.json` references four icons and CRXJS refuses to build when they are missing, so
 * a repository without them cannot produce a loadable `dist/`. These are deliberately plain
 * — a rounded accent tile with a white ring — because they are placeholders for real
 * artwork, not artwork: they exist so `pnpm build` and "Load unpacked" work before a
 * designer is involved.
 *
 * Usage: `node scripts/generate-placeholder-icons.mjs` from this workspace.
 * Writes `public/icons/icon-{16,32,48,128}.png`. No dependencies beyond Node itself.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Icon sizes Chrome asks for in the manifest. */
const SIZES = [16, 32, 48, 128];

/** Tile colour, matching `--color-accent` in the popup stylesheet. */
const ACCENT = [0x6c, 0x8c, 0xff];
/** Glyph colour. */
const GLYPH = [0x0b, 0x0e, 0x14];

/** CRC-32 table, built once. PNG requires a checksum on every chunk. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

/** CRC-32 of a buffer, as PNG specifies. */
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** One PNG chunk: length, type, payload, and the CRC over type+payload. */
function chunk(type, payload) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(payload.length, 0);
  const typeAndPayload = Buffer.concat([Buffer.from(type, 'ascii'), payload]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndPayload), 0);
  return Buffer.concat([length, typeAndPayload, crc]);
}

/** Builds one RGBA icon of `size` pixels: a rounded tile with a centred ring. */
function renderIcon(size) {
  const radius = size * 0.22;
  const ringOuter = size * 0.34;
  const ringInner = size * 0.22;
  const centre = size / 2;

  // Each scanline is prefixed with its filter byte (0 = none).
  const raw = Buffer.alloc(size * (1 + size * 4));

  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (1 + size * 4);
    raw[rowStart] = 0;

    for (let x = 0; x < size; x += 1) {
      const offset = rowStart + 1 + x * 4;
      const dx = Math.abs(x + 0.5 - centre);
      const dy = Math.abs(y + 0.5 - centre);

      // Rounded rectangle: within the tile's half-extent, and either inside a straight
      // edge or inside the corner arc that replaces the corner it would have had.
      const half = size / 2;
      const inTile = dx <= half && dy <= half && cornerInside(dx, dy, half - radius, radius);

      const distance = Math.hypot(x + 0.5 - centre, y + 0.5 - centre);
      const inRing = distance <= ringOuter && distance >= ringInner;

      if (!inTile) {
        raw[offset + 3] = 0;
        continue;
      }

      const colour = inRing ? GLYPH : ACCENT;
      raw[offset] = colour[0];
      raw[offset + 1] = colour[1];
      raw[offset + 2] = colour[2];
      raw[offset + 3] = 255;
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** True when a point at distance (dx, dy) from the centre is inside the rounded corner. */
function cornerInside(dx, dy, straightEdge, radius) {
  if (dx <= straightEdge || dy <= straightEdge) {
    return true;
  }
  const cornerX = dx - straightEdge;
  const cornerY = dy - straightEdge;
  return Math.hypot(cornerX, cornerY) <= radius;
}

const outputDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(outputDir, { recursive: true });

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

for (const size of SIZES) {
  const file = join(outputDir, `icon-${size}.png`);
  writeFileSync(file, renderIcon(size));

  // Read it back and check the header, because a hand-rolled PNG encoder is exactly the
  // kind of code that happily writes a plausible-looking file no decoder can open.
  const written = readFileSync(file);
  const width = written.readUInt32BE(16);
  const height = written.readUInt32BE(20);
  if (!written.subarray(0, 8).equals(PNG_SIGNATURE) || width !== size || height !== size) {
    throw new Error(`icon-${size}.png is not a valid ${size}x${size} PNG`);
  }
  console.log(`wrote ${file} (${width}x${height}, ${written.length} bytes)`);
}
