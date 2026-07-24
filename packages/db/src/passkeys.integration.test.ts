import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashPassword } from "@personalise-kings/auth";
import { prisma } from "./index";

const runDatabaseTests = process.env.PK_RUN_DATABASE_INTEGRATION_TESTS === "true";
const integration = runDatabaseTests ? describe : describe.skip;
const merchantId = "passkey-integration-merchant";
const otherMerchantId = "passkey-integration-other";
const staffUserId = "passkey-integration-user";

integration("passkey database invariants", () => {
  beforeAll(async () => {
    const passwordHash = await hashPassword("integration-password");
    await prisma.merchant.createMany({
      data: [{ id: merchantId, name: "Passkey tenant" }, { id: otherMerchantId, name: "Other passkey tenant" }],
      skipDuplicates: true
    });
    await prisma.staffUser.upsert({
      where: { id: staffUserId },
      update: {},
      create: { id: staffUserId, merchantId, email: "passkey-integration@example.test", passwordHash, role: "owner_admin" }
    });
  });

  afterAll(async () => {
    if (!runDatabaseTests) return;
    await prisma.merchant.deleteMany({ where: { id: { in: [merchantId, otherMerchantId] } } });
  });

  it("enforces ownership, tenant binding, and single-use challenge claims", async () => {
    await expect(prisma.adminWebAuthnChallenge.create({
      data: {
        id: "passkey-invalid-auth-challenge",
        merchantId,
        staffUserId,
        ceremony: "authentication",
        challenge: "invalid_auth_challenge",
        expiresAt: new Date(Date.now() + 60_000)
      }
    })).rejects.toThrow();

    await expect(prisma.staffPasskey.create({
      data: {
        id: "passkey-invalid-tenant",
        merchantId: otherMerchantId,
        staffUserId,
        credentialId: "passkey_invalid_tenant_credential",
        publicKey: Buffer.from("public-key"),
        counter: 0,
        deviceType: "singleDevice",
        backedUp: false,
        name: "Invalid tenant"
      }
    })).rejects.toThrow();

    const challenge = await prisma.adminWebAuthnChallenge.create({
      data: {
        id: "passkey-valid-registration-challenge",
        merchantId,
        staffUserId,
        ceremony: "registration",
        challenge: "valid_registration_challenge",
        expiresAt: new Date(Date.now() + 60_000)
      }
    });
    const now = new Date();
    const claims = await Promise.all([
      prisma.adminWebAuthnChallenge.updateMany({ where: { id: challenge.id, consumedAt: null }, data: { consumedAt: now } }),
      prisma.adminWebAuthnChallenge.updateMany({ where: { id: challenge.id, consumedAt: null }, data: { consumedAt: now } })
    ]);
    expect(claims.reduce((total, claim) => total + claim.count, 0)).toBe(1);
  });
});
