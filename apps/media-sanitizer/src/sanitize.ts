import sharp, { type Metadata, type OutputInfo, type Sharp } from "sharp";

const maximumInputBytes = 50 * 1024 * 1024;
const maximumPixels = 80_000_000;
const maximumDimension = 20_000;
const allowedFormats = new Set(["png", "jpeg", "webp"]);

export class MediaRejection extends Error {}

export async function sanitizeRaster(bytes: Uint8Array, maximumOutputBytes = maximumInputBytes) {
  if (bytes.byteLength === 0) throw new MediaRejection("File is empty");
  if (bytes.byteLength > maximumInputBytes) throw new MediaRejection("File exceeds the maximum byte size");
  if (!Number.isSafeInteger(maximumOutputBytes) || maximumOutputBytes < 1 || maximumOutputBytes > maximumInputBytes) {
    throw new TypeError("Invalid sanitizer output limit");
  }

  let image: Sharp;
  let metadata: Metadata;
  try {
    image = sharp(bytes, { failOn: "error", limitInputPixels: maximumPixels, sequentialRead: true });
    metadata = await image.metadata();
  } catch {
    throw new MediaRejection("Image could not be safely decoded");
  }
  if (!metadata.format || !allowedFormats.has(metadata.format)) throw new MediaRejection("Only PNG, JPEG, and WebP raster uploads are accepted");
  if ((metadata.pages ?? 1) !== 1) throw new MediaRejection("Animated or multi-frame images are not accepted");
  if (!metadata.width || !metadata.height) throw new MediaRejection("Image dimensions are invalid");

  const swapsDimensions = metadata.orientation !== undefined && metadata.orientation >= 5 && metadata.orientation <= 8;
  const widthPx = swapsDimensions ? metadata.height : metadata.width;
  const heightPx = swapsDimensions ? metadata.width : metadata.height;
  if (widthPx > maximumDimension || heightPx > maximumDimension) throw new MediaRejection("Image dimensions exceed the maximum allowed size");
  if (widthPx * heightPx > maximumPixels) throw new MediaRejection("Image decoded pixel count exceeds the maximum allowed size");

  let pipeline = image.rotate().toColourspace("srgb");
  if (metadata.format === "png") pipeline = pipeline.png({ compressionLevel: 9, adaptiveFiltering: true });
  if (metadata.format === "jpeg") pipeline = pipeline.jpeg({ quality: 95, chromaSubsampling: "4:4:4", mozjpeg: true });
  if (metadata.format === "webp") pipeline = pipeline.webp({ quality: 95, smartSubsample: true, effort: 6 });

  let result: { data: Buffer; info: OutputInfo };
  try {
    result = await pipeline.toBuffer({ resolveWithObject: true });
  } catch {
    throw new MediaRejection("Image could not be safely decoded");
  }
  if (result.data.byteLength === 0 || result.data.byteLength > maximumOutputBytes) {
    throw new MediaRejection("Sanitized image exceeds the maximum output size");
  }
  if (result.info.width !== widthPx || result.info.height !== heightPx) throw new Error("Sanitizer produced unexpected dimensions");

  return {
    bytes: new Uint8Array(result.data),
    contentType: contentTypeForFormat(metadata.format),
    widthPx,
    heightPx
  };
}

function contentTypeForFormat(format: string) {
  if (format === "jpeg") return "image/jpeg";
  return `image/${format}`;
}
