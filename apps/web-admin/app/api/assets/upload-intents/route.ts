import { prisma } from "@personalise-kings/db";
import { createObjectStorageFromEnv, objectKey } from "@personalise-kings/storage";
import { randomUUID } from "node:crypto";
import * as z from "zod";
import { created, parseJson } from "../../../../lib/api";
import { requirePermission } from "../../../../lib/rbac";
import { requireSameOrigin } from "../../../../lib/same-origin";

const uploadIntentSchema = z.object({
  kind: z.enum(["font", "artwork", "clipart", "upload", "mockup", "preview", "production_artifact"]),
  name: z.string().min(1).max(180),
  contentType: z.string().min(1),
  byteSize: z.number().int().positive().max(50 * 1024 * 1024)
});

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const access = await requirePermission("manage_design");
  if (access.error) return access.error;
  const session = access.session;
  const parsed = await parseJson(request, uploadIntentSchema);
  if (parsed.error) return parsed.error;

  const storage = createObjectStorageFromEnv();
  const uploadId = randomUUID();
  const key = objectKey("temporary_upload", session.merchantId, uploadId);
  const signedPutUrl = await storage.createSignedPutUrl(key, 300);

  const asset = await prisma.asset.create({
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

  return created({
    assetId: asset.id,
    assetVersionId: asset.versions[0].id,
    objectKey: key,
    signedPutUrl,
    expiresInSeconds: 300,
    requiredHeaders: {
      "Content-Type": parsed.data.contentType
    }
  });
}
