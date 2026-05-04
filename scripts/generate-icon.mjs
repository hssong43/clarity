import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";

const size = 1024;
const iconsDir = new URL("../src-tauri/icons/", import.meta.url);
mkdirSync(iconsDir, { recursive: true });

const rgba = Buffer.alloc(size * size * 4);
const center = size / 2;
const radius = size * 0.42;

for (let y = 0; y < size; y += 1) {
  for (let x = 0; x < size; x += 1) {
    const i = (y * size + x) * 4;
    const dx = x - center;
    const dy = y - center;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const inside = distance <= radius;
    const ring = distance > radius * 0.86 && distance <= radius;
    const sparkle = pointInDiamond(x, y, center, center, 154, 154)
      || pointInDiamond(x, y, center + 170, center - 170, 66, 66)
      || pointInDiamond(x, y, center - 198, center + 128, 48, 48);

    if (inside) {
      rgba[i] = ring ? 119 : 21;
      rgba[i + 1] = ring ? 195 : 25;
      rgba[i + 2] = ring ? 255 : 34;
      rgba[i + 3] = 255;
    }

    if (sparkle) {
      rgba[i] = 248;
      rgba[i + 1] = 252;
      rgba[i + 2] = 255;
      rgba[i + 3] = 255;
    }
  }
}

writeFileSync(new URL("icon.png", iconsDir), encodePng(size, size, rgba));
writeFileSync(
  new URL("installer-header.bmp", iconsDir),
  encodeBmp(150, 57, (x, y) => installerPixel(x, y, 150, 57))
);
writeFileSync(
  new URL("installer-sidebar.bmp", iconsDir),
  encodeBmp(164, 314, (x, y) => installerPixel(x, y, 164, 314))
);
console.log("Generated src-tauri/icons/icon.png");

function pointInDiamond(x, y, cx, cy, width, height) {
  return Math.abs(x - cx) / (width / 2) + Math.abs(y - cy) / (height / 2) <= 1;
}

function encodePng(width, height, pixels) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  const scanlines = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const sourceStart = y * width * 4;
    const targetStart = y * (width * 4 + 1);
    scanlines[targetStart] = 0;
    pixels.copy(scanlines, targetStart + 1, sourceStart, sourceStart + width * 4);
  }

  return Buffer.concat([
    signature,
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(scanlines, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function installerPixel(x, y, width, height) {
  const t = x / Math.max(1, width - 1);
  const shade = Math.round(17 + t * 22);
  const cx = width * 0.78;
  const cy = height * 0.44;
  const sparkle = pointInDiamond(x, y, cx, cy, Math.min(width, height) * 0.36, Math.min(width, height) * 0.36);
  return sparkle ? [248, 252, 255] : [shade, shade + 7, shade + 16];
}

function encodeBmp(width, height, pixel) {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const pixelBytes = rowSize * height;
  const fileSize = 54 + pixelBytes;
  const bytes = Buffer.alloc(fileSize);

  bytes.write("BM", 0, "ascii");
  bytes.writeUInt32LE(fileSize, 2);
  bytes.writeUInt32LE(54, 10);
  bytes.writeUInt32LE(40, 14);
  bytes.writeInt32LE(width, 18);
  bytes.writeInt32LE(height, 22);
  bytes.writeUInt16LE(1, 26);
  bytes.writeUInt16LE(24, 28);
  bytes.writeUInt32LE(pixelBytes, 34);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = pixel(x, height - y - 1);
      const offset = 54 + y * rowSize + x * 3;
      bytes[offset] = b;
      bytes[offset + 1] = g;
      bytes[offset + 2] = r;
    }
  }

  return bytes;
}
