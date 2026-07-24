import { randomUUID } from "node:crypto";
import { prisma } from "@personalise-kings/db";
import type { ObjectStorage } from "@personalise-kings/storage";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupExpiredGeneratedArtifacts } from "./artifact-cleanup";
import { runOperationalChecks } from "./operational-checks";
import { reconcileQueues } from "./reconciliation";

const integrationEnabled = process.env.PK_RUN_DATABASE_INTEGRATION_TESTS === "true";
const fixturePrefix = "queue-reconciliation-test-";
const fixtureMerchantIds = new Set<string>();

describe.skipIf(!integrationEnabled)("queue reconciliation with PostgreSQL", () => {
  beforeEach(cleanupFixtures);
  afterAll(cleanupFixtures);

  it("repairs an exhausted proof job and writes one audit event", async () => {
    const fixture = await createRevisionFixture();
    const proof = await prisma.proofJob.create({
      data: {
        merchantId: fixture.merchantId,
        customisationRevisionId: fixture.revisionId,
        rendererVersion: "proof-playwright.v1",
        status: "queued",
        attempts: 5
      }
    });

    const report = await reconcileQueues({ batchSize: 20, proofMaximumAttempts: 5, merchantId: fixture.merchantId });
    const [updated, audits] = await Promise.all([
      prisma.proofJob.findUniqueOrThrow({ where: { id: proof.id } }),
      prisma.auditEvent.findMany({ where: { merchantId: fixture.merchantId, action: "queue.proof_reconciled", targetId: proof.id } })
    ]);

    expect(report.proofRepairs).toBe(1);
    expect(updated.status).toBe("failed");
    expect(updated.claimedAt).toBeNull();
    expect(audits).toHaveLength(1);
  });

  it("recreates valid missing proof work once and rejects a malformed object key", async () => {
    const valid = await createRevisionFixture();
    const invalid = await createRevisionFixture({
      merchantId: valid.merchantId,
      objectKey: `preview_derivative/wrong-merchant/${randomUUID()}.svg`
    });

    const first = await reconcileQueues({ batchSize: 20, merchantId: valid.merchantId });
    const second = await reconcileQueues({ batchSize: 20, merchantId: valid.merchantId });
    const [validJobs, invalidJobs, audits] = await Promise.all([
      prisma.proofJob.count({ where: { customisationRevisionId: valid.revisionId } }),
      prisma.proofJob.count({ where: { customisationRevisionId: invalid.revisionId } }),
      prisma.auditEvent.count({
        where: { merchantId: valid.merchantId, action: "queue.proof_missing_recreated", targetId: valid.revisionId }
      })
    ]);

    expect(first.missingProofJobs).toBe(1);
    expect(second.missingProofJobs).toBe(0);
    expect(validJobs).toBe(1);
    expect(invalidJobs).toBe(0);
    expect(audits).toBe(1);
  });

  it("allows only one concurrent reconciler to recover a stale deletion claim", async () => {
    const merchant = await createMerchant();
    const request = await prisma.deletionRequest.create({
      data: {
        merchantId: merchant.id,
        subjectType: "AssetVersion",
        subjectId: randomUUID(),
        status: "processing",
        attempts: 2,
        claimedAt: new Date(Date.now() - 30 * 60 * 1000)
      }
    });

    const reports = await Promise.all([
      reconcileQueues({ batchSize: 20, merchantId: merchant.id }),
      reconcileQueues({ batchSize: 20, merchantId: merchant.id })
    ]);
    const [updated, audits] = await Promise.all([
      prisma.deletionRequest.findUniqueOrThrow({ where: { id: request.id } }),
      prisma.auditEvent.findMany({ where: { merchantId: merchant.id, action: "queue.deletion_reconciled", targetId: request.id } })
    ]);

    expect(reports.reduce((total, report) => total + report.deletionRepairs, 0)).toBe(1);
    expect(updated.status).toBe("pending");
    expect(updated.attempts).toBe(2);
    expect(updated.claimedAt).toBeNull();
    expect(audits).toHaveLength(1);
  });

  it("fails exhausted deletion work without completing backup erasure", async () => {
    const merchant = await createMerchant();
    const request = await prisma.deletionRequest.create({
      data: {
        merchantId: merchant.id,
        subjectType: "AssetVersion",
        subjectId: randomUUID(),
        status: "processing",
        attempts: 10,
        claimedAt: null
      }
    });

    await reconcileQueues({ batchSize: 20, deletionMaximumAttempts: 10, merchantId: merchant.id });
    const updated = await prisma.deletionRequest.findUniqueOrThrow({ where: { id: request.id } });

    expect(updated.status).toBe("failed");
    expect(updated.liveDeletedAt).toBeNull();
    expect(updated.backupPurgedAt).toBeNull();
    expect(updated.completedAt).toBeNull();
  });

  it("deletes expired artifact bytes once while retaining metadata and respecting leases", async () => {
    const now = new Date("2026-07-21T12:00:00.000Z");
    const available = await createGeneratedArtifactFixture({ now });
    const leased = await createGeneratedArtifactFixture({ merchantId: available.merchantId, now, downloadLeaseUntil: new Date(now.getTime() + 60_000) });
    const held = await createGeneratedArtifactFixture({ merchantId: available.merchantId, now, retentionHoldAt: now });
    const deleteObject = vi.fn(async () => undefined);
    const storage: ObjectStorage = {
      deleteObject,
      getObject: vi.fn(),
      putObject: vi.fn(),
      createSignedGetUrl: vi.fn(),
      createSignedPutUrl: vi.fn(),
      checkHealth: vi.fn()
    };

    const first = await cleanupExpiredGeneratedArtifacts({ merchantId: available.merchantId, now, batchSize: 20, storage });
    const second = await cleanupExpiredGeneratedArtifacts({ merchantId: available.merchantId, now, batchSize: 20, storage });
    const [expired, retained, heldArtifact, audits] = await Promise.all([
      prisma.generatedArtifact.findUniqueOrThrow({ where: { id: available.artifactId } }),
      prisma.generatedArtifact.findUniqueOrThrow({ where: { id: leased.artifactId } }),
      prisma.generatedArtifact.findUniqueOrThrow({ where: { id: held.artifactId } }),
      prisma.auditEvent.count({
        where: { merchantId: available.merchantId, action: "artifact.cleanup_production_bytes", targetId: available.artifactId }
      })
    ]);

    expect(first).toBe(1);
    expect(second).toBe(0);
    expect(deleteObject).toHaveBeenCalledTimes(1);
    expect(expired.bytesDeletedAt).not.toBeNull();
    expect(expired.checksumSha256).toBe("1".repeat(64));
    expect(retained.bytesDeletedAt).toBeNull();
    expect(heldArtifact.bytesDeletedAt).toBeNull();
    expect(audits).toBe(1);

    await prisma.generatedArtifact.update({
      where: { id: held.artifactId },
      data: { retentionHoldAt: null, retentionHoldReason: null }
    });
    expect(await cleanupExpiredGeneratedArtifacts({ merchantId: available.merchantId, now, batchSize: 20, storage })).toBe(1);
    expect(deleteObject).toHaveBeenCalledTimes(2);
  });

  it("keeps artifact bytes unavailable after an ambiguous storage failure", async () => {
    const now = new Date("2026-07-21T12:00:00.000Z");
    const fixture = await createGeneratedArtifactFixture({ now });
    const storage: ObjectStorage = {
      deleteObject: vi.fn(async () => { throw new Error("storage unavailable"); }),
      getObject: vi.fn(),
      putObject: vi.fn(),
      createSignedGetUrl: vi.fn(),
      createSignedPutUrl: vi.fn(),
      checkHealth: vi.fn()
    };

    const deleted = await cleanupExpiredGeneratedArtifacts({ merchantId: fixture.merchantId, now, batchSize: 20, storage });
    const artifact = await prisma.generatedArtifact.findUniqueOrThrow({ where: { id: fixture.artifactId } });

    expect(deleted).toBe(0);
    expect(artifact.bytesDeletedAt).toBeNull();
    expect(artifact.cleanupClaimedAt).not.toBeNull();
    expect(artifact.cleanupClaimToken).not.toBeNull();
    expect(artifact.lastCleanupError).toBe("storage unavailable");
  });

  it("opens deduplicated critical alerts and resolves them after cleanup recovery", async () => {
    const now = new Date("2026-07-21T12:00:00.000Z");
    const fixture = await createGeneratedArtifactFixture({ now });
    await prisma.generatedArtifact.update({
      where: { id: fixture.artifactId },
      data: { cleanupClaimedAt: new Date(now.getTime() - 50 * 60 * 1000), cleanupClaimToken: randomUUID(), cleanupAttempts: 5 }
    });

    const first = await runOperationalChecks({ now, merchantId: fixture.merchantId });
    const openAlerts = await prisma.operationalAlert.findMany({
      where: { merchantId: fixture.merchantId, status: "open" }
    });
    const check = await prisma.operationalCheckRun.findFirstOrThrow({
      where: { merchantId: fixture.merchantId, runId: first.runId }
    });
    const openDeliveries = await prisma.operationalAlertDelivery.count({
      where: { alert: { merchantId: fixture.merchantId }, notificationVersion: 1 }
    });
    expect(first.degraded).toBe(1);
    expect(check.status).toBe("degraded");
    expect(openAlerts.some((alert) => alert.rule === "artifact.cleanup_stale_claim" && alert.severity === "critical")).toBe(true);
    expect(openAlerts.some((alert) => alert.rule === "artifact.cleanup_retries" && alert.severity === "critical")).toBe(true);
    expect(openDeliveries).toBe(openAlerts.length);

    await prisma.generatedArtifact.update({
      where: { id: fixture.artifactId },
      data: { bytesDeletedAt: now, cleanupClaimedAt: null, cleanupClaimToken: null }
    });
    await runOperationalChecks({ now: new Date(now.getTime() + 60_000), merchantId: fixture.merchantId });
    expect(await prisma.operationalAlert.count({ where: { merchantId: fixture.merchantId, status: { not: "resolved" } } })).toBe(0);
    expect(await prisma.operationalAlertDelivery.count({ where: { alert: { merchantId: fixture.merchantId } } })).toBe(openAlerts.length * 2);
  });
});

async function createRevisionFixture(options: { merchantId?: string; objectKey?: string } = {}) {
  const merchant = options.merchantId
    ? await prisma.merchant.findUniqueOrThrow({ where: { id: options.merchantId } })
    : await createMerchant();
  const store = await prisma.store.create({
    data: { merchantId: merchant.id, type: "woocommerce", url: `https://${randomUUID()}.example.test` }
  });
  const design = await prisma.design.create({ data: { merchantId: merchant.id, name: "Integration design" } });
  const designVersion = await prisma.designVersion.create({
    data: { merchantId: merchant.id, designId: design.id, version: 1, sceneGraph: {} }
  });
  const asset = await prisma.asset.create({
    data: {
      merchantId: merchant.id,
      kind: "preview",
      name: "Integration preview",
      versions: {
        create: {
          version: 1,
          objectKey: options.objectKey ?? `preview_derivative/${merchant.id}/${randomUUID()}.svg`,
          checksumSha256: "0".repeat(64),
          byteSize: 128n,
          contentType: "image/svg+xml",
          widthPx: 1200,
          heightPx: 800,
          validationStatus: "accepted"
        }
      }
    },
    include: { versions: true }
  });
  const session = await prisma.customisationSession.create({
    data: {
      merchantId: merchant.id,
      storeId: store.id,
      designId: design.id,
      externalProductId: randomUUID(),
      customerInputs: {},
      renderSpec: {},
      status: "committed"
    }
  });
  const revision = await prisma.customisationRevision.create({
    data: {
      merchantId: merchant.id,
      sessionId: session.id,
      designVersionId: designVersion.id,
      revision: 1,
      opaqueReference: randomUUID(),
      customerInputs: {},
      renderSpec: {},
      previewAssetVersionId: asset.versions[0]!.id
    }
  });
  return { merchantId: merchant.id, revisionId: revision.id };
}

async function createGeneratedArtifactFixture(options: {
  merchantId?: string;
  now: Date;
  downloadLeaseUntil?: Date;
  retentionHoldAt?: Date;
}) {
  const revisionFixture = await createRevisionFixture({ merchantId: options.merchantId });
  const revision = await prisma.customisationRevision.findUniqueOrThrow({
    where: { id: revisionFixture.revisionId },
    include: { session: true }
  });
  const outputProfile = await prisma.outputProfile.create({
    data: { merchantId: revisionFixture.merchantId, name: `Integration profile ${randomUUID()}` }
  });
  const outputProfileVersion = await prisma.outputProfileVersion.create({
    data: {
      merchantId: revisionFixture.merchantId,
      outputProfileId: outputProfile.id,
      version: 1,
      printerModel: "Integration printer",
      ripName: "Integration RIP",
      ripVersion: "1",
      widthUm: 100_000,
      heightUm: 100_000,
      processColourSpace: "CMYK",
      inkSequence: [],
      overprintPolicy: {},
      whiteMaskPolicy: {},
      glossMaskPolicy: {},
      preflightRuleVersion: "test.v1"
    }
  });
  const order = await prisma.externalOrder.create({
    data: {
      merchantId: revisionFixture.merchantId,
      storeId: revision.session.storeId,
      externalOrderId: randomUUID(),
      currency: "GBP",
      status: "completed",
      rawPayload: {}
    }
  });
  const snapshot = await prisma.orderArtworkSnapshot.create({
    data: {
      merchantId: revisionFixture.merchantId,
      customisationRevisionId: revision.id,
      designVersionId: revision.designVersionId,
      outputProfileVersionId: outputProfileVersion.id,
      renderSpecSchemaVersion: "scene.v1",
      snapshot: {}
    }
  });
  const printJob = await prisma.printJob.create({
    data: {
      merchantId: revisionFixture.merchantId,
      orderId: order.id,
      artworkSnapshotId: snapshot.id,
      status: "ready"
    }
  });
  const attempt = await prisma.printJobAttempt.create({
    data: {
      merchantId: revisionFixture.merchantId,
      printJobId: printJob.id,
      attemptNumber: 1,
      status: "ready",
      logs: {},
      finishedAt: new Date(options.now.getTime() - 20 * 24 * 60 * 60 * 1000)
    }
  });
  const artifact = await prisma.generatedArtifact.create({
    data: {
      merchantId: revisionFixture.merchantId,
      printJobAttemptId: attempt.id,
      outputProfileVersionId: outputProfileVersion.id,
      artifactType: "print_pdf",
      objectKey: `production_artifact/${revisionFixture.merchantId}/${randomUUID()}.pdf`,
      checksumSha256: "1".repeat(64),
      byteSize: 1024n,
      contentType: "application/pdf",
      preflightStatus: "passed",
      downloadLeaseUntil: options.downloadLeaseUntil,
      retentionHoldAt: options.retentionHoldAt,
      retentionHoldReason: options.retentionHoldAt ? "Integration test hold" : null,
      createdAt: new Date(options.now.getTime() - 16 * 24 * 60 * 60 * 1000)
    }
  });
  await prisma.merchantSettings.upsert({
    where: { merchantId: revisionFixture.merchantId },
    create: { merchantId: revisionFixture.merchantId, productionArtifactRetentionDays: 15 },
    update: { productionArtifactRetentionDays: 15 }
  });
  return { merchantId: revisionFixture.merchantId, artifactId: artifact.id };
}

function createMerchant() {
  return prisma.merchant.create({ data: { name: `${fixturePrefix}${randomUUID()}` } }).then((merchant) => {
    fixtureMerchantIds.add(merchant.id);
    return merchant;
  });
}

async function cleanupFixtures() {
  if (!integrationEnabled) return;
  const merchantIds = [...fixtureMerchantIds];
  if (merchantIds.length === 0) return;
  await prisma.generatedArtifact.deleteMany({ where: { merchantId: { in: merchantIds } } });
  await prisma.operationalAlert.deleteMany({ where: { merchantId: { in: merchantIds } } });
  await prisma.operationalCheckRun.deleteMany({ where: { merchantId: { in: merchantIds } } });
  await prisma.printJob.deleteMany({ where: { merchantId: { in: merchantIds } } });
  await prisma.orderArtworkSnapshot.deleteMany({ where: { merchantId: { in: merchantIds } } });
  await prisma.externalOrder.deleteMany({ where: { merchantId: { in: merchantIds } } });
  await prisma.customisationSession.deleteMany({ where: { merchantId: { in: merchantIds } } });
  await prisma.merchant.deleteMany({ where: { id: { in: merchantIds }, name: { startsWith: fixturePrefix } } });
  fixtureMerchantIds.clear();
}
