import { isAbsolute } from "node:path";

export type ServiceName = "api" | "web-admin" | "customiser" | "worker-maintenance" | "worker-proof" | "worker-render";
export type DeploymentMode = "development" | "test" | "production";
export interface ConnectorWrappingKeyring {
  activeKeyId: string;
  keys: Record<string, string>;
}

export function deploymentMode(env: Record<string, string | undefined> = process.env): DeploymentMode {
  const mode = env.NODE_ENV;
  if (mode === "development" || mode === "test" || mode === "production") return mode;
  throw new Error("NODE_ENV must be explicitly set to development, test, or production");
}

export function validateServiceEnvironment(service: ServiceName, env: Record<string, string | undefined> = process.env) {
  const mode = deploymentMode(env);
  if (mode !== "production") return { mode } as const;
  rejectDevelopmentFlags(env);

  if (service !== "customiser") requirePostgresUrl(env.DATABASE_URL);
  if (["api", "web-admin", "worker-maintenance", "worker-proof"].includes(service)) requireStorage(env);
  if (service === "customiser") requireHttpsOrigin("PK_API_URL", env.PK_API_URL);
  if (service === "api") {
    requireHttpsOrigin("PK_WEBAPP_URL", env.PK_WEBAPP_URL);
    requireHttpsOrigin("PK_CUSTOMISER_URL", env.PK_CUSTOMISER_URL);
    requireHttpsOrigin("PK_API_URL", env.PK_API_URL);
    requireMediaSanitizer(env);
    requireConnectorWakeupRedis(env);
    const connectorKeys = connectorWrappingKeyring(env);
    requireStrongSecret("PK_EMBED_TOKEN_SECRET", env.PK_EMBED_TOKEN_SECRET);
    requireStrongSecret("PK_OBJECT_URL_SECRET", env.PK_OBJECT_URL_SECRET);
    requireDistinctValues([...Object.values(connectorKeys.keys), required("PK_EMBED_TOKEN_SECRET", env.PK_EMBED_TOKEN_SECRET), required("PK_OBJECT_URL_SECRET", env.PK_OBJECT_URL_SECRET)]);
  }
  if (service === "web-admin") {
    requireHttpsOrigin("PK_WEBAPP_URL", env.PK_WEBAPP_URL);
    requireHttpsOrigin("PK_CUSTOMISER_URL", env.PK_CUSTOMISER_URL);
    requireHttpsOrigin("PK_API_URL", env.PK_API_URL);
    requireMediaSanitizer(env);
    requireBase64Key("PK_ADMIN_MFA_ENCRYPTION_KEY", env.PK_ADMIN_MFA_ENCRYPTION_KEY);
    requireStrongSecret("PK_ADMIN_RECOVERY_CODE_PEPPER", env.PK_ADMIN_RECOVERY_CODE_PEPPER);
    const connectorKeys = connectorWrappingKeyring(env);
    requireStrongSecret("PK_EMBED_TOKEN_SECRET", env.PK_EMBED_TOKEN_SECRET);
    requireStrongSecret("PK_OBJECT_URL_SECRET", env.PK_OBJECT_URL_SECRET);
    requireDistinctValues([
      required("PK_ADMIN_MFA_ENCRYPTION_KEY", env.PK_ADMIN_MFA_ENCRYPTION_KEY),
      required("PK_ADMIN_RECOVERY_CODE_PEPPER", env.PK_ADMIN_RECOVERY_CODE_PEPPER),
      ...Object.values(connectorKeys.keys),
      required("PK_EMBED_TOKEN_SECRET", env.PK_EMBED_TOKEN_SECRET),
      required("PK_OBJECT_URL_SECRET", env.PK_OBJECT_URL_SECRET)
    ]);
  }
  if (service === "worker-maintenance") requireConnectorWakeupRedis(env);
  return { mode } as const;
}

export function connectorWrappingKeyring(env: Record<string, string | undefined> = process.env): ConnectorWrappingKeyring {
  const legacy = env.PK_CONNECTOR_SECRET_ENCRYPTION_KEY?.trim();
  const encodedKeyring = env.PK_CONNECTOR_SECRET_ENCRYPTION_KEYS?.trim();
  const configuredActiveKeyId = env.PK_CONNECTOR_SECRET_ENCRYPTION_ACTIVE_KEY_ID?.trim();
  if (!encodedKeyring) {
    if (!legacy) throw new Error("Connector wrapping-key configuration is required");
    requireBase64Key("PK_CONNECTOR_SECRET_ENCRYPTION_KEY", legacy);
    return { activeKeyId: "legacy", keys: { legacy } };
  }
  if (encodedKeyring.length > 8_192) throw new Error("PK_CONNECTOR_SECRET_ENCRYPTION_KEYS is too large");
  let parsed: unknown;
  try { parsed = JSON.parse(encodedKeyring); } catch { throw new Error("PK_CONNECTOR_SECRET_ENCRYPTION_KEYS must be a JSON object"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("PK_CONNECTOR_SECRET_ENCRYPTION_KEYS must be a JSON object");
  }
  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.length < 1 || entries.length > 20) throw new Error("Connector wrapping-key configuration must contain between 1 and 20 keys");
  const keys: Record<string, string> = {};
  for (const [keyId, value] of entries) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(keyId) || typeof value !== "string") {
      throw new Error("Connector wrapping-key IDs and values are invalid");
    }
    requireBase64Key(`Connector wrapping key ${keyId}`, value);
    keys[keyId] = value;
  }
  requireDistinctValues(Object.values(keys));
  if (!configuredActiveKeyId || !keys[configuredActiveKeyId]) {
    throw new Error("PK_CONNECTOR_SECRET_ENCRYPTION_ACTIVE_KEY_ID must identify a configured key");
  }
  if (legacy && keys.legacy !== legacy) {
    throw new Error("PK_CONNECTOR_SECRET_ENCRYPTION_KEY must match the keyring's legacy entry when both are configured");
  }
  return { activeKeyId: configuredActiveKeyId, keys };
}

export function assertDemoSeedAllowed(env: Record<string, string | undefined> = process.env) {
  const mode = deploymentMode(env);
  if (mode === "production") throw new Error("The demonstration seed is disabled in production");
  if (mode !== "development" || env.PK_ALLOW_DEMO_SEED !== "true") {
    throw new Error("The demonstration seed requires NODE_ENV=development and PK_ALLOW_DEMO_SEED=true");
  }
}

export function insecureDevelopmentEnabled(env: Record<string, string | undefined> = process.env) {
  return env.NODE_ENV === "development" && env.PK_ENABLE_INSECURE_DEVELOPMENT === "true";
}

function requirePostgresUrl(value: string | undefined) {
  const url = parseUrl("DATABASE_URL", value);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !url.pathname.slice(1)) {
    throw new Error("DATABASE_URL must be a PostgreSQL URL with a host and database name");
  }
}

function requireStorage(env: Record<string, string | undefined>) {
  const backend = required("OBJECT_STORAGE_BACKEND", env.OBJECT_STORAGE_BACKEND);
  if (backend === "local") {
    const root = required("OBJECT_STORAGE_ROOT", env.OBJECT_STORAGE_ROOT);
    if (!isAbsolute(root)) throw new Error("OBJECT_STORAGE_ROOT must be an absolute path in production");
  } else if (backend === "s3") {
    const bucket = required("OBJECT_STORAGE_S3_BUCKET", env.OBJECT_STORAGE_S3_BUCKET);
    if (!/^(?=.{3,63}$)(?!.*\.\.)(?!\d+\.\d+\.\d+\.\d+$)[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(bucket)) {
      throw new Error("OBJECT_STORAGE_S3_BUCKET must be a valid DNS-compatible bucket name");
    }
    if (!/^[A-Za-z0-9-]{1,64}$/.test(required("OBJECT_STORAGE_S3_REGION", env.OBJECT_STORAGE_S3_REGION))) {
      throw new Error("OBJECT_STORAGE_S3_REGION is invalid");
    }
    if (env.OBJECT_STORAGE_S3_ENDPOINT?.trim()) requireHttpsEndpoint("OBJECT_STORAGE_S3_ENDPOINT", env.OBJECT_STORAGE_S3_ENDPOINT);
    if (env.OBJECT_STORAGE_S3_FORCE_PATH_STYLE && !["true", "false"].includes(env.OBJECT_STORAGE_S3_FORCE_PATH_STYLE)) {
      throw new Error("OBJECT_STORAGE_S3_FORCE_PATH_STYLE must be true or false");
    }
  } else {
    throw new Error("OBJECT_STORAGE_BACKEND must be local or s3");
  }
  const maximumBytes = Number(required("OBJECT_STORAGE_MAX_BYTES", env.OBJECT_STORAGE_MAX_BYTES));
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1024 || maximumBytes > 1024 * 1024 * 1024) {
    throw new Error("OBJECT_STORAGE_MAX_BYTES must be an integer between 1024 and 1073741824");
  }
}

function requireHttpsEndpoint(name: string, value: string | undefined) {
  const url = parseUrl(name, value);
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password || url.search || url.hash) {
    throw new Error(`${name} must be an HTTPS URL without credentials, query, or fragment`);
  }
}

function requireMediaSanitizer(env: Record<string, string | undefined>) {
  const name = "PK_MEDIA_SANITIZER_URL";
  const input = required(name, env[name]);
  const url = parseUrl(name, input);
  if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password
    || url.pathname !== "/" || url.search || url.hash || input.replace(/\/$/, "") !== url.origin) {
    throw new Error(`${name} must be an exact HTTP or HTTPS origin`);
  }
  if (url.origin !== "http://media-sanitizer:3003") {
    throw new Error(`${name} must use the isolated media-sanitizer service origin`);
  }
  const timeout = Number(required("PK_MEDIA_SANITIZER_TIMEOUT_MS", env.PK_MEDIA_SANITIZER_TIMEOUT_MS));
  if (!Number.isSafeInteger(timeout) || timeout < 1_000 || timeout > 60_000) {
    throw new Error("PK_MEDIA_SANITIZER_TIMEOUT_MS must be an integer between 1000 and 60000");
  }
}

function requireConnectorWakeupRedis(env: Record<string, string | undefined>) {
  const name = "PK_CONNECTOR_WAKEUP_REDIS_URL";
  const url = parseUrl(name, env[name]);
  if (!["redis:", "rediss:"].includes(url.protocol) || !url.hostname || url.hash || url.search
    || (url.pathname !== "" && url.pathname !== "/" && !/^\/\d+$/.test(url.pathname))) {
    throw new Error(`${name} must be a Redis URL with an optional numeric database path`);
  }
}

function requireHttpsOrigin(name: string, value: string | undefined) {
  const input = required(name, value);
  const url = parseUrl(name, input);
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password || url.port && url.port !== "443"
    || url.pathname !== "/" || url.search || url.hash || input.replace(/\/$/, "") !== url.origin) {
    throw new Error(`${name} must be an exact public HTTPS origin on port 443`);
  }
}

function requireBase64Key(name: string, value: string | undefined) {
  const input = required(name, value);
  const decoded = Buffer.from(input, "base64");
  if (decoded.length !== 32 || decoded.toString("base64") !== input) {
    throw new Error(`${name} must be a canonical base64-encoded 32-byte key`);
  }
}

function requireStrongSecret(name: string, value: string | undefined) {
  const input = required(name, value);
  if (Buffer.byteLength(input, "utf8") < 32 || /change[-_ ]?me|generate[-_ ]?me|example|password/i.test(input)) {
    throw new Error(`${name} must contain at least 32 bytes and must not be a placeholder`);
  }
}

function requireDistinctValues(values: string[]) {
  if (new Set(values).size !== values.length) throw new Error("Production secrets must use distinct values");
}

function rejectDevelopmentFlags(env: Record<string, string | undefined>) {
  for (const name of ["PK_ALLOW_DEMO_SEED", "PK_ENABLE_INSECURE_DEVELOPMENT", "PK_ALLOW_DEV_SESSION", "PK_ALLOW_PRIVATE_STORE_URLS"]) {
    if (env[name] === "true") throw new Error(`${name} must not be enabled in production`);
  }
}

function required(name: string, value: string | undefined) {
  const input = value?.trim();
  if (!input) throw new Error(`${name} is required in production`);
  return input;
}

function parseUrl(name: string, value: string | undefined) {
  try {
    return new URL(required(name, value));
  } catch (error) {
    if (error instanceof Error && error.message.endsWith("is required in production")) throw error;
    throw new Error(`${name} must be a valid URL`);
  }
}
