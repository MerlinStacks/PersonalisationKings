import { describe, expect, it } from "vitest";
import { validateRasterUpload } from "./media-validation";

describe("validateRasterUpload", () => {
  it("accepts a PNG with dimensions", () => {
    const bytes = new Uint8Array(33);
    bytes.set([0x89, 0x50, 0x4e, 0x47], 0);
    bytes.set([0x00, 0x00, 0x00, 0x64], 16);
    bytes.set([0x00, 0x00, 0x00, 0x32], 20);

    expect(validateRasterUpload(bytes)).toMatchObject({
      accepted: true,
      detectedContentType: "image/png",
      widthPx: 100,
      heightPx: 50
    });
  });

  it("rejects SVG-like text", () => {
    const bytes = new TextEncoder().encode("<svg><script>alert(1)</script></svg>");
    expect(validateRasterUpload(bytes).accepted).toBe(false);
  });

  it("rejects oversized PNG dimensions", () => {
    const bytes = new Uint8Array(33);
    bytes.set([0x89, 0x50, 0x4e, 0x47], 0);
    bytes.set([0x00, 0x00, 0x4e, 0x21], 16);
    bytes.set([0x00, 0x00, 0x00, 0x64], 20);

    expect(validateRasterUpload(bytes).accepted).toBe(false);
  });
});
