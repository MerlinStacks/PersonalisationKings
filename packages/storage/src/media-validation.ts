export type MediaSanitizationResult = {
  accepted: true;
  bytes: Uint8Array;
  detectedContentType: string;
  widthPx: number;
  heightPx: number;
} | {
  accepted: false;
  reason: string;
};

const maximumEncodedBytes = 50 * 1024 * 1024;
const defaultTimeoutMs = 20_000;

export async function sanitizeRasterUpload(bytes: Uint8Array): Promise<MediaSanitizationResult> {
  if (bytes.byteLength === 0) return reject("File is empty");
  if (bytes.byteLength > maximumEncodedBytes) return reject("File exceeds the maximum byte size");

  const endpoint = sanitizerEndpoint();
  const response = await requestSanitization(endpoint, bytes);
  if (response.status === 413 || response.status === 422) {
    const rejectionBytes = await readResponseBounded(response, 4 * 1024);
    const payload = JSON.parse(new TextDecoder().decode(rejectionBytes)) as { error?: unknown };
    return reject(typeof payload?.error === "string" ? payload.error : "Image could not be safely decoded");
  }
  if (!response.ok) throw new Error(`Media sanitizer failed with status ${response.status}`);

  const detectedContentType = response.headers.get("content-type")?.split(";", 1)[0];
  const widthPx = positiveIntegerHeader(response, "x-pk-image-width");
  const heightPx = positiveIntegerHeader(response, "x-pk-image-height");
  if (!detectedContentType || !["image/png", "image/jpeg", "image/webp"].includes(detectedContentType) || !widthPx || !heightPx) {
    throw new Error("Media sanitizer returned invalid metadata");
  }
  const declaredOutputLength = Number(response.headers.get("content-length"));
  if (!Number.isSafeInteger(declaredOutputLength) || declaredOutputLength < 1 || declaredOutputLength > maximumEncodedBytes) {
    throw new Error("Media sanitizer returned an invalid output size");
  }
  const sanitized = await readResponseBounded(response, maximumEncodedBytes);
  if (sanitized.byteLength !== declaredOutputLength) {
    throw new Error("Media sanitizer returned an invalid output size");
  }
  return { accepted: true, bytes: sanitized, detectedContentType, widthPx, heightPx };
}

async function requestSanitization(endpoint: string, bytes: Uint8Array) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(new URL("/sanitize", endpoint), {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        "content-length": String(bytes.byteLength)
      },
      body: Uint8Array.from(bytes).buffer,
      signal: AbortSignal.timeout(configuredTimeoutMs())
    });
    if (response.status !== 503 || attempt === 1) return response;
    await response.body?.cancel();
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Media sanitizer retry loop ended unexpectedly");
}

async function readResponseBounded(response: Response, maximumBytes: number) {
  if (!response.body) throw new Error("Media sanitizer returned no response body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel("Media sanitizer response exceeded its limit");
        throw new Error("Media sanitizer returned an invalid output size");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

function sanitizerEndpoint() {
  const configured = process.env.PK_MEDIA_SANITIZER_URL?.trim();
  if (configured) return configured;
  if (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test") return "http://127.0.0.1:3003";
  throw new Error("PK_MEDIA_SANITIZER_URL must be configured outside development and tests");
}

function configuredTimeoutMs() {
  const configured = Number(process.env.PK_MEDIA_SANITIZER_TIMEOUT_MS ?? defaultTimeoutMs);
  return Number.isSafeInteger(configured) && configured >= 1_000 && configured <= 60_000 ? configured : defaultTimeoutMs;
}

function positiveIntegerHeader(response: Response, name: string) {
  const value = Number(response.headers.get(name));
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function reject(reason: string): MediaSanitizationResult {
  return { accepted: false, reason };
}
