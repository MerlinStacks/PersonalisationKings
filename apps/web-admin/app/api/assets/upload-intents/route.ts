import { prisma } from "@personalise-kings/db";
import { createObjectStorageFromEnv, objectKey, objectStorageMaximumBytesFromEnv } from "@personalise-kings/storage";
import { randomUUID } from "node:crypto";
import * as z from "zod";
import { created, parseJson } from "../../../../lib/api";
import { writeAuditEvent } from "../../../../lib/audit";
import { requirePermission } from "../../../../lib/rbac";
import { requireSameOrigin } from "../../../../lib/same-origin";

const uploadIntentSchema = z.object({
  kind: z.enum(["font", "artwork", "clipart", "upload", "mockup"]),
  name: z.string().min(1).max(180),
  contentType: z.string().min(1),
  byteSize: z.number().int().positive().max(50 * 1024 * 1024)
}).superRefine((value, context) => {
  if (value.kind !== "font" && !["image/png", "image/jpeg", "image/webp"].includes(value.contentType)) {
    context.addIssue({ code: "custom", path: ["contentType"], message: "Raster assets must be PNG, JPEG, or WebP" });
  }
});

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const access = await requirePermission("manage_design");
  if (access.error) return access.error;
  const session = access.session;
  const parsed = await parseJson(request, uploadIntentSchema);
  if (parsed.error) return parsed.error;
  if (parsed.data.byteSize > objectStorageMaximumBytesFromEnv()) return Response.json({ error: "Upload exceeds configured storage limit" }, { status: 422 });

  const storage = createObjectStorageFromEnv();
  const uploadId = randomUUID();
  const key = objectKey("temporary_upload", session.merchantId, uploadId);
  const signedPutUrl = await storage.createSignedPutUrl(key, 300);

  const asset = await prisma.$transaction(async (tx) => {
    const createdAsset = await tx.asset.create({
      data: {
        merchantId: session.merchantId,
        kind: parsed.data.kind,
        name: parsed.data.name,
        versions: {
          create: {
            version: 1,
            objectKey: key,
            checksumSha256: "pending",
            byteSize: BigInt(parsed.data.byteSize),
            contentType: parsed.data.contentType,
            validationStatus: "pending"
          }
        }
      },
      include: { versions: true }
    });
    const version = createdAsset.versions[0];
    if (!version) throw new Error("Asset upload version was not created");
    await writeAuditEvent({
      merchantId: session.merchantId,
      actorUserId: session.userId,
      action: "asset.upload_intent_create",
      targetType: "AssetVersion",
      targetId: version.id,
      metadata: { assetId: createdAsset.id, kind: parsed.data.kind, contentType: parsed.data.contentType, byteSize: parsed.data.byteSize }
    }, tx);
    return createdAsset;
  });
  const assetVersion = asset.versions[0];
  if (!assetVersion) throw new Error("Asset upload version was not created");

  return created({
    assetId: asset.id,
    assetVersionId: assetVersion.id,
    objectKey: key,
    signedPutUrl,
    expiresInSeconds: 300,
    requiredHeaders: {
      "Content-Type": parsed.data.contentType
    }
  });
}
