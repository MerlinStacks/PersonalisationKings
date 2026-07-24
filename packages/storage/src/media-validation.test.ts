import { afterEach, describe, expect, it, vi } from "vitest";
import { sanitizeRasterUpload } from "./media-validation";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sanitizeRasterUpload", () => {
  it("returns trusted sanitized bytes and dimensions", async () => {
    const output = new Uint8Array([1, 2, 3]);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(output, {
      headers: {
        "content-type": "image/png",
        "content-length": String(output.byteLength),
        "x-pk-image-width": "100",
        "x-pk-image-height": "50"
      }
    })));

    await expect(sanitizeRasterUpload(new Uint8Array([9]))).resolves.toEqual({
      accepted: true,
      bytes: output,
      detectedContentType: "image/png",
      widthPx: 100,
      heightPx: 50
    });
  });

  it("returns decoder rejections without trusting input headers", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "Image could not be safely decoded" }, { status: 422 })));
    await expect(sanitizeRasterUpload(new TextEncoder().encode("<svg/>"))).resolves.toEqual({
      accepted: false,
      reason: "Image could not be safely decoded"
    });
  });

  it("rejects empty input before contacting the service", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(sanitizeRasterUpload(new Uint8Array())).resolves.toMatchObject({ accepted: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed on malformed successful responses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1]), { headers: { "content-type": "text/plain", "content-length": "1" } })));
    await expect(sanitizeRasterUpload(new Uint8Array([9]))).rejects.toThrow(/invalid metadata/);
  });
});
