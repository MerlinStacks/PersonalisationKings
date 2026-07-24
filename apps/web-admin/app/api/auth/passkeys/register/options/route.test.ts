import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createChallenge: vi.fn(),
  deleteChallenges: vi.fn(),
  findPasskeys: vi.fn(),
  generateOptions: vi.fn(),
  getSession: vi.fn(),
  requireSameOrigin: vi.fn(),
  transaction: vi.fn()
}));

vi.mock("@personalise-kings/db", () => ({
  prisma: {
    staffPasskey: { findMany: mocks.findPasskeys },
    adminWebAuthnChallenge: { create: mocks.createChallenge, deleteMany: mocks.deleteChallenges },
    $transaction: mocks.transaction
  }
}));
vi.mock("@simplewebauthn/server", () => ({ generateRegistrationOptions: mocks.generateOptions }));
vi.mock("../../../../../../lib/session", () => ({ getAdminSession: mocks.getSession }));
vi.mock("../../../../../../lib/same-origin", () => ({ requireSameOrigin: mocks.requireSameOrigin }));

import { POST } from "./route";

describe("passkey registration options", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSameOrigin.mockReturnValue(null);
    mocks.getSession.mockResolvedValue({ merchantId: "merchant-1", userId: "user-1", email: "owner@example.com" });
    mocks.findPasskeys.mockResolvedValue([]);
    mocks.generateOptions.mockResolvedValue({ challenge: "generated_challenge" });
    mocks.deleteChallenges.mockReturnValue(Promise.resolve({ count: 0 }));
    mocks.createChallenge.mockImplementation(({ data }) => Promise.resolve(data));
    mocks.transaction.mockResolvedValue([]);
  });

  it("stops before session and database access when the origin is invalid", async () => {
    mocks.requireSameOrigin.mockReturnValue(Response.json({ error: "forbidden" }, { status: 403 }));
    const response = await POST(new Request("https://admin.example.com/api/auth/passkeys/register/options", { method: "POST" }));
    expect(response.status).toBe(403);
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.findPasskeys).not.toHaveBeenCalled();
  });

  it("binds a single-use registration challenge to the authenticated tenant and user", async () => {
    const response = await POST(new Request("https://admin.example.com/api/auth/passkeys/register/options", { method: "POST" }));
    expect(response.status).toBe(200);
    expect(mocks.createChallenge).toHaveBeenCalledWith({
      data: expect.objectContaining({
        merchantId: "merchant-1",
        staffUserId: "user-1",
        ceremony: "registration",
        challenge: "generated_challenge"
      })
    });
    expect(mocks.transaction).toHaveBeenCalledOnce();
  });
});
