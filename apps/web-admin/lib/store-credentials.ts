import type { Prisma } from "@prisma/client";

type CredentialClient = Pick<Prisma.TransactionClient, "store" | "storeCredential">;

interface StoreCredentialInput {
  merchantId: string;
  storeId: string;
  encryptedPayload: string;
  externalKeyId?: string | null;
  permissions: string;
  source: "woocommerce_auth" | "manual";
  verifiedAt?: Date;
}

export async function persistStoreCredential(client: CredentialClient, input: StoreCredentialInput) {
  const existing = await client.storeCredential.findUnique({
    where: { storeId_merchantId: { storeId: input.storeId, merchantId: input.merchantId } },
    select: { id: true }
  });
  if (existing) {
    await client.storeCredential.delete({
      where: { storeId_merchantId: { storeId: input.storeId, merchantId: input.merchantId } }
    });
  }
  const credential = await client.storeCredential.create({
    data: {
      merchantId: input.merchantId,
      storeId: input.storeId,
      encryptedPayload: input.encryptedPayload,
      externalKeyId: input.externalKeyId,
      permissions: input.permissions,
      source: input.source
    }
  });

  await client.store.update({
    where: { id_merchantId: { id: input.storeId, merchantId: input.merchantId } },
    data: {
      credentialReference: credential.id,
      connectionStatus: "connected",
      connectionLastError: null,
      connectionRevokedAt: null,
      ...(input.verifiedAt ? {
        connectionLastCheckedAt: input.verifiedAt,
        connectionLastSuccessfulAt: input.verifiedAt
      } : {})
    }
  });

  return { credential, rotated: Boolean(existing) };
}
