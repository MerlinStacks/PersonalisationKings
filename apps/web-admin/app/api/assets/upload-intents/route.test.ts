import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const auditCreate = vi.fn();
  const assetCreate = vi.fn();
  const transaction = vi.fn(async (operation: (tx: unknown) => unknown) => operation({
    asset: { create: assetCreate },
    auditEvent: { create: auditCreate }
  }));
  return {
    assetCreate,
    auditCreate,
    transaction,
    createSignedPutUrl: vi.fn(),
    requirePermission: vi.fn(),
    requireSameOrigin: vi.fn()
  };
});

vi.mock("@personalise-kings/db", () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock("@personalise-kings/storage", () => ({
  createObjectStorageFromEnv: () => ({ createSignedPutUrl: mocks.createSignedPutUrl }),
  objectStorageMaximumBytesFromEnv: () => 50 * 1024 * 1024,
  objectKey: (_storageClass: string, merchantId: string, id: string) => `temporary_upload/${merchantId}/${id}`
}));
vi.mock("../../../../lib/rbac", () => ({ requirePermission: mocks.requirePermission }));
vi.mock("../../../../lib/same-origin", () => ({ requireSameOrigin: mocks.requireSameOrigin }));

import { POST } from "./route";

describe("asset upload-intent auditing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSameOrigin.mockReturnValue(null);
    mocks.requirePermission.mockResolvedValue({
      session: { merchantId: "merchant-1", userId: "user-1", role: "designer" },
      error: null
    });
    mocks.createSignedPutUrl.mockResolvedValue("https://objects.example/signed-put");
    mocks.assetCreate.mockResolvedValue({ id: "asset-1", versions: [{ id: "version-1" }] });
    mocks.auditCreate.mockResolvedValue({ id: "audit-1" });
  });

  it("creates the capability record and actor-bound audit in one transaction", async () => {
    const response = await POST(new Request("https://admin.example/api/assets/upload-intents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "artwork", name: "Logo", contentType: "image/png", byteSize: 1024 })
    }));

    expect(response.status).toBe(201);
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        merchantId: "merchant-1",
        actorUserId: "user-1",
        action: "asset.upload_intent_create",
        targetType: "AssetVersion",
        targetId: "version-1"
      })
    });
  });

  it("rejects non-raster content for image asset kinds", async () => {
    const response = await POST(new Request("https://admin.example/api/assets/upload-intents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "artwork", name: "Unsafe", contentType: "image/svg+xml", byteSize: 1024 })
    }));

    expect(response.status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
