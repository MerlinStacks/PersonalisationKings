import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createObjectStorageFromEnv, isObjectKey, isObjectKeyForTenant, LocalObjectStorage, objectKey, S3ObjectStorage, type ObjectKey } from "./index";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
  vi.unstubAllEnvs();
});

describe("object keys", () => {
  it("creates a valid object key", () => {
    expect(objectKey("temporary_upload", "merchant-1", "asset_1.png")).toBe("temporary_upload/merchant-1/asset_1.png");
  });

  it.each([
    "",
    "/temporary_upload/merchant/id",
    "temporary_upload//id",
    "temporary_upload/merchant/",
    "temporary_upload/merchant/../outside",
    "temporary_upload/merchant/./id",
    "temporary_upload/merchant/folder/id",
    "temporary_upload/merchant\\outside/id",
    "temporary_upload/merchant/id with spaces",
    "unknown/merchant/id"
  ])("rejects invalid key %j", (key) => {
    expect(isObjectKey(key)).toBe(false);
  });

  it("rejects invalid objectKey segments", () => {
    expect(() => objectKey("temporary_upload", "../merchant", "id")).toThrow(TypeError);
    expect(() => objectKey("temporary_upload", "merchant/another", "id")).toThrow(TypeError);
    expect(() => objectKey("temporary_upload", "merchant", "folder/id")).toThrow(TypeError);
    expect(() => objectKey("temporary_upload", "merchant", "")).toThrow(TypeError);
  });

  it("checks tenant ownership and optional storage classes", () => {
    const key = objectKey("production_artifact", "merchant-1", "artifact-1");
    expect(isObjectKeyForTenant(key, "merchant-1")).toBe(true);
    expect(isObjectKeyForTenant(key, "merchant-2")).toBe(false);
    expect(isObjectKeyForTenant(key, "merchant-1", ["production_artifact"])).toBe(true);
    expect(isObjectKeyForTenant(key, "merchant-1", ["temporary_upload"])).toBe(false);
  });
});

describe("LocalObjectStorage", () => {
  it("rejects invalid keys in every storage method", async () => {
    const storage = await createStorage();
    const invalidKey = "temporary_upload/merchant/../../outside" as ObjectKey;

    await expect(storage.putObject(invalidKey, new Uint8Array([1]), "application/octet-stream")).rejects.toThrow(TypeError);
    await expect(storage.getObject(invalidKey)).rejects.toThrow(TypeError);
    await expect(storage.deleteObject(invalidKey)).rejects.toThrow(TypeError);
    await expect(storage.createSignedGetUrl(invalidKey, 60)).rejects.toThrow(TypeError);
    await expect(storage.createSignedPutUrl(invalidKey, 60)).rejects.toThrow(TypeError);
  });

  it("validates a put key before reading its stream", async () => {
    const storage = await createStorage();
    const invalidKey = "temporary_upload/merchant/../../outside" as ObjectKey;
    let streamStarted = false;
    const stream = new ReadableStream<Uint8Array>({
      pull() {
        streamStarted = true;
      }
    }, { highWaterMark: 0 });

    await expect(storage.putObject(invalidKey, stream, "application/octet-stream")).rejects.toThrow(TypeError);
    expect(streamStarted).toBe(false);
  });

  it("bounds Uint8Array and stream writes", async () => {
    const storage = await createStorage(3);
    const key = objectKey("temporary_upload", "merchant", "asset");
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
        controller.enqueue(new Uint8Array([3, 4]));
      }
    });

    await expect(storage.putObject(key, new Uint8Array(4), "application/octet-stream")).rejects.toThrow(RangeError);
    await expect(storage.putObject(key, stream, "application/octet-stream")).rejects.toThrow(RangeError);
  });

  it("stores and retrieves an object under its root", async () => {
    const storage = await createStorage();
    const key = objectKey("temporary_upload", "merchant", "asset");

    await storage.putObject(key, new Uint8Array([1, 2, 3]), "application/octet-stream");

    await expect(storage.getObject(key)).resolves.toEqual(new Uint8Array([1, 2, 3]));
  });

  it("fails closed without an object URL secret in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PK_OBJECT_URL_SECRET", "");
    const storage = await createStorage();
    await expect(storage.createSignedGetUrl(objectKey("temporary_upload", "merchant", "asset"), 60)).rejects.toThrow("must be configured");
  });

  it("bounds reads of objects already present on disk", async () => {
    const { directory, storage } = await createStorageWithDirectory(3);
    const key = objectKey("temporary_upload", "merchant", "asset");
    const objectDirectory = join(directory, "temporary_upload", "merchant");
    await mkdir(objectDirectory, { recursive: true });
    await writeFile(join(objectDirectory, "asset"), new Uint8Array([1, 2, 3, 4]));

    await expect(storage.getObject(key)).rejects.toThrow(RangeError);
  });

  it("checks local storage readiness", async () => {
    const { directory, storage } = await createStorageWithDirectory();
    await rm(directory, { recursive: true });
    await expect(storage.checkHealth()).resolves.toBeUndefined();
  });
});

describe("S3ObjectStorage", () => {
  it("puts, gets, deletes, and checks the configured bucket", async () => {
    const commands: Array<{ constructor: { name: string }; input?: unknown }> = [];
    const responses: unknown[] = [
      {},
      { ContentLength: 3, Body: chunks(new Uint8Array([1, 2]), new Uint8Array([3])) },
      {},
      {}
    ];
    const storage = new S3ObjectStorage({
      async send(command: object) {
        commands.push(command as { constructor: { name: string }; input?: unknown });
        return responses.shift();
      }
    }, "production-bucket", "https://api.example.com", 10);
    const key = objectKey("production_artifact", "merchant-1", "artifact-1");

    await expect(storage.putObject(key, new Uint8Array([1, 2, 3]), "image/png")).resolves.toEqual({
      objectKey: key,
      checksumSha256: "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
      byteSize: 3,
      contentType: "image/png"
    });
    await expect(storage.getObject(key)).resolves.toEqual(new Uint8Array([1, 2, 3]));
    await storage.deleteObject(key);
    await storage.checkHealth();

    expect(commands.map((command) => command.constructor.name)).toEqual([
      "PutObjectCommand",
      "GetObjectCommand",
      "DeleteObjectCommand",
      "HeadBucketCommand"
    ]);
    expect(commands[0]?.input).toMatchObject({
      Bucket: "production-bucket",
      Key: key,
      ContentType: "image/png",
      ContentLength: 3,
      Metadata: { "pk-sha256": "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81" }
    });
  });

  it("bounds remote writes and streamed reads", async () => {
    let destroyed = false;
    const oversizedBody = Object.assign(chunks(new Uint8Array([1, 2]), new Uint8Array([3, 4])), {
      destroy() { destroyed = true; }
    });
    const storage = new S3ObjectStorage({
      async send() { return { Body: oversizedBody }; }
    }, "production-bucket", "https://api.example.com", 3);
    const key = objectKey("temporary_upload", "merchant", "asset");

    await expect(storage.putObject(key, new Uint8Array(4), "application/octet-stream")).rejects.toThrow(RangeError);
    await expect(storage.getObject(key)).rejects.toThrow(RangeError);
    expect(destroyed).toBe(true);
  });

  it("refuses invalid signed URL expiry without calling S3", async () => {
    const storage = new S3ObjectStorage({ async send() { throw new Error("unexpected"); } }, "production-bucket", "https://api.example.com");
    const key = objectKey("temporary_upload", "merchant", "asset");
    await expect(storage.createSignedGetUrl(key, 0)).rejects.toThrow(RangeError);
    await expect(storage.createSignedPutUrl(key, 86_401)).rejects.toThrow(RangeError);
  });
});

describe("storage backend selection", () => {
  it("selects S3 explicitly and rejects unknown backends", () => {
    vi.stubEnv("OBJECT_STORAGE_BACKEND", "s3");
    vi.stubEnv("OBJECT_STORAGE_S3_BUCKET", "production-bucket");
    vi.stubEnv("OBJECT_STORAGE_S3_REGION", "eu-west-2");
    expect(createObjectStorageFromEnv()).toBeInstanceOf(S3ObjectStorage);
    vi.stubEnv("OBJECT_STORAGE_BACKEND", "unknown");
    expect(() => createObjectStorageFromEnv()).toThrow(/local or s3/);
  });
});

async function createStorage(maximumObjectBytes?: number) {
  return (await createStorageWithDirectory(maximumObjectBytes)).storage;
}

async function createStorageWithDirectory(maximumObjectBytes?: number) {
  const directory = await mkdtemp(join(tmpdir(), "personalise-kings-storage-"));
  temporaryDirectories.push(directory);
  return {
    directory,
    storage: new LocalObjectStorage(directory, "http://localhost:3002", maximumObjectBytes)
  };
}

async function* chunks(...values: Uint8Array[]) {
  for (const value of values) yield value;
}
