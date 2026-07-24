import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { access, constants, mkdir, open, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
export { isProductionArtifactKey } from "./artifact";

export { sanitizeRasterUpload, type MediaSanitizationResult } from "./media-validation";

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
  checkHealth(): Promise<void>;
}

export function objectKey(storageClass: StorageClass, tenantId: string, id: string): ObjectKey {
  if (!safeObjectKeySegment.test(tenantId) || !safeObjectKeySegment.test(id)) {
    throw new TypeError("Object key tenant and ID must each be one safe segment");
  }
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

  async checkHealth() {
    await mkdir(this.rootPath, { recursive: true });
    await access(this.rootPath, constants.R_OK | constants.W_OK);
  }

  private localSignedUrl(method: "GET" | "PUT", key: ObjectKey, expiresInSeconds: number) {
    return apiSignedObjectUrl(method, key, expiresInSeconds, this.publicBaseUrl);
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

interface S3ClientLike {
  send(command: object): Promise<unknown>;
}

export class S3ObjectStorage implements ObjectStorage {
  constructor(
    private readonly client: S3ClientLike,
    private readonly bucket: string,
    private readonly publicBaseUrl: string,
    private readonly maximumObjectBytes = defaultMaximumObjectBytes
  ) {
    if (!bucket.trim()) throw new TypeError("S3 bucket must not be empty");
    if (!Number.isSafeInteger(maximumObjectBytes) || maximumObjectBytes <= 0) {
      throw new TypeError("Maximum object size must be a positive safe integer");
    }
  }

  async putObject(key: ObjectKey, body: ReadableStream | Uint8Array, contentType: string): Promise<StoredObjectMetadata> {
    assertObjectKey(key);
    const bytes = body instanceof Uint8Array ? body : await streamToBytes(body, this.maximumObjectBytes);
    if (bytes.byteLength > this.maximumObjectBytes) throw new RangeError(`Object exceeds maximum size of ${this.maximumObjectBytes} bytes`);
    const checksumSha256 = createHash("sha256").update(bytes).digest("hex");
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: bytes,
      ContentType: contentType,
      ContentLength: bytes.byteLength,
      Metadata: { "pk-sha256": checksumSha256 }
    }));
    return { objectKey: key, checksumSha256, byteSize: bytes.byteLength, contentType };
  }

  async getObject(key: ObjectKey) {
    assertObjectKey(key);
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key })) as {
      Body?: unknown;
      ContentLength?: number;
    };
    if (response.ContentLength !== undefined && response.ContentLength > this.maximumObjectBytes) {
      destroyBody(response.Body);
      throw new RangeError(`Object exceeds maximum size of ${this.maximumObjectBytes} bytes`);
    }
    return readS3BodyBounded(response.Body, this.maximumObjectBytes);
  }

  async deleteObject(key: ObjectKey) {
    assertObjectKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async createSignedGetUrl(key: ObjectKey, expiresInSeconds: number) {
    return apiSignedObjectUrl("GET", key, expiresInSeconds, this.publicBaseUrl);
  }

  async createSignedPutUrl(key: ObjectKey, expiresInSeconds: number) {
    return apiSignedObjectUrl("PUT", key, expiresInSeconds, this.publicBaseUrl);
  }

  async checkHealth() {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }
}

let cachedS3: { signature: string; storage: S3ObjectStorage } | null = null;

export function createObjectStorageFromEnv() {
  const maximumObjectBytes = objectStorageMaximumBytesFromEnv();
  const publicBaseUrl = process.env.PK_API_URL ?? "http://localhost:3002";
  const backend = process.env.OBJECT_STORAGE_BACKEND ?? "local";
  if (backend === "local") {
    return new LocalObjectStorage(process.env.OBJECT_STORAGE_ROOT ?? "./storage", publicBaseUrl, maximumObjectBytes);
  }
  if (backend !== "s3") throw new Error("OBJECT_STORAGE_BACKEND must be local or s3");
  const bucket = process.env.OBJECT_STORAGE_S3_BUCKET?.trim();
  const region = process.env.OBJECT_STORAGE_S3_REGION?.trim();
  if (!bucket || !region) throw new Error("S3 object storage requires a bucket and region");
  const endpoint = process.env.OBJECT_STORAGE_S3_ENDPOINT?.trim() || undefined;
  const forcePathStyle = process.env.OBJECT_STORAGE_S3_FORCE_PATH_STYLE === "true";
  const signature = JSON.stringify({ bucket, region, endpoint, forcePathStyle, publicBaseUrl, maximumObjectBytes });
  if (cachedS3?.signature === signature) return cachedS3.storage;
  const client = new S3Client({ region, endpoint, forcePathStyle }) as unknown as S3ClientLike;
  const storage = new S3ObjectStorage(client, bucket, publicBaseUrl, maximumObjectBytes);
  cachedS3 = { signature, storage };
  return storage;
}

export function objectStorageMaximumBytesFromEnv() {
  const configured = Number(process.env.OBJECT_STORAGE_MAX_BYTES ?? defaultMaximumObjectBytes);
  return Number.isSafeInteger(configured) && configured > 0 ? configured : defaultMaximumObjectBytes;
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
  return segments.length === 3
    && storageClasses.has(segments[0] ?? "")
    && segments.every((segment) => safeObjectKeySegment.test(segment) && segment !== "." && segment !== "..");
}

export function isObjectKeyForTenant(value: string, tenantId: string, allowedClasses?: readonly StorageClass[]): value is ObjectKey {
  if (!safeObjectKeySegment.test(tenantId) || !isObjectKey(value)) return false;
  const [storageClass, keyTenant] = value.split("/", 3);
  return keyTenant === tenantId && (!allowedClasses || allowedClasses.includes(storageClass as StorageClass));
}

function assertObjectKey(value: string): asserts value is ObjectKey {
  if (!isObjectKey(value)) throw new TypeError("Invalid object key");
}

function signLocalObjectUrl(method: "GET" | "PUT", key: ObjectKey, expiresAt: number, secret: string) {
  return createHmac("sha256", secret).update(`${method}\n${key}\n${expiresAt}`).digest("base64url");
}

function apiSignedObjectUrl(method: "GET" | "PUT", key: ObjectKey, expiresInSeconds: number, publicBaseUrl: string) {
  assertObjectKey(key);
  if (!Number.isSafeInteger(expiresInSeconds) || expiresInSeconds < 1 || expiresInSeconds > 24 * 60 * 60) {
    throw new RangeError("Signed object URL expiry must be between 1 and 86400 seconds");
  }
  const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const url = new URL(`/objects/${key}`, publicBaseUrl);
  url.searchParams.set("method", method);
  url.searchParams.set("expires", String(expiresAt));
  url.searchParams.set("signature", signLocalObjectUrl(method, key, expiresAt, localObjectSigningSecret()));
  return url.toString();
}

function localObjectSigningSecret() {
  const configured = process.env.PK_OBJECT_URL_SECRET;
  if (configured) return configured;
  if (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test") return "dev-object-url-secret-change-me";
  throw new Error("PK_OBJECT_URL_SECRET must be configured outside development and tests");
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

async function readS3BodyBounded(body: unknown, maximumBytes: number) {
  if (!body || typeof body !== "object" || !(Symbol.asyncIterator in body)) throw new Error("S3 object response did not contain a readable body");
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for await (const rawChunk of body as AsyncIterable<unknown>) {
      const chunk = rawChunk instanceof Uint8Array ? rawChunk : typeof rawChunk === "string" ? Buffer.from(rawChunk) : null;
      if (!chunk) throw new TypeError("S3 object stream contained an unsupported chunk");
      total += chunk.byteLength;
      if (total > maximumBytes) throw new RangeError(`Object exceeds maximum size of ${maximumBytes} bytes`);
      chunks.push(chunk);
    }
  } catch (error) {
    destroyBody(body);
    throw error;
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

function destroyBody(body: unknown) {
  if (body && typeof body === "object" && "destroy" in body && typeof body.destroy === "function") body.destroy();
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
