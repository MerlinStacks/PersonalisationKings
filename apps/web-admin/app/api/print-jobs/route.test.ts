import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findOrder: vi.fn(),
  findSnapshot: vi.fn(),
  transaction: vi.fn(),
  requirePermission: vi.fn(),
  requireSameOrigin: vi.fn(),
  writeAuditEvent: vi.fn()
}));

vi.mock("@personalise-kings/db", () => ({
  prisma: {
    externalOrder: { findFirst: mocks.findOrder },
    orderArtworkSnapshot: { findFirst: mocks.findSnapshot },
    $transaction: mocks.transaction
  }
}));
vi.mock("../../../lib/audit", () => ({ writeAuditEvent: mocks.writeAuditEvent }));
vi.mock("../../../lib/rbac", () => ({ requirePermission: mocks.requirePermission }));
vi.mock("../../../lib/same-origin", () => ({ requireSameOrigin: mocks.requireSameOrigin }));

import { POST } from "./route";

describe("manual print-job creation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSameOrigin.mockReturnValue(null);
    mocks.requirePermission.mockResolvedValue({
      session: { merchantId: "merchant-1", userId: "user-1" },
      error: null
    });
    mocks.findOrder.mockResolvedValue({ id: "order-1" });
  });

  it("requires the artwork snapshot to belong to the selected tenant and order", async () => {
    mocks.findSnapshot.mockResolvedValue(null);

    const response = await POST(new Request("https://admin.example/api/print-jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orderId: "order-1", artworkSnapshotId: "snapshot-1" })
    }));

    expect(response.status).toBe(400);
    expect(mocks.findSnapshot).toHaveBeenCalledWith({
      where: {
        id: "snapshot-1",
        merchantId: "merchant-1",
        customisationRevision: { lineItems: { some: { orderId: "order-1" } } }
      }
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.writeAuditEvent).not.toHaveBeenCalled();
  });
});
