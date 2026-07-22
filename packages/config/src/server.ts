import { isAbsolute } from "node:path";

export type ServiceName = "api" | "web-admin" | "customiser" | "worker-maintenance" | "worker-proof" | "worker-render";
export type DeploymentMode = "development" | "test" | "production";

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
    requireBase64Key("PK_CONNECTOR_SECRET_ENCRYPTION_KEY", env.PK_CONNECTOR_SECRET_ENCRYPTION_KEY);
    requireStrongSecret("PK_EMBED_TOKEN_SECRET", env.PK_EMBED_TOKEN_SECRET);
    requireStrongSecret("PK_OBJECT_URL_SECRET", env.PK_OBJECT_URL_SECRET);
    requireDistinctSecrets(env, ["PK_CONNECTOR_SECRET_ENCRYPTION_KEY", "PK_EMBED_TOKEN_SECRET", "PK_OBJECT_URL_SECRET"]);
  }
  if (service === "web-admin") {
    requireHttpsOrigin("PK_WEBAPP_URL", env.PK_WEBAPP_URL);
    requireHttpsOrigin("PK_CUSTOMISER_URL", env.PK_CUSTOMISER_URL);
    requireHttpsOrigin("PK_API_URL", env.PK_API_URL);
    requireBase64Key("PK_ADMIN_MFA_ENCRYPTION_KEY", env.PK_ADMIN_MFA_ENCRYPTION_KEY);
    requireStrongSecret("PK_ADMIN_RECOVERY_CODE_PEPPER", env.PK_ADMIN_RECOVERY_CODE_PEPPER);
    requireBase64Key("PK_CONNECTOR_SECRET_ENCRYPTION_KEY", env.PK_CONNECTOR_SECRET_ENCRYPTION_KEY);
    requireStrongSecret("PK_EMBED_TOKEN_SECRET", env.PK_EMBED_TOKEN_SECRET);
    requireStrongSecret("PK_OBJECT_URL_SECRET", env.PK_OBJECT_URL_SECRET);
    requireDistinctSecrets(env, [
      "PK_ADMIN_MFA_ENCRYPTION_KEY",
      "PK_ADMIN_RECOVERY_CODE_PEPPER",
      "PK_CONNECTOR_SECRET_ENCRYPTION_KEY",
      "PK_EMBED_TOKEN_SECRET",
      "PK_OBJECT_URL_SECRET"
    ]);
  }
  return { mode } as const;
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
  const root = required("OBJECT_STORAGE_ROOT", env.OBJECT_STORAGE_ROOT);
  if (!isAbsolute(root)) throw new Error("OBJECT_STORAGE_ROOT must be an absolute path in production");
  const maximumBytes = Number(required("OBJECT_STORAGE_MAX_BYTES", env.OBJECT_STORAGE_MAX_BYTES));
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1024 || maximumBytes > 1024 * 1024 * 1024) {
    throw new Error("OBJECT_STORAGE_MAX_BYTES must be an integer between 1024 and 1073741824");
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

function requireDistinctSecrets(env: Record<string, string | undefined>, names: string[]) {
  const values = names.map((name) => required(name, env[name]));
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
