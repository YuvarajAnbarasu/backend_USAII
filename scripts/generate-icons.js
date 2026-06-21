const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT_DIR = path.join(__dirname, '..', 'extension', 'icons');

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function createPng(size) {
  const width = size;
  const height = size;
  const rows = [];

  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 4);
    row[0] = 0;
    for (let x = 0; x < width; x++) {
      const i = 1 + x * 4;
      const nx = (x + 0.5) / width;
      const ny = (y + 0.5) / height;
      const corner = size * 0.18 / width;
      const inRect =
        nx > corner && nx < 1 - corner && ny > corner && ny < 1 - corner;
      const inTL = nx < corner && ny < corner && Math.hypot(nx - corner, ny - corner) > corner;
      const inTR = nx > 1 - corner && ny < corner && Math.hypot(nx - (1 - corner), ny - corner) > corner;
      const inBL = nx < corner && ny > 1 - corner && Math.hypot(nx - corner, ny - (1 - corner)) > corner;
      const inBR = nx > 1 - corner && ny > 1 - corner && Math.hypot(nx - (1 - corner), ny - (1 - corner)) > corner;
      const outside = inTL || inTR || inBL || inBR;

      const cx = 0.5;
      const cy = 0.5;
      const dist = Math.hypot(nx - cx, ny - cy);
      const outerR = 0.28;
      const innerR = 0.12;

      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      if (!outside && inRect) {
        r = 79;
        g = 140;
        b = 255;
        a = 255;
        if (dist < outerR) {
          r = 255;
          g = 255;
          b = 255;
        }
        if (dist < innerR) {
          r = 26;
          g = 35;
          b = 50;
        }
      }

      row[i] = r;
      row[i + 1] = g;
      row[i + 2] = b;
      row[i + 3] = a;
    }
    rows.push(row);
  }

  const raw = Buffer.concat(rows);
  const compressed = zlib.deflateSync(raw);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const size of [16, 48, 128]) {
  const file = path.join(OUT_DIR, `icon${size}.png`);
  fs.writeFileSync(file, createPng(size));
  console.log('Wrote', file);
}
