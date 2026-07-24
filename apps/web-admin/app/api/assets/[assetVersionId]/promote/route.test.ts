import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findUniqueOrThrow: vi.fn(),
  updateMany: vi.fn(),
  getObject: vi.fn(),
  putObject: vi.fn(),
  deleteObject: vi.fn(),
  sanitizeRasterUpload: vi.fn(),
  transaction: vi.fn(),
  requirePermission: vi.fn(),
  requireSameOrigin: vi.fn()
}));

vi.mock("@personalise-kings/db", () => ({
  prisma: {
    assetVersion: { findFirst: mocks.findFirst },
    $transaction: mocks.transaction
  }
}));
vi.mock("@personalise-kings/storage", () => ({
  createObjectStorageFromEnv: () => ({ getObject: mocks.getObject, putObject: mocks.putObject, deleteObject: mocks.deleteObject }),
  isObjectKeyForTenant: (key: string, tenantId: string, classes: string[]) => classes.includes(key.split("/")[0] ?? "") && key.split("/")[1] === tenantId,
  objectKey: (storageClass: string, tenantId: string, id: string) => `${storageClass}/${tenantId}/${id}`,
  sanitizeRasterUpload: mocks.sanitizeRasterUpload
}));
vi.mock("../../../../../lib/audit", () => ({ writeAuditEvent: vi.fn() }));
vi.mock("../../../../../lib/rbac", () => ({ requirePermission: mocks.requirePermission }));
vi.mock("../../../../../lib/same-origin", () => ({ requireSameOrigin: mocks.requireSameOrigin }));

import { POST } from "./route";

describe("asset promotion authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSameOrigin.mockReturnValue(null);
    mocks.requirePermission.mockResolvedValue({
      session: { merchantId: "merchant-1", userId: "user-1", role: "auditor" },
      error: Response.json({ error: "forbidden" }, { status: 403 })
    });
    mocks.transaction.mockImplementation(async (operation: (tx: unknown) => unknown) => operation({
      assetVersion: { updateMany: mocks.updateMany, findUniqueOrThrow: mocks.findUniqueOrThrow }
    }));
  });

  it("requires design-management permission before reading tenant or storage data", async () => {
    const response = await POST(
      new Request("https://admin.example/api/assets/version-1/promote", { method: "POST" }),
      { params: Promise.resolve({ assetVersionId: "version-1" }) }
    );

    expect(response.status).toBe(403);
    expect(mocks.requirePermission).toHaveBeenCalledWith("manage_design");
    expect(mocks.findFirst).not.toHaveBeenCalled();
    expect(mocks.getObject).not.toHaveBeenCalled();
  });

  it("refuses a persisted upload key outside the authenticated tenant", async () => {
    mocks.requirePermission.mockResolvedValue({
      session: { merchantId: "merchant-1", userId: "user-1", role: "owner" },
      error: null
    });
    mocks.findFirst.mockResolvedValue({
      id: "version-1",
      objectKey: "temporary_upload/merchant-2/upload-1",
      asset: { kind: "upload" }
    });

    const response = await POST(
      new Request("https://admin.example/api/assets/version-1/promote", { method: "POST" }),
      { params: Promise.resolve({ assetVersionId: "version-1" }) }
    );

    expect(response.status).toBe(400);
    expect(mocks.getObject).not.toHaveBeenCalled();
  });

  it("stores sanitized bytes and conditionally finalizes before source cleanup", async () => {
    const sourceBytes = new Uint8Array([9, 9]);
    const sanitizedBytes = new Uint8Array([1, 2, 3]);
    const promoted = { id: "version-1", byteSize: 3n };
    mocks.requirePermission.mockResolvedValue({ session: { merchantId: "merchant-1", userId: "user-1", role: "owner" }, error: null });
    mocks.findFirst.mockResolvedValue({
      id: "version-1",
      merchantId: "merchant-1",
      objectKey: "temporary_upload/merchant-1/upload-1",
      byteSize: 10n,
      contentType: "image/png",
      widthPx: null,
      heightPx: null,
      asset: { kind: "artwork" }
    });
    mocks.getObject.mockResolvedValue(sourceBytes);
    mocks.sanitizeRasterUpload.mockResolvedValue({ accepted: true, bytes: sanitizedBytes, detectedContentType: "image/png", widthPx: 4, heightPx: 3 });
    mocks.putObject.mockResolvedValue({ objectKey: "merchant_design_asset/merchant-1/destination", checksumSha256: "a".repeat(64), byteSize: 3, contentType: "image/png" });
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.findUniqueOrThrow.mockResolvedValue(promoted);
    mocks.deleteObject.mockResolvedValue(undefined);

    const response = await POST(
      new Request("https://admin.example/api/assets/version-1/promote", { method: "POST" }),
      { params: Promise.resolve({ assetVersionId: "version-1" }) }
    );

    expect(response.status).toBe(200);
    expect(mocks.putObject).toHaveBeenCalledWith(expect.stringMatching(/^merchant_design_asset\/merchant-1\/version-1-/), sanitizedBytes, "image/png");
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ objectKey: "temporary_upload/merchant-1/upload-1", validationStatus: "pending" })
    }));
    expect(mocks.updateMany.mock.invocationCallOrder[0]).toBeLessThan(mocks.deleteObject.mock.invocationCallOrder[0]);
    expect(mocks.deleteObject).toHaveBeenCalledWith("temporary_upload/merchant-1/upload-1");
  });
});
