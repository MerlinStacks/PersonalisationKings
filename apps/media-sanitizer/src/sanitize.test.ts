import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { MediaRejection, sanitizeRaster } from "./sanitize";

describe("sanitizeRaster", () => {
  it.each([
    ["png", "image/png"],
    ["jpeg", "image/jpeg"],
    ["webp", "image/webp"]
  ] as const)("fully decodes and re-encodes static %s", async (format, contentType) => {
    const source = await sharp({ create: { width: 4, height: 3, channels: 4, background: "#cc2244" } })[format]().toBuffer();
    const result = await sanitizeRaster(source);
    const metadata = await sharp(result.bytes).metadata();

    expect(result).toMatchObject({ contentType, widthPx: 4, heightPx: 3 });
    expect(metadata).toMatchObject({ format, width: 4, height: 3 });
  });

  it("normalizes orientation and strips metadata", async () => {
    const source = await sharp({ create: { width: 2, height: 3, channels: 3, background: "white" } })
      .jpeg()
      .withMetadata({ orientation: 6, exif: { IFD0: { Copyright: "secret customer metadata" } } })
      .toBuffer();
    const result = await sanitizeRaster(source);
    const metadata = await sharp(result.bytes).metadata();

    expect(result).toMatchObject({ widthPx: 3, heightPx: 2, contentType: "image/jpeg" });
    expect(metadata.orientation).toBeUndefined();
    expect(metadata.exif).toBeUndefined();
    expect(metadata.xmp).toBeUndefined();
    expect(metadata.icc).toBeUndefined();
  });

  it("rejects animated input", async () => {
    const first = await sharp({ create: { width: 2, height: 2, channels: 3, background: "red" } }).png().toBuffer();
    const second = await sharp({ create: { width: 2, height: 2, channels: 3, background: "blue" } }).png().toBuffer();
    const animated = await sharp([first, second], { join: { animated: true } }).webp({ delay: [100, 100], loop: 0 }).toBuffer();
    await expect(sanitizeRaster(animated)).rejects.toThrow(/Animated/);
  });

  it("rejects corrupt, unsupported, and oversized-output inputs", async () => {
    await expect(sanitizeRaster(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).rejects.toBeInstanceOf(MediaRejection);
    await expect(sanitizeRaster(new TextEncoder().encode("<svg/>"))).rejects.toThrow(/Only PNG|decoded/);
    const source = await sharp({ create: { width: 10, height: 10, channels: 3, background: "white" } }).png().toBuffer();
    await expect(sanitizeRaster(source, 1)).rejects.toThrow(/output size/);
  });
});
