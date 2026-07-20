export interface MediaValidationResult {
  accepted: boolean;
  detectedContentType?: string;
  widthPx?: number;
  heightPx?: number;
  reason?: string;
}

const maxBytes = 50 * 1024 * 1024;
const maxPixels = 80_000_000;
const maxDimension = 20_000;

export function validateRasterUpload(bytes: Uint8Array): MediaValidationResult {
  if (bytes.byteLength === 0) {
    return reject("File is empty");
  }

  if (bytes.byteLength > maxBytes) {
    return reject("File exceeds the maximum byte size");
  }

  const detected = detectRaster(bytes);
  if (!detected) {
    return reject("Only PNG, JPEG, and WebP raster uploads are accepted");
  }

  if (detected.widthPx && detected.heightPx) {
    if (detected.widthPx > maxDimension || detected.heightPx > maxDimension) {
      return reject("Image dimensions exceed the maximum allowed size");
    }

    if (detected.widthPx * detected.heightPx > maxPixels) {
      return reject("Image decoded pixel count exceeds the maximum allowed size");
    }
  }

  return { accepted: true, ...detected };
}

function detectRaster(bytes: Uint8Array): Omit<MediaValidationResult, "accepted"> | null {
  if (isPng(bytes)) {
    return {
      detectedContentType: "image/png",
      widthPx: readUint32(bytes, 16),
      heightPx: readUint32(bytes, 20)
    };
  }

  if (isJpeg(bytes)) {
    return { detectedContentType: "image/jpeg", ...readJpegDimensions(bytes) };
  }

  if (isWebp(bytes)) {
    return { detectedContentType: "image/webp", ...readWebpDimensions(bytes) };
  }

  return null;
}

function isPng(bytes: Uint8Array) {
  return bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
}

function isJpeg(bytes: Uint8Array) {
  return bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8;
}

function isWebp(bytes: Uint8Array) {
  return bytes.length > 30 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP";
}

function readUint32(bytes: Uint8Array, offset: number) {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, false);
}

function readUint16(bytes: Uint8Array, offset: number) {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 2).getUint16(0, false);
}

function readUint24LittleEndian(bytes: Uint8Array, offset: number) {
  return bytes[offset] + (bytes[offset + 1] << 8) + (bytes[offset + 2] << 16);
}

function readJpegDimensions(bytes: Uint8Array) {
  let offset = 2;

  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) return {};

    const marker = bytes[offset + 1];
    const segmentLength = readUint16(bytes, offset + 2);
    const isStartOfFrame = marker >= 0xc0 && marker <= 0xc3;

    if (isStartOfFrame) {
      return {
        heightPx: readUint16(bytes, offset + 5),
        widthPx: readUint16(bytes, offset + 7)
      };
    }

    offset += 2 + segmentLength;
  }

  return {};
}

function readWebpDimensions(bytes: Uint8Array) {
  const chunk = ascii(bytes, 12, 4);

  if (chunk === "VP8X" && bytes.length > 30) {
    return {
      widthPx: readUint24LittleEndian(bytes, 24) + 1,
      heightPx: readUint24LittleEndian(bytes, 27) + 1
    };
  }

  if (chunk === "VP8 " && bytes.length > 30) {
    return {
      widthPx: bytes[26] | ((bytes[27] & 0x3f) << 8),
      heightPx: bytes[28] | ((bytes[29] & 0x3f) << 8)
    };
  }

  return {};
}

function ascii(bytes: Uint8Array, offset: number, length: number) {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}

function reject(reason: string): MediaValidationResult {
  return { accepted: false, reason };
}
