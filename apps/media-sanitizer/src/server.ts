import sharp from "sharp";
import { MediaRejection, sanitizeRaster } from "./sanitize";

const maximumInputBytes = 50 * 1024 * 1024;
const port = Number(process.env.PORT ?? 3003);
const maximumConcurrency = 1;
let activeRequests = 0;

sharp.cache({ memory: 32, files: 0, items: 20 });
sharp.concurrency(1);

Bun.serve({
  hostname: "0.0.0.0",
  port,
  maxRequestBodySize: maximumInputBytes,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/health" && request.method === "GET") {
      return Response.json({ ok: true, service: "personalise-kings-media-sanitizer" });
    }
    if (url.pathname !== "/sanitize" || request.method !== "POST") return new Response("Not found", { status: 404 });
    if (activeRequests >= maximumConcurrency) return Response.json({ error: "Media sanitizer is busy" }, { status: 503, headers: { "retry-after": "1" } });
    if (request.headers.get("content-type") !== "application/octet-stream") {
      return Response.json({ error: "Binary image input is required" }, { status: 415 });
    }
    const declaredLength = Number(request.headers.get("content-length"));
    if (!Number.isSafeInteger(declaredLength) || declaredLength < 1 || declaredLength > maximumInputBytes) {
      return Response.json({ error: "File exceeds the maximum byte size" }, { status: 413 });
    }
    activeRequests += 1;
    try {
      const bytes = new Uint8Array(await request.arrayBuffer());
      if (bytes.byteLength !== declaredLength) return Response.json({ error: "Image byte count did not match the request" }, { status: 422 });
      const result = await sanitizeRaster(bytes, configuredOutputLimit());
      return new Response(result.bytes, {
        headers: {
          "content-type": result.contentType,
          "content-length": String(result.bytes.byteLength),
          "x-pk-image-width": String(result.widthPx),
          "x-pk-image-height": String(result.heightPx),
          "cache-control": "no-store"
        }
      });
    } catch (error) {
      if (error instanceof MediaRejection) return Response.json({ error: error.message }, { status: 422 });
      console.error("Media sanitizer failed", error);
      return Response.json({ error: "Media sanitizer failed" }, { status: 500 });
    } finally {
      activeRequests -= 1;
    }
  }
});

function configuredOutputLimit() {
  const configured = Number(process.env.MEDIA_SANITIZER_MAX_OUTPUT_BYTES ?? 25 * 1024 * 1024);
  return Number.isSafeInteger(configured) && configured > 0 && configured <= maximumInputBytes ? configured : 25 * 1024 * 1024;
}
