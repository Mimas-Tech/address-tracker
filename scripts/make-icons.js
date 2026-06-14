// scripts/make-icons.js — generate simple placeholder icons (white house on a
// blue square) so the manifest loads. Run: node scripts/make-icons.js
// Replace icons/*.png with real artwork before any store submission.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const BG = [37, 99, 235, 255];   // brand blue
const FG = [255, 255, 255, 255]; // white

function pixel(x, y, n) {
  const u = x / n, v = y / n;
  // roof: triangle, apex top-centre down to the eaves
  const inRoof = v >= 0.20 && v <= 0.48 &&
    Math.abs(u - 0.5) <= (v - 0.20) / (0.48 - 0.20) * 0.30;
  // body
  const inBody = u >= 0.28 && u <= 0.72 && v >= 0.46 && v <= 0.80;
  // door (punch back to blue)
  const inDoor = u >= 0.44 && u <= 0.56 && v >= 0.58 && v <= 0.80;
  return (inRoof || inBody) && !inDoor ? FG : BG;
}

function makePng(n) {
  const raw = Buffer.alloc((n * 4 + 1) * n);
  let p = 0;
  for (let y = 0; y < n; y++) {
    raw[p++] = 0; // filter: none
    for (let x = 0; x < n; x++) {
      const c = pixel(x, y, n);
      raw[p++] = c[0]; raw[p++] = c[1]; raw[p++] = c[2]; raw[p++] = c[3];
    }
  }
  return chunksToPng(n, zlib.deflateSync(raw));
}

function chunksToPng(n, idatData) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(n, 0); ihdr.writeUInt32BE(n, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // colour type: RGBA
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idatData), chunk('IEND', Buffer.alloc(0))]);
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0, 0);
  return Buffer.concat([len, body, crc]);
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ 0xffffffff;
}

const outDir = path.join(__dirname, '..', 'icons');
fs.mkdirSync(outDir, { recursive: true });
for (const size of [16, 48, 128]) {
  fs.writeFileSync(path.join(outDir, `${size}.png`), makePng(size));
  console.log(`wrote icons/${size}.png`);
}
