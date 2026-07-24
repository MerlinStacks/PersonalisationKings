import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { connectorCiphertextKeyId, decryptVersionedConnectorSecret, encryptConnectorSecret, encryptStoreWebhookSecret } from "@personalise-kings/auth";
import { prisma } from "./index";
import { reencryptConnectorSecrets } from "./reencrypt-connector-secrets";

const runDatabaseTests = process.env.PK_RUN_DATABASE_INTEGRATION_TESTS === "true";
const integration = runDatabaseTests ? describe : describe.skip;
const legacyKey = Buffer.alloc(32, 31).toString("base64");
const nextKey = Buffer.alloc(32, 32).toString("base64");
const merchantId = "reencrypt-merchant-1";
const otherMerchantId = "reencrypt-merchant-2";

integration("connector secret re-encryption", () => {
  beforeAll(async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("PK_CONNECTOR_SECRET_ENCRYPTION_KEY", legacyKey);
    vi.stubEnv("PK_CONNECTOR_SECRET_ENCRYPTION_ACTIVE_KEY_ID", "next");
    vi.stubEnv("PK_CONNECTOR_SECRET_ENCRYPTION_KEYS", JSON.stringify({ legacy: legacyKey, next: nextKey }));
    await prisma.merchant.createMany({
      data: [{ id: merchantId, name: "Re-encryption tenant" }, { id: otherMerchantId, name: "Other tenant" }],
      skipDuplicates: true
    });
    for (const [id, owner] of [["reencrypt-store-1", merchantId], ["reencrypt-store-2", otherMerchantId]] as const) {
      const signingKeyId = "legacy-signing-key";
      const encryptedWebhook = encryptStoreWebhookSecret("webhook-secret-with-at-least-32-bytes", legacyKey, id, signingKeyId);
      await prisma.store.upsert({
        where: { id },
        update: { webhookSigningKeyId: signingKeyId, webhookSecretEncrypted: encryptedWebhook },
        create: {
          id,
          merchantId: owner,
          type: "woocommerce",
          url: `https://${id}.example.com`,
          webhookSigningKeyId: signingKeyId,
          webhookSecretEncrypted: encryptedWebhook
        }
      });
      await prisma.storeWebhookSigningKey.upsert({
        where: { storeId_keyId: { storeId: id, keyId: signingKeyId } },
        update: { secretEncrypted: encryptedWebhook },
        create: { merchantId: owner, storeId: id, keyId: signingKeyId, secretEncrypted: encryptedWebhook }
      });
      await prisma.storeCredential.upsert({
        where: { storeId_merchantId: { storeId: id, merchantId: owner } },
        update: { encryptedPayload: encryptConnectorSecret(JSON.stringify({ consumerKey: "ck_test", consumerSecret: "cs_test" }), legacyKey) },
        create: {
          merchantId: owner,
          storeId: id,
          encryptedPayload: encryptConnectorSecret(JSON.stringify({ consumerKey: "ck_test", consumerSecret: "cs_test" }), legacyKey),
          permissions: "read",
          source: "test"
        }
      });
    }
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    if (!runDatabaseTests) return;
    await prisma.merchant.deleteMany({ where: { id: { in: [merchantId, otherMerchantId] } } });
  });

  it("migrates one tenant atomically and is idempotent", async () => {
    const result = await reencryptConnectorSecrets({
      merchantId,
      allTenants: false,
      dryRun: false,
      batchSize: 10,
      maxRecords: 10,
      targetKeyId: "next"
    });
    expect(result).toMatchObject({ candidates: 3, reencrypted: 3, failed: 0, concurrentSkips: 0 });

    const store = await prisma.store.findUniqueOrThrow({ where: { id: "reencrypt-store-1" }, include: { credential: true, webhookSigningKeys: true } });
    expect(connectorCiphertextKeyId(store.credential!.encryptedPayload)).toBe("next");
    expect(connectorCiphertextKeyId(store.webhookSigningKeys[0]!.secretEncrypted)).toBe("next");
    expect(connectorCiphertextKeyId(store.webhookSecretEncrypted!)).toBe("next");
    expect(decryptVersionedConnectorSecret(store.credential!.encryptedPayload, { activeKeyId: "next", keys: { next: nextKey } }, {
      purpose: "woocommerce-rest", merchantId, storeId: store.id
    })).toContain("ck_test");
    expect(await prisma.auditEvent.count({ where: { merchantId, action: "connector_secret.reencrypted" } })).toBe(3);

    const untouched = await prisma.store.findUniqueOrThrow({ where: { id: "reencrypt-store-2" }, include: { credential: true } });
    expect(connectorCiphertextKeyId(untouched.credential!.encryptedPayload)).toBe("legacy");

    const rerun = await reencryptConnectorSecrets({
      merchantId,
      allTenants: false,
      dryRun: false,
      batchSize: 10,
      maxRecords: 10,
      targetKeyId: "next"
    });
    expect(rerun).toMatchObject({ candidates: 0, reencrypted: 0, failed: 0 });
    expect(await prisma.auditEvent.count({ where: { merchantId, action: "connector_secret.reencrypted" } })).toBe(3);
  });
});
