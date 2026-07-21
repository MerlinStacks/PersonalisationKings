import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, open, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

export { validateRasterUpload, type MediaValidationResult } from "./media-validation";

const storageClasses = new Set<string>([
  "temporary_upload",
  "draft_customisation_asset",
  "order_bound_customer_asset",
  "merchant_design_asset",
  "preview_derivative",
  "production_artifact",
  "quarantined_file"
]);
const safeObjectKeySegment = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const defaultMaximumObjectBytes = 50 * 1024 * 1024;

export type StorageClass =
  | "temporary_upload"
  | "draft_customisation_asset"
  | "order_bound_customer_asset"
  | "merchant_design_asset"
  | "preview_derivative"
  | "production_artifact"
  | "quarantined_file";

export type ObjectKey = `${StorageClass}/${string}`;

export interface StoredObjectMetadata {
  objectKey: ObjectKey;
  checksumSha256: string;
  byteSize: number;
  contentType: string;
}

export interface ObjectStorage {
  putObject(key: ObjectKey, body: ReadableStream | Uint8Array, contentType: string): Promise<StoredObjectMetadata>;
  getObject(key: ObjectKey): Promise<Uint8Array>;
  deleteObject(key: ObjectKey): Promise<void>;
  createSignedGetUrl(key: ObjectKey, expiresInSeconds: number): Promise<string>;
  createSignedPutUrl(key: ObjectKey, expiresInSeconds: number): Promise<string>;
}

export function objectKey(storageClass: StorageClass, tenantId: string, id: string): ObjectKey {
  const key = `${storageClass}/${tenantId}/${id}`;
  assertObjectKey(key);
  return key;
}

export class LocalObjectStorage implements ObjectStorage {
  private readonly rootPath: string;

  constructor(
    rootDirectory: string,
    private readonly publicBaseUrl = "file://local-storage",
    private readonly maximumObjectBytes = defaultMaximumObjectBytes
  ) {
    if (!rootDirectory.trim()) throw new TypeError("Storage root directory must not be empty");
    if (!Number.isSafeInteger(maximumObjectBytes) || maximumObjectBytes <= 0) {
      throw new TypeError("Maximum object size must be a positive safe integer");
    }
    this.rootPath = resolve(rootDirectory);
  }

  async putObject(key: ObjectKey, body: ReadableStream | Uint8Array, contentType: string): Promise<StoredObjectMetadata> {
    const filePath = this.filePathForKey(key);
    const bytes = body instanceof Uint8Array ? body : await streamToBytes(body, this.maximumObjectBytes);
    if (bytes.byteLength > this.maximumObjectBytes) {
      throw new RangeError(`Object exceeds maximum size of ${this.maximumObjectBytes} bytes`);
    }

    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, bytes);

    return {
      objectKey: key,
      checksumSha256: createHash("sha256").update(bytes).digest("hex"),
      byteSize: bytes.byteLength,
      contentType
    };
  }

  async getObject(key: ObjectKey): Promise<Uint8Array> {
    return readFileBounded(this.filePathForKey(key), this.maximumObjectBytes);
  }

  async deleteObject(key: ObjectKey): Promise<void> {
    await rm(this.filePathForKey(key), { force: true });
  }

  async createSignedGetUrl(key: ObjectKey, expiresInSeconds: number): Promise<string> {
    return this.localSignedUrl("GET", key, expiresInSeconds);
  }

  async createSignedPutUrl(key: ObjectKey, expiresInSeconds: number): Promise<string> {
    return this.localSignedUrl("PUT", key, expiresInSeconds);
  }

  private localSignedUrl(method: "GET" | "PUT", key: ObjectKey, expiresInSeconds: number) {
    assertObjectKey(key);
    const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;
    const url = new URL(`/objects/${key}`, this.publicBaseUrl);
    url.searchParams.set("method", method);
    url.searchParams.set("expires", String(expiresAt));
    url.searchParams.set("signature", signLocalObjectUrl(method, key, expiresAt, localObjectSigningSecret()));
    return url.toString();
  }

  private filePathForKey(key: ObjectKey) {
    assertObjectKey(key);
    const filePath = resolve(this.rootPath, ...key.split("/"));
    const pathFromRoot = relative(this.rootPath, filePath);
    if (!pathFromRoot || pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot)) {
      throw new TypeError("Object key resolves outside the storage root");
    }
    return filePath;
  }
}

export function createObjectStorageFromEnv() {
  const configuredMaximum = Number(process.env.OBJECT_STORAGE_MAX_BYTES ?? defaultMaximumObjectBytes);
  const maximumObjectBytes = Number.isSafeInteger(configuredMaximum) && configuredMaximum > 0
    ? configuredMaximum
    : defaultMaximumObjectBytes;
  return new LocalObjectStorage(
    process.env.OBJECT_STORAGE_ROOT ?? "./storage",
    process.env.PK_API_URL ?? "http://localhost:3002",
    maximumObjectBytes
  );
}

export function verifyLocalObjectUrl(method: "GET" | "PUT", key: ObjectKey, expiresAt: number, signature: string) {
  if (!isObjectKey(key)) return false;
  const now = Math.floor(Date.now() / 1000);
  if (expiresAt < now || expiresAt > now + 24 * 60 * 60) {
    return false;
  }

  const expected = signLocalObjectUrl(method, key, expiresAt, localObjectSigningSecret());
  if (expected.length !== signature.length) {
    return false;
  }

  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

export function isObjectKey(value: string): value is ObjectKey {
  if (!value || value.includes("\\") || isAbsolute(value)) return false;
  const segments = value.split("/");
  return segments.length >= 3
    && storageClasses.has(segments[0] ?? "")
    && segments.every((segment) => safeObjectKeySegment.test(segment) && segment !== "." && segment !== "..");
}

function assertObjectKey(value: string): asserts value is ObjectKey {
  if (!isObjectKey(value)) throw new TypeError("Invalid object key");
}

function signLocalObjectUrl(method: "GET" | "PUT", key: ObjectKey, expiresAt: number, secret: string) {
  return createHmac("sha256", secret).update(`${method}\n${key}\n${expiresAt}`).digest("base64url");
}

function localObjectSigningSecret() {
  const configured = process.env.PK_OBJECT_URL_SECRET;
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") throw new Error("PK_OBJECT_URL_SECRET must be configured in production");
  return "dev-object-url-secret-change-me";
}

async function streamToBytes(stream: ReadableStream, maximumBytes: number) {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new TypeError("Object stream must contain Uint8Array chunks");
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel("Object exceeds maximum size");
        throw new RangeError(`Object exceeds maximum size of ${maximumBytes} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return merged;
}

async function readFileBounded(filePath: string, maximumBytes: number) {
  const file = await open(filePath, "r");
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const bytesToRead = Math.min(64 * 1024, maximumBytes - total + 1);
      const buffer = new Uint8Array(bytesToRead);
      const { bytesRead } = await file.read(buffer, 0, bytesToRead, null);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > maximumBytes) {
        throw new RangeError(`Object exceeds maximum size of ${maximumBytes} bytes`);
      }
      chunks.push(buffer.subarray(0, bytesRead));
    }
  } finally {
    await file.close();
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}
