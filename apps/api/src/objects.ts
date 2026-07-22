import { prisma } from "@personalise-kings/db";
import { addCounter, recordHistogram, withSpan } from "@personalise-kings/observability/telemetry";
import { createObjectStorageFromEnv, isObjectKey, verifyLocalObjectUrl } from "@personalise-kings/storage";

export async function handleObjectRequest(request: Request, url: URL, correlationId: string) {
  const method = request.method === "PUT" ? "PUT" : request.method === "GET" ? "GET" : null;
  if (!method) {
    return Response.json({ error: "method_not_allowed", correlationId }, { status: 405 });
  }

  let key: string;
  try {
    key = decodeURIComponent(url.pathname.replace(/^\/objects\//, ""));
  } catch {
    return Response.json({ error: "invalid_object_key", correlationId }, { status: 400 });
  }
  const requestedMethod = url.searchParams.get("method");
  const expiresAt = Number(url.searchParams.get("expires") ?? 0);
  const signature = url.searchParams.get("signature") ?? "";

  if (!isObjectKey(key) || requestedMethod !== method || !verifyLocalObjectUrl(method, key, expiresAt, signature)) {
    return Response.json({ error: "invalid_object_url", correlationId }, { status: 403 });
  }

  const storage = createObjectStorageFromEnv();

  if (method === "PUT") {
    const contentType = request.headers.get("content-type") ?? "application/octet-stream";
    if (!request.body) return Response.json({ error: "empty_object", correlationId }, { status: 400 });
    const intent = await prisma.assetVersion.findFirst({
      where: { objectKey: key, validationStatus: "pending", deletedAt: null },
      select: { byteSize: true, contentType: true }
    });
    if (!intent) return Response.json({ error: "upload_intent_not_found", correlationId }, { status: 404 });
    if (contentType !== intent.contentType) {
      return Response.json({ error: "content_type_mismatch", correlationId }, { status: 415 });
    }
    const contentLength = request.headers.get("content-length");
    if (contentLength !== null && (!/^\d+$/.test(contentLength) || BigInt(contentLength) > intent.byteSize)) {
      return Response.json({ error: "object_too_large", correlationId }, { status: 413 });
    }
    try {
      const metadata = await storage.putObject(key, limitStream(request.body, intent.byteSize), contentType);
      return Response.json({ ...metadata, correlationId });
    } catch (error) {
      if (error instanceof RangeError) return Response.json({ error: "object_too_large", correlationId }, { status: 413 });
      throw error;
    }
  }

  const readLeaseUntil = new Date(Date.now() + 5 * 60 * 1000);
  const assetVersion = await prisma.assetVersion.findFirst({
    where: { objectKey: key, deletedAt: null },
    select: { contentType: true }
  });
  const generatedArtifacts = assetVersion ? [] : await prisma.$queryRaw<Array<{ contentType: string }>>`
      UPDATE "GeneratedArtifact"
      SET "downloadLeaseUntil" = GREATEST(COALESCE("downloadLeaseUntil", ${readLeaseUntil}), ${readLeaseUntil})
      WHERE "objectKey" = ${key}
        AND "bytesDeletedAt" IS NULL
        AND "cleanupClaimedAt" IS NULL
      RETURNING "contentType"
    `;
  const contentType = assetVersion?.contentType ?? generatedArtifacts[0]?.contentType;
  if (!contentType) return Response.json({ error: "object_not_available", correlationId }, { status: 404 });
  const kind = assetVersion ? "asset_version" : "generated_artifact";
  const startedAt = performance.now();
  let outcome = "failed";
  return withSpan("object.download", { "pk.object.kind": kind }, async (span) => {
    try {
      const bytes = await storage.getObject(key);
      const body = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(body).set(bytes);
      outcome = "served";
      addCounter("pk.object.download.bytes", bytes.byteLength, { kind });
      return new Response(body, {
        headers: {
          "content-type": contentType,
          "cache-control": "private, max-age=300",
          "x-content-type-options": "nosniff",
          "x-correlation-id": correlationId
        }
      });
    } finally {
      span.setAttribute("pk.object.download.outcome", outcome);
      addCounter("pk.object.downloads", 1, { kind, outcome });
      recordHistogram("pk.object.download.duration", (performance.now() - startedAt) / 1000, { kind, outcome });
    }
  });
}

function limitStream(source: ReadableStream<Uint8Array>, maximumBytes: bigint) {
  let total = 0n;
  return source.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      total += BigInt(chunk.byteLength);
      if (total > maximumBytes) throw new RangeError("Object exceeds its approved upload size");
      controller.enqueue(chunk);
    }
  }));
}
