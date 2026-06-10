// Generates the icon set with no dependencies: a minimal PNG encoder draws
// a dark rounded square with an orange equals sign. Usage: node scripts/gen-icon.ts
import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "src-tauri/icons");

// ---- tiny PNG encoder (RGBA, no filters)

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size: number, rgba: Buffer): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  // scanlines with filter byte 0
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---- drawing: dark rounded square, orange "equals" bars
// 4x supersampling for smooth edges

const BG = [0x24, 0x25, 0x2a]; // dark slate
const FG = [0xe8, 0x92, 0x3c]; // summarum orange

function draw(size: number): Buffer {
  const ss = 4;
  const S = size * ss;
  const corner = S * 0.22;
  const px = Buffer.alloc(size * size * 4);

  const insideRoundRect = (x: number, y: number): boolean => {
    const r = corner;
    const cx = Math.max(r, Math.min(S - r, x));
    const cy = Math.max(r, Math.min(S - r, y));
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  };

  // equals bars geometry (relative to S)
  const barW = S * 0.52;
  const barH = S * 0.115;
  const barR = barH / 2;
  const x0 = (S - barW) / 2;
  const topY = S * 0.355;
  const botY = S * 0.53;

  const insideBar = (x: number, y: number, by: number): boolean => {
    if (x < x0 || x > x0 + barW || y < by || y > by + barH) return false;
    const cx = Math.max(x0 + barR, Math.min(x0 + barW - barR, x));
    const cy = by + barR;
    return (x - cx) ** 2 + (y - cy) ** 2 <= barR * barR || (x >= x0 + barR && x <= x0 + barW - barR);
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bgHits = 0;
      let fgHits = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const X = x * ss + sx + 0.5;
          const Y = y * ss + sy + 0.5;
          if (!insideRoundRect(X, Y)) continue;
          bgHits++;
          if (insideBar(X, Y, topY) || insideBar(X, Y, botY)) fgHits++;
        }
      }
      const total = ss * ss;
      const alpha = Math.round((bgHits / total) * 255);
      const fgRatio = bgHits > 0 ? fgHits / bgHits : 0;
      const i = (y * size + x) * 4;
      px[i] = Math.round(BG[0] + (FG[0] - BG[0]) * fgRatio);
      px[i + 1] = Math.round(BG[1] + (FG[1] - BG[1]) * fgRatio);
      px[i + 2] = Math.round(BG[2] + (FG[2] - BG[2]) * fgRatio);
      px[i + 3] = alpha;
    }
  }
  return px;
}

fs.mkdirSync(outDir, { recursive: true });
const pngs = new Map<number, Buffer>();
for (const size of [16, 32, 48, 64, 128, 256, 512]) {
  pngs.set(size, encodePng(size, draw(size)));
}

const files: Array<[string, number]> = [
  ["32x32.png", 32],
  ["128x128.png", 128],
  ["128x128@2x.png", 256],
  ["icon.png", 512],
];
for (const [name, size] of files) {
  fs.writeFileSync(path.join(outDir, name), pngs.get(size)!);
  console.log(`${name} (${size}px)`);
}

// .ico with PNG-compressed entries
function buildIco(sizes: number[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  const dirs: Buffer[] = [];
  const blobs: Buffer[] = [];
  let offset = 6 + sizes.length * 16;
  for (const s of sizes) {
    const data = pngs.get(s)!;
    const dir = Buffer.alloc(16);
    dir.writeUInt8(s >= 256 ? 0 : s, 0);
    dir.writeUInt8(s >= 256 ? 0 : s, 1);
    dir.writeUInt16LE(1, 4);
    dir.writeUInt16LE(32, 6);
    dir.writeUInt32LE(data.length, 8);
    dir.writeUInt32LE(offset, 12);
    offset += data.length;
    dirs.push(dir);
    blobs.push(data);
  }
  return Buffer.concat([header, ...dirs, ...blobs]);
}

fs.writeFileSync(path.join(outDir, "icon.ico"), buildIco([16, 32, 48, 64, 128, 256]));
console.log("icon.ico (6 sizes)");
