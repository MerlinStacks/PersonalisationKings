import { createHmac, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { prisma } from "@personalise-kings/db";
import { logEvent, serializeError } from "@personalise-kings/observability";
import { addCounter, recordHistogram } from "@personalise-kings/observability/telemetry";
import { Prisma } from "@prisma/client";

const webhookConfig = operationalWebhookConfig();

interface WebhookConfig {
  url: URL;
  secret: string;
  timeoutMs: number;
}

export async function processOperationalAlertDeliveries(maximumDeliveries = 5) {
  if (!webhookConfig) return 0;
  let delivered = 0;
  for (let index = 0; index < maximumDeliveries; index += 1) {
    const processed = await processNextDelivery(webhookConfig);
    if (!processed) break;
    delivered += processed === "delivered" ? 1 : 0;
  }
  return delivered;
}

async function processNextDelivery(config: WebhookConfig): Promise<"delivered" | "retry" | null> {
  const delivery = await prisma.$transaction(async (tx) => {
    const [candidate] = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "OperationalAlertDelivery"
      WHERE (
        ("status" = 'pending'::"OperationalAlertDeliveryStatus" AND "nextAttemptAt" <= NOW())
        OR ("status" = 'delivering'::"OperationalAlertDeliveryStatus" AND ("claimedAt" IS NULL OR "claimedAt" < NOW() - INTERVAL '15 minutes'))
      )
      ORDER BY "createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `);
    if (!candidate) return null;
    const claimToken = randomUUID();
    const claimed = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      UPDATE "OperationalAlertDelivery"
      SET "status" = 'delivering'::"OperationalAlertDeliveryStatus", "claimedAt" = NOW(),
        "claimToken" = ${claimToken}, "attempts" = "attempts" + 1, "lastError" = NULL, "updatedAt" = NOW()
      WHERE "id" = ${candidate.id}
      RETURNING "id"
    `);
    if (claimed.length !== 1) return null;
    return tx.operationalAlertDelivery.findUniqueOrThrow({ where: { id: candidate.id } });
  });
  if (!delivery?.claimToken) return null;

  const body = JSON.stringify(delivery.payload);
  const idempotencyKey = `${delivery.alertId}:${delivery.notificationVersion}:${delivery.channel}`;
  const timestamp = Math.floor(Date.now() / 1000);
  const startedAt = performance.now();
  try {
    const status = await sendWebhook(config, body, {
      "content-type": "application/json",
      "x-pk-signature": signOperationalAlert(body, config.secret, { timestamp, idempotencyKey, deliveryId: delivery.id }),
      "x-pk-idempotency-key": idempotencyKey,
      "x-pk-delivery-id": delivery.id,
      "x-pk-timestamp": String(timestamp)
    });
    if (status < 200 || status >= 300) throw new WebhookHttpError(status);
    const completed = await prisma.operationalAlertDelivery.updateMany({
      where: { id: delivery.id, status: "delivering", claimToken: delivery.claimToken },
      data: { status: "delivered", claimedAt: null, claimToken: null, deliveredAt: new Date(), lastError: null }
    });
    if (completed.count !== 1) throw new Error("Alert delivery claim was lost after webhook acceptance");
    logEvent("info", "operations.alert_delivered", { service: "worker-maintenance", deliveryId: delivery.id, idempotencyKey });
    addCounter("pk.operations.alert_deliveries", 1, { outcome: "delivered" });
    recordHistogram("pk.operations.alert_delivery.duration", (performance.now() - startedAt) / 1000, { outcome: "delivered" });
    return "delivered";
  } catch (error) {
    const message = (error instanceof Error ? error.message : "Unknown alert delivery error").slice(0, 1000);
    const delayMs = Math.min(15 * 60_000, 15_000 * 2 ** Math.max(0, delivery.attempts - 1));
    const permanent = error instanceof WebhookHttpError && isPermanentWebhookStatus(error.status);
    await prisma.operationalAlertDelivery.updateMany({
      where: { id: delivery.id, status: "delivering", claimToken: delivery.claimToken },
      data: {
        status: permanent ? "failed" : "pending",
        claimedAt: null,
        claimToken: null,
        nextAttemptAt: permanent ? new Date() : new Date(Date.now() + delayMs),
        lastError: message
      }
    });
    logEvent("error", "operations.alert_delivery_failed", {
      service: "worker-maintenance",
      deliveryId: delivery.id,
      idempotencyKey,
      error: serializeError(error)
    });
    addCounter("pk.operations.alert_deliveries", 1, { outcome: permanent ? "failed" : "retry" });
    recordHistogram("pk.operations.alert_delivery.duration", (performance.now() - startedAt) / 1000, { outcome: permanent ? "failed" : "retry" });
    return "retry";
  }
}

export function signOperationalAlert(
  body: string,
  secret: string,
  context: { timestamp: number; idempotencyKey: string; deliveryId: string }
) {
  const canonical = `${context.timestamp}\n${context.idempotencyKey}\n${context.deliveryId}\n${body}`;
  return `sha256=${createHmac("sha256", secret).update(canonical).digest("base64url")}`;
}

export function operationalWebhookConfig(
  env: Record<string, string | undefined> = process.env,
  production = process.env.NODE_ENV === "production"
): WebhookConfig | null {
  const configuredUrl = env.PK_OPERATIONS_ALERT_WEBHOOK_URL?.trim();
  const secret = env.PK_OPERATIONS_ALERT_WEBHOOK_SECRET?.trim();
  if (!configuredUrl && !secret) return null;
  if (!configuredUrl || !secret || secret.length < 32) throw new Error("Operational alert webhook URL and a secret of at least 32 characters are required together");
  const url = new URL(configuredUrl);
  if (url.username || url.password || url.hash) throw new Error("Operational alert webhook URL cannot contain credentials or a fragment");
  if (production && (url.protocol !== "https:" || (url.port && url.port !== "443"))) {
    throw new Error("Production operational alert webhook must use HTTPS on the default port");
  }
  if (!production && !["http:", "https:"].includes(url.protocol)) throw new Error("Operational alert webhook must use HTTP or HTTPS");
  if (production && isBlockedHostname(url.hostname)) throw new Error("Production operational alert webhook cannot target a private or reserved address");
  const configuredTimeout = Number(env.PK_OPERATIONS_ALERT_TIMEOUT_MS ?? 5000);
  const timeoutMs = Number.isSafeInteger(configuredTimeout) && configuredTimeout >= 500 && configuredTimeout <= 30_000 ? configuredTimeout : 5000;
  return { url, secret, timeoutMs };
}

async function sendWebhook(config: WebhookConfig, body: string, headers: Record<string, string>) {
  const hostname = config.url.hostname.replace(/^\[|\]$/g, "");
  const literalFamily = isIP(hostname);
  const addresses = literalFamily
    ? [{ address: hostname, family: literalFamily }]
    : await withTimeout(lookup(hostname, { all: true, verbatim: true }), config.timeoutMs, "Operational alert webhook DNS lookup timed out");
  if (addresses.length === 0 || (process.env.NODE_ENV === "production" && addresses.some(({ address }) => !isPublicIpAddress(address)))) {
    throw new Error("Operational alert webhook hostname resolves to a private or reserved address");
  }
  const target = addresses[0];
  const pinnedLookup: LookupFunction = (_hostname, _options, callback) => callback(null, target.address, target.family);
  const request = config.url.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise<number>((resolve, reject) => {
    let deadline: ReturnType<typeof setTimeout>;
    const outgoing = request(config.url, {
      method: "POST",
      headers: { ...headers, "content-length": Buffer.byteLength(body) },
      lookup: pinnedLookup,
      servername: config.url.hostname
    }, (response) => {
      clearTimeout(deadline);
      response.destroy();
      resolve(response.statusCode ?? 0);
    });
    deadline = setTimeout(() => outgoing.destroy(new Error("Operational alert webhook timed out")), config.timeoutMs);
    outgoing.once("error", (error) => {
      clearTimeout(deadline);
      reject(error);
    });
    outgoing.end(body);
  });
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  let timeout: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error(message)), timeoutMs); })
    ]);
  } finally {
    clearTimeout(timeout!);
  }
}

function isBlockedHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (isIP(normalized)) return !isPublicIpAddress(normalized);
  return normalized === "localhost" || normalized.endsWith(".localhost") || normalized.endsWith(".local")
    || normalized.endsWith(".internal") || normalized.endsWith(".lan") || normalized.endsWith(".home");
}

export function isPublicIpAddress(address: string) {
  const family = isIP(address);
  if (family === 4) return isPublicIpv4(address);
  if (family !== 6) return false;
  const parts = parseIpv6(address);
  if (!parts || (parts[0] & 0xe000) !== 0x2000) return false;
  if (parts[0] === 0x2001 && parts[1] <= 0x01ff) return false;
  if (parts[0] === 0x2001 && parts[1] === 0x0db8) return false;
  if (parts[0] === 0x2002 || (parts[0] === 0x3fff && parts[1] < 0x1000)) return false;
  return true;
}

export function isPermanentWebhookStatus(status: number) {
  return status >= 400 && status < 500 && ![408, 425, 429].includes(status);
}

function isPublicIpv4(address: string) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const value = (((parts[0] * 256 + parts[1]) * 256 + parts[2]) * 256 + parts[3]) >>> 0;
  return ![
    ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
    ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
    ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
    ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]
  ].some(([base, prefix]) => isInIpv4Range(value, String(base), Number(prefix)));
}

function isInIpv4Range(value: number, base: string, prefix: number) {
  const parts = base.split(".").map(Number);
  const baseValue = (((parts[0] * 256 + parts[1]) * 256 + parts[2]) * 256 + parts[3]) >>> 0;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) === (baseValue & mask);
}

function parseIpv6(address: string) {
  if (address.includes("%")) return null;
  let source = address.toLowerCase();
  if (source.includes(".")) {
    const lastColon = source.lastIndexOf(":");
    const ipv4 = source.slice(lastColon + 1);
    if (!isIP(ipv4)) return null;
    const octets = ipv4.split(".").map(Number);
    source = `${source.slice(0, lastColon)}:${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
  }
  const halves = source.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  if (halves.length === 1 && left.length !== 8) return null;
  if (halves.length === 2 && left.length + right.length >= 8) return null;
  const values = [...left, ...Array.from({ length: 8 - left.length - right.length }, () => "0"), ...right];
  if (values.length !== 8 || values.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null;
  return values.map((part) => Number.parseInt(part, 16));
}

class WebhookHttpError extends Error {
  constructor(readonly status: number) {
    super(`Webhook returned HTTP ${status}`);
  }
}
