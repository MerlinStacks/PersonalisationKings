import { prisma } from "@personalise-kings/db";
import { createObjectStorageFromEnv, isObjectKey, verifyLocalObjectUrl } from "@personalise-kings/storage";

export async function handleObjectRequest(request: Request, url: URL, correlationId: string) {
  const method = request.method === "PUT" ? "PUT" : request.method === "GET" ? "GET" : null;
  if (!method) {
    return Response.json({ error: "method_not_allowed", correlationId }, { status: 405 });
  }

  const key = decodeURIComponent(url.pathname.replace(/^\/objects\//, ""));
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
    const metadata = await storage.putObject(key, request.body, contentType);
    return Response.json({ ...metadata, correlationId });
  }

  const bytes = await storage.getObject(key);
  const assetVersion = await prisma.assetVersion.findFirst({
    where: { objectKey: key, deletedAt: null },
    select: { contentType: true }
  });
  const body = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(body).set(bytes);
  return new Response(body, {
    headers: {
      "content-type": assetVersion?.contentType ?? "application/octet-stream",
      "cache-control": "private, max-age=300",
      "x-content-type-options": "nosniff",
      "x-correlation-id": correlationId
    }
  });
}
