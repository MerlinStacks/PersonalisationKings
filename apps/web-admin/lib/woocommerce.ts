import { decryptConnectorSecret, encryptConnectorSecret } from "@personalise-kings/auth";
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import * as z from "zod";

export const WOOCOMMERCE_AUTH_TTL_MS = 15 * 60 * 1_000;

const wooCommerceCredentialsSchema = z.object({
  consumerKey: z.string().min(1).max(200).startsWith("ck_"),
  consumerSecret: z.string().min(1).max(200).startsWith("cs_")
}).strict();

export type WooCommerceCredentials = z.infer<typeof wooCommerceCredentialsSchema>;

interface ResolvedAddress {
  address: string;
  family: number;
}

type ResolveHost = (hostname: string) => Promise<readonly ResolvedAddress[]>;

export interface ResolvedWooCommerceStore {
  url: string;
  address: string;
  family: number;
}

export interface WooCommerceHealthResult {
  healthy: boolean;
  statusCode?: number;
  error?: string;
}

export function normalizeWooCommerceStoreUrl(value: string, allowPrivate = privateStoreUrlsAllowed()) {
  if (typeof value !== "string" || value.length > 2_048) {
    throw new Error("Enter a valid WooCommerce store URL");
  }

  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Enter a valid WooCommerce store URL");
  }

  if (url.protocol !== "https:") throw new Error("WooCommerce store URLs must use HTTPS");
  if (url.username || url.password) throw new Error("Store URLs cannot contain credentials");
  if (url.search || url.hash) throw new Error("Enter the store base URL without a query string or fragment");
  if (!url.hostname || (!allowPrivate && isBlockedHostname(url.hostname))) throw new Error("The store URL must use a public hostname");

  const pathname = url.pathname.replace(/\/+$/, "");
  return `${url.origin}${pathname}`;
}

export async function resolveWooCommerceStore(
  value: string,
  resolveHost: ResolveHost = defaultResolveHost,
  allowPrivate = privateStoreUrlsAllowed()
): Promise<ResolvedWooCommerceStore> {
  const url = normalizeWooCommerceStoreUrl(value, allowPrivate);
  const hostname = unbracketHostname(new URL(url).hostname);
  let addresses: readonly ResolvedAddress[];

  const literalFamily = isIP(hostname);
  if (literalFamily) {
    addresses = [{ address: hostname, family: literalFamily }];
  } else {
    try {
      addresses = await resolveHost(hostname);
    } catch {
      throw new Error("The store hostname could not be resolved");
    }
  }

  if (addresses.length === 0) throw new Error("The store hostname did not resolve to an address");
  if (!allowPrivate && addresses.some(({ address }) => !isPublicIpAddress(address))) {
    throw new Error("The store hostname resolves to a private or reserved address");
  }

  return { url, address: addresses[0].address, family: addresses[0].family };
}

export function buildWooCommerceAuthorizeUrl(storeUrl: string, attemptId: string, appUrl: string) {
  if (!attemptId || attemptId.length > 200) throw new Error("Invalid WooCommerce authorization attempt");
  const applicationUrl = normalizeApplicationUrl(appUrl);
  const authorizeUrl = appendPath(normalizeWooCommerceStoreUrl(storeUrl), "/wc-auth/v1/authorize");
  authorizeUrl.searchParams.set("app_name", "PersonaliseKings");
  authorizeUrl.searchParams.set("scope", "read");
  authorizeUrl.searchParams.set("user_id", attemptId);
  authorizeUrl.searchParams.set("return_url", new URL("/api/stores/woocommerce/return", applicationUrl).toString());
  authorizeUrl.searchParams.set("callback_url", new URL("/api/stores/woocommerce/callback", applicationUrl).toString());
  return authorizeUrl.toString();
}

export function webAppUrl() {
  const configured = process.env.PK_WEBAPP_URL;
  if (!configured && process.env.NODE_ENV === "production") {
    throw new Error("PK_WEBAPP_URL is required for WooCommerce authorization");
  }
  return normalizeApplicationUrl(configured ?? "http://localhost:3000");
}

export function connectorEncryptionKey() {
  const key = process.env.PK_CONNECTOR_SECRET_ENCRYPTION_KEY;
  if (!key) throw new Error("PK_CONNECTOR_SECRET_ENCRYPTION_KEY is required for store credentials");
  if (Buffer.from(key, "base64").length !== 32) {
    throw new Error("PK_CONNECTOR_SECRET_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
  }
  return key;
}

export function encryptWooCommerceCredentials(credentials: WooCommerceCredentials, encryptionKey: string) {
  return encryptConnectorSecret(JSON.stringify(wooCommerceCredentialsSchema.parse(credentials)), encryptionKey);
}

export function decryptWooCommerceCredentials(encrypted: string, encryptionKey: string): WooCommerceCredentials | null {
  const plaintext = decryptConnectorSecret(encrypted, encryptionKey);
  if (!plaintext) return null;
  try {
    return wooCommerceCredentialsSchema.parse(JSON.parse(plaintext));
  } catch {
    return null;
  }
}

export async function checkWooCommerceCredentials(
  storeUrl: string,
  credentials: WooCommerceCredentials,
  options: Readonly<{ resolveHost?: ResolveHost; timeoutMs?: number; allowPrivate?: boolean }> = {}
): Promise<WooCommerceHealthResult> {
  const store = await resolveWooCommerceStore(storeUrl, options.resolveHost, options.allowPrivate);
  const endpoint = appendPath(store.url, "/wp-json/wc/v3/orders");
  endpoint.searchParams.set("per_page", "1");
  endpoint.searchParams.set("_fields", "id");

  const pinnedLookup: LookupFunction = (_hostname, lookupOptions, callback) => {
    if (lookupOptions.all) {
      callback(null, [{ address: store.address, family: store.family }]);
      return;
    }
    callback(null, store.address, store.family);
  };

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: WooCommerceHealthResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const request = httpsRequest(endpoint, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Basic ${Buffer.from(`${credentials.consumerKey}:${credentials.consumerSecret}`).toString("base64")}`,
        "User-Agent": "PersonaliseKings/1.0"
      },
      lookup: pinnedLookup
    }, (response) => {
      response.resume();
      const statusCode = response.statusCode ?? 0;
      if (statusCode >= 200 && statusCode < 300) {
        finish({ healthy: true, statusCode });
      } else if (statusCode === 401 || statusCode === 403) {
        finish({ healthy: false, statusCode, error: "WooCommerce rejected the REST API credentials" });
      } else if (statusCode >= 300 && statusCode < 400) {
        finish({ healthy: false, statusCode, error: "The store redirected the API request; use its canonical HTTPS URL" });
      } else if (statusCode === 404) {
        finish({ healthy: false, statusCode, error: "The WooCommerce REST API endpoint was not found" });
      } else {
        finish({ healthy: false, statusCode, error: `WooCommerce returned HTTP ${statusCode || "unknown"}` });
      }
    });

    request.setTimeout(options.timeoutMs ?? 8_000, () => {
      request.destroy();
      finish({ healthy: false, error: "The WooCommerce health check timed out" });
    });
    request.once("error", () => finish({ healthy: false, error: "A secure connection to WooCommerce could not be established" }));
    request.end();
  });
}

export function isPublicIpAddress(address: string) {
  const family = isIP(address);
  if (family === 4) return isPublicIpv4(address);
  if (family !== 6) return false;

  const parts = parseIpv6(address);
  if (!parts) return false;
  if ((parts[0] & 0xe000) !== 0x2000) return false;
  if (parts[0] === 0x2001 && parts[1] <= 0x01ff) return false;
  if (parts[0] === 0x2001 && parts[1] === 0x0db8) return false;
  if (parts[0] === 0x2002) return false;
  if (parts[0] === 0x3fff && parts[1] < 0x1000) return false;
  return true;
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
  const baseParts = base.split(".").map(Number);
  const baseValue = (((baseParts[0] * 256 + baseParts[1]) * 256 + baseParts[2]) * 256 + baseParts[3]) >>> 0;
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
  const missing = 8 - left.length - right.length;
  const values = [...left, ...Array.from({ length: missing }, () => "0"), ...right];
  if (values.length !== 8 || values.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null;
  return values.map((part) => Number.parseInt(part, 16));
}

function isBlockedHostname(hostname: string) {
  const normalized = unbracketHostname(hostname).toLowerCase().replace(/\.$/, "");
  if (isIP(normalized)) return !isPublicIpAddress(normalized);
  return normalized === "localhost" || normalized.endsWith(".localhost") || normalized.endsWith(".local")
    || normalized.endsWith(".internal") || normalized.endsWith(".lan") || normalized.endsWith(".home");
}

function unbracketHostname(hostname: string) {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

async function defaultResolveHost(hostname: string) {
  return lookup(hostname, { all: true, verbatim: true });
}

function appendPath(baseUrl: string, path: string) {
  const url = new URL(baseUrl);
  url.pathname = `${url.pathname.replace(/\/+$/, "")}${path}`;
  return url;
}

function normalizeApplicationUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("PK_WEBAPP_URL must be a valid URL");
  }
  const localHttp = process.env.NODE_ENV === "development" && url.protocol === "http:"
    && (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1");
  if (url.protocol !== "https:" && !localHttp) throw new Error("PK_WEBAPP_URL must use HTTPS");
  if (url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
    throw new Error("PK_WEBAPP_URL must be an origin without credentials, path, query string, or fragment");
  }
  return url.origin;
}

function privateStoreUrlsAllowed() {
  return process.env.NODE_ENV === "development" && process.env.PK_ALLOW_PRIVATE_STORE_URLS === "true";
}
