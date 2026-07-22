import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  getObject: vi.fn(),
  requirePermission: vi.fn(),
  requireSameOrigin: vi.fn()
}));

vi.mock("@personalise-kings/db", () => ({
  prisma: { assetVersion: { findFirst: mocks.findFirst } }
}));
vi.mock("@personalise-kings/storage", () => ({
  createObjectStorageFromEnv: () => ({ getObject: mocks.getObject }),
  objectKey: vi.fn(),
  validateRasterUpload: vi.fn()
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
});
