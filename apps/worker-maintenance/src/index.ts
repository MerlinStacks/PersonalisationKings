import { prisma } from "@personalise-kings/db";
import { createObjectStorageFromEnv } from "@personalise-kings/storage";
import { processNextDeletionRequest } from "./deletion";

const pollIntervalMs = positiveIntegerFromEnv("OUTBOX_POLL_INTERVAL_MS", 5000);
const cleanupIntervalMs = positiveIntegerFromEnv("CLEANUP_INTERVAL_MS", 60_000);
let lastCleanupAt = 0;

async function cleanupExpiredTemporaryUploads() {
  const storage = createObjectStorageFromEnv();
  const settings = await prisma.merchantSettings.findMany();

  for (const setting of settings) {
    const cutoff = new Date(Date.now() - setting.temporaryUploadRetentionDays * 24 * 60 * 60 * 1000);
    const expired = await prisma.assetVersion.findMany({
      where: {
        merchantId: setting.merchantId,
        validationStatus: "pending",
        objectKey: { startsWith: `temporary_upload/${setting.merchantId}/` },
        createdAt: { lt: cutoff },
        deletedAt: null
      },
      take: 100
    });

    for (const assetVersion of expired) {
      const claimedAt = new Date();
      const auditEventId = await prisma.$transaction(async (tx) => {
        const claimed = await tx.assetVersion.updateMany({
          where: {
            id: assetVersion.id,
            merchantId: setting.merchantId,
            validationStatus: "pending",
            objectKey: assetVersion.objectKey,
            createdAt: { lt: cutoff },
            deletedAt: null
          },
          data: { validationStatus: "deleted", deletedAt: claimedAt }
        });

        if (claimed.count !== 1) return null;

        const auditEvent = await tx.auditEvent.create({
          data: {
            merchantId: assetVersion.merchantId,
            action: "asset.cleanup_temporary_upload",
            targetType: "AssetVersion",
            targetId: assetVersion.id,
            metadata: { objectKey: assetVersion.objectKey }
          }
        });
        return auditEvent.id;
      });

      if (!auditEventId) continue;

      try {
        await storage.deleteObject(assetVersion.objectKey as never);
        console.log(`Cleaned expired temporary asset ${assetVersion.id}`);
      } catch (error) {
        console.error(`Failed cleaning asset ${assetVersion.id}`, error);
        try {
          await prisma.$transaction(async (tx) => {
            await tx.assetVersion.updateMany({
              where: {
                id: assetVersion.id,
                validationStatus: "deleted",
                objectKey: assetVersion.objectKey,
                deletedAt: claimedAt
              },
              data: { validationStatus: "pending", deletedAt: null }
            });
            await tx.auditEvent.deleteMany({ where: { id: auditEventId } });
          });
        } catch (compensationError) {
          console.error(`Failed compensating cleanup claim for asset ${assetVersion.id}`, compensationError);
        }
      }
    }
  }
}

async function cleanupExpiredPreviews() {
  const storage = createObjectStorageFromEnv();
  const settings = await prisma.merchantSettings.findMany();

  for (const setting of settings) {
    const cutoff = new Date(Date.now() - setting.previewRetentionDays * 24 * 60 * 60 * 1000);
    const expired = await prisma.assetVersion.findMany({
      where: {
        merchantId: setting.merchantId,
        validationStatus: "accepted",
        objectKey: { startsWith: `preview_derivative/${setting.merchantId}/` },
        createdAt: { lt: cutoff },
        deletedAt: null,
        asset: { kind: "preview" }
      },
      take: 100
    });

    for (const assetVersion of expired) {
      const claimedAt = new Date();
      const auditEventId = await prisma.$transaction(async (tx) => {
        const claimed = await tx.assetVersion.updateMany({
          where: {
            id: assetVersion.id,
            merchantId: setting.merchantId,
            validationStatus: "accepted",
            objectKey: assetVersion.objectKey,
            createdAt: { lt: cutoff },
            deletedAt: null
          },
          data: { validationStatus: "deleted", deletedAt: claimedAt }
        });
        if (claimed.count !== 1) return null;
        const auditEvent = await tx.auditEvent.create({
          data: {
            merchantId: assetVersion.merchantId,
            action: "asset.cleanup_preview",
            targetType: "AssetVersion",
            targetId: assetVersion.id,
            metadata: { objectKey: assetVersion.objectKey }
          }
        });
        return auditEvent.id;
      });
      if (!auditEventId) continue;

      try {
        await storage.deleteObject(assetVersion.objectKey as never);
        console.log(`Cleaned expired preview asset ${assetVersion.id}`);
      } catch (error) {
        console.error(`Failed cleaning preview asset ${assetVersion.id}`, error);
        try {
          await prisma.$transaction(async (tx) => {
            await tx.assetVersion.updateMany({
              where: {
                id: assetVersion.id,
                validationStatus: "deleted",
                objectKey: assetVersion.objectKey,
                deletedAt: claimedAt
              },
              data: { validationStatus: "accepted", deletedAt: null }
            });
            await tx.auditEvent.deleteMany({ where: { id: auditEventId } });
          });
        } catch (compensationError) {
          console.error(`Failed compensating preview cleanup claim for asset ${assetVersion.id}`, compensationError);
        }
      }
    }
  }
}

async function cleanupExpiredAdminSecurityRecords() {
  const now = new Date();
  const usedCodeCutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  await prisma.$transaction([
    prisma.adminSession.deleteMany({
      where: { OR: [{ expiresAt: { lt: now } }, { revokedAt: { lt: usedCodeCutoff } }] }
    }),
    prisma.staffRecoveryCode.deleteMany({ where: { usedAt: { lt: usedCodeCutoff } } })
  ]);
}

async function loop() {
  try {
    await processNextDeletionRequest();
    if (Date.now() - lastCleanupAt > cleanupIntervalMs) {
      await cleanupExpiredTemporaryUploads();
      await cleanupExpiredPreviews();
      await cleanupExpiredAdminSecurityRecords();
      lastCleanupAt = Date.now();
    }
  } catch (error) {
    console.error("Maintenance worker polling cycle failed; retrying", error);
  } finally {
    setTimeout(() => void loop(), pollIntervalMs);
  }
}

function positiveIntegerFromEnv(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

console.log("PersonaliseKings maintenance worker started");
console.warn("Outbox dispatcher is not configured; events will remain pending");
void loop();
