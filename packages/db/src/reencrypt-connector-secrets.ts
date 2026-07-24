import { randomUUID } from "node:crypto";
import { connectorCiphertextKeyId, decryptVersionedConnectorSecret, encryptVersionedConnectorSecret, type ConnectorSecretContext } from "@personalise-kings/auth";
import { connectorWrappingKeyring, deploymentMode } from "@personalise-kings/config/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "./index";

export interface ReencryptOptions {
  merchantId?: string;
  allTenants: boolean;
  dryRun: boolean;
  batchSize: number;
  maxRecords: number;
  targetKeyId: string;
}

interface Summary {
  examined: number;
  candidates: number;
  reencrypted: number;
  concurrentSkips: number;
  failed: number;
}

export function parseReencryptOptions(args: string[]): ReencryptOptions {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (["--all-tenants", "--dry-run"].includes(argument)) {
      flags.add(argument);
      continue;
    }
    if (!["--merchant-id", "--to-key-id", "--batch-size", "--max-records"].includes(argument)) {
      throw new Error(`Unknown argument: ${argument}`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
    values.set(argument, value);
    index += 1;
  }
  const merchantId = values.get("--merchant-id");
  const allTenants = flags.has("--all-tenants");
  if (Boolean(merchantId) === allTenants) throw new Error("Specify exactly one of --merchant-id or --all-tenants");
  const targetKeyId = values.get("--to-key-id");
  if (!targetKeyId || !/^[A-Za-z0-9_-]{1,64}$/.test(targetKeyId)) throw new Error("--to-key-id is required and invalid");
  return {
    merchantId,
    allTenants,
    dryRun: flags.has("--dry-run"),
    batchSize: boundedInteger(values.get("--batch-size"), 100, 1, 500, "--batch-size"),
    maxRecords: boundedInteger(values.get("--max-records"), 100_000, 1, 1_000_000, "--max-records"),
    targetKeyId
  };
}

export async function reencryptConnectorSecrets(options: ReencryptOptions) {
  if (Boolean(options.merchantId) === options.allTenants) throw new Error("Exactly one tenant scope must be selected");
  deploymentMode();
  const keyring = connectorWrappingKeyring();
  if (keyring.activeKeyId !== options.targetKeyId) throw new Error("--to-key-id must match PK_CONNECTOR_SECRET_ENCRYPTION_ACTIVE_KEY_ID");
  const runId = randomUUID();
  const summary: Summary = { examined: 0, candidates: 0, reencrypted: 0, concurrentSkips: 0, failed: 0 };
  await scanStoreCredentials(options, keyring, runId, summary);
  await scanSigningKeys(options, keyring, runId, summary);
  await scanStoreMirrors(options, keyring, runId, summary);
  return { runId, dryRun: options.dryRun, targetKeyId: options.targetKeyId, ...summary };
}

async function scanStoreCredentials(options: ReencryptOptions, keyring: ReturnType<typeof connectorWrappingKeyring>, runId: string, summary: Summary) {
  let cursor: string | undefined;
  while (summary.candidates < options.maxRecords) {
    const rows = await prisma.storeCredential.findMany({
      where: { merchantId: options.merchantId },
      orderBy: { id: "asc" },
      take: options.batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, merchantId: true, storeId: true, encryptedPayload: true }
    });
    if (rows.length === 0) break;
    for (const row of rows) {
      if (summary.candidates >= options.maxRecords) break;
      summary.examined += 1;
      cursor = row.id;
      await migrateRecord({
        recordType: "StoreCredential",
        recordId: row.id,
        merchantId: row.merchantId,
        storeId: row.storeId,
        encrypted: row.encryptedPayload,
        context: { purpose: "woocommerce-rest", merchantId: row.merchantId, storeId: row.storeId },
        options,
        keyring,
        runId,
        summary,
        update: async (next) => prisma.$transaction(async (tx) => {
          const updated = await tx.storeCredential.updateMany({
            where: { id: row.id, merchantId: row.merchantId, storeId: row.storeId, encryptedPayload: row.encryptedPayload },
            data: { encryptedPayload: next }
          });
          if (updated.count !== 1) return false;
          await auditReencryption(tx, row.merchantId, "StoreCredential", row.id, runId, connectorCiphertextKeyId(row.encryptedPayload), options.targetKeyId);
          return true;
        })
      });
    }
  }
}

async function scanSigningKeys(options: ReencryptOptions, keyring: ReturnType<typeof connectorWrappingKeyring>, runId: string, summary: Summary) {
  let cursor: string | undefined;
  while (summary.candidates < options.maxRecords) {
    const rows = await prisma.storeWebhookSigningKey.findMany({
      where: { merchantId: options.merchantId },
      orderBy: { id: "asc" },
      take: options.batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, merchantId: true, storeId: true, keyId: true, secretEncrypted: true }
    });
    if (rows.length === 0) break;
    for (const row of rows) {
      if (summary.candidates >= options.maxRecords) break;
      summary.examined += 1;
      cursor = row.id;
      await migrateRecord({
        recordType: "StoreWebhookSigningKey",
        recordId: row.id,
        merchantId: row.merchantId,
        storeId: row.storeId,
        encrypted: row.secretEncrypted,
        context: { purpose: "store-webhook", merchantId: row.merchantId, storeId: row.storeId, signingKeyId: row.keyId },
        options,
        keyring,
        runId,
        summary,
        update: async (next) => prisma.$transaction(async (tx) => {
          const updated = await tx.storeWebhookSigningKey.updateMany({
            where: { id: row.id, merchantId: row.merchantId, storeId: row.storeId, keyId: row.keyId, secretEncrypted: row.secretEncrypted },
            data: { secretEncrypted: next }
          });
          if (updated.count !== 1) return false;
          await auditReencryption(tx, row.merchantId, "StoreWebhookSigningKey", row.id, runId, connectorCiphertextKeyId(row.secretEncrypted), options.targetKeyId);
          return true;
        })
      });
    }
  }
}

async function scanStoreMirrors(options: ReencryptOptions, keyring: ReturnType<typeof connectorWrappingKeyring>, runId: string, summary: Summary) {
  let cursor: string | undefined;
  while (summary.candidates < options.maxRecords) {
    const rows = await prisma.store.findMany({
      where: { merchantId: options.merchantId, webhookSecretEncrypted: { not: null }, webhookSigningKeyId: { not: null } },
      orderBy: { id: "asc" },
      take: options.batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, merchantId: true, webhookSigningKeyId: true, webhookSecretEncrypted: true }
    });
    if (rows.length === 0) break;
    for (const row of rows) {
      if (summary.candidates >= options.maxRecords) break;
      summary.examined += 1;
      cursor = row.id;
      if (!row.webhookSigningKeyId || !row.webhookSecretEncrypted) continue;
      const signingKeyId = row.webhookSigningKeyId;
      const encryptedMirror = row.webhookSecretEncrypted;
      await migrateRecord({
        recordType: "StoreWebhookSecretMirror",
        recordId: row.id,
        merchantId: row.merchantId,
        storeId: row.id,
        encrypted: encryptedMirror,
        context: { purpose: "store-webhook", merchantId: row.merchantId, storeId: row.id, signingKeyId },
        options,
        keyring,
        runId,
        summary,
        update: async (next) => prisma.$transaction(async (tx) => {
          const updated = await tx.store.updateMany({
            where: { id: row.id, merchantId: row.merchantId, webhookSigningKeyId: signingKeyId, webhookSecretEncrypted: encryptedMirror },
            data: { webhookSecretEncrypted: next }
          });
          if (updated.count !== 1) return false;
          await auditReencryption(tx, row.merchantId, "Store", row.id, runId, connectorCiphertextKeyId(encryptedMirror), options.targetKeyId);
          return true;
        })
      });
    }
  }
}

async function migrateRecord(input: {
  recordType: string;
  recordId: string;
  merchantId: string;
  storeId: string;
  encrypted: string;
  context: ConnectorSecretContext;
  options: ReencryptOptions;
  keyring: ReturnType<typeof connectorWrappingKeyring>;
  runId: string;
  summary: Summary;
  update: (encrypted: string) => Promise<boolean>;
}) {
  if (connectorCiphertextKeyId(input.encrypted) === input.options.targetKeyId) return;
  input.summary.candidates += 1;
  const plaintext = decryptVersionedConnectorSecret(input.encrypted, input.keyring, input.context);
  if (plaintext === null) {
    input.summary.failed += 1;
    console.error(JSON.stringify({ event: "connector_secret.reencryption_failed", runId: input.runId, recordType: input.recordType, recordId: input.recordId, reason: "decrypt_failed" }));
    return;
  }
  if (input.options.dryRun) return;
  const encrypted = encryptVersionedConnectorSecret(plaintext, input.keyring, input.context);
  if (await input.update(encrypted)) input.summary.reencrypted += 1;
  else input.summary.concurrentSkips += 1;
}

async function auditReencryption(
  tx: Prisma.TransactionClient,
  merchantId: string,
  targetType: string,
  targetId: string,
  runId: string,
  sourceKeyId: string | null,
  targetKeyId: string
) {
  await tx.auditEvent.create({
    data: {
      merchantId,
      action: "connector_secret.reencrypted",
      targetType,
      targetId,
      metadata: { runId, sourceKeyId: sourceKeyId ?? "unknown", targetKeyId }
    }
  });
}

function boundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number, name: string) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error(`${name} is outside its allowed range`);
  return parsed;
}

if (import.meta.main) {
  try {
    const options = parseReencryptOptions(process.argv.slice(2));
    const result = await reencryptConnectorSecrets(options);
    console.log(JSON.stringify({ event: "connector_secret.reencryption_completed", ...result }));
    if (result.failed > 0 || result.concurrentSkips > 0) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Connector secret re-encryption failed");
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}
