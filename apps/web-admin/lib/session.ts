import { generateSessionToken, hashSessionToken, type StaffRole } from "@personalise-kings/auth";
import { prisma } from "@personalise-kings/db";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const DEV_MERCHANT_ID = "seed-merchant";
export const ADMIN_SESSION_COOKIE = "pk_admin_session";
const authenticatedLifetimeSeconds = 8 * 60 * 60;
const pendingLifetimeSeconds = 10 * 60;

export interface AdminSession {
  sessionId: string;
  userId: string;
  merchantId: string;
  role: StaffRole;
  email: string;
  expiresAt: number;
}

export async function getAdminSession(): Promise<AdminSession> {
  const session = await getOptionalAdminSession();
  if (session) return session;

  if (process.env.NODE_ENV !== "production" && process.env.PK_ALLOW_DEV_SESSION === "true") {
    const user = await prisma.staffUser.findUnique({ where: { id: "seed-owner" } });
    if (user) return {
      sessionId: "development-bypass",
      userId: user.id,
      merchantId: user.merchantId,
      role: user.role,
      email: user.email,
      expiresAt: Math.floor(Date.now() / 1000) + 60 * 60
    };
  }
  redirect("/login");
}

export async function getOptionalAdminSession(): Promise<AdminSession | null> {
  const record = await sessionRecordFromCookie();
  if (!record || !record.mfaVerifiedAt || !record.staffUser.mfaEnabled || !record.staffUser.totpSecretEncrypted) return null;
  if (record.lastSeenAt < new Date(Date.now() - 5 * 60_000)) {
    void prisma.adminSession.updateMany({ where: { id: record.id, revokedAt: null }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
  }
  return {
    sessionId: record.id,
    userId: record.staffUser.id,
    merchantId: record.staffUser.merchantId,
    role: record.staffUser.role,
    email: record.staffUser.email,
    expiresAt: Math.floor(record.expiresAt.getTime() / 1000)
  };
}

export async function getPendingAdminSession() {
  const record = await sessionRecordFromCookie();
  return record && !record.mfaVerifiedAt ? record : null;
}

export async function createPendingAdminSession(user: { id: string }, request: Request) {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + pendingLifetimeSeconds * 1000);
  const record = await prisma.adminSession.create({
    data: {
      staffUserId: user.id,
      tokenHash: hashSessionToken(token),
      expiresAt,
      userAgent: (request.headers.get("user-agent") ?? "Unknown device").slice(0, 300)
    }
  });
  await setOpaqueSessionCookie(token, expiresAt);
  return record;
}

export async function completeAdminSession(sessionId: string) {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + authenticatedLifetimeSeconds * 1000);
  const updated = await prisma.adminSession.updateMany({
    where: { id: sessionId, revokedAt: null, expiresAt: { gt: new Date() }, mfaVerifiedAt: null },
    data: {
      tokenHash: hashSessionToken(token),
      mfaVerifiedAt: new Date(),
      pendingTotpSecretEncrypted: null,
      pendingTotpExpiresAt: null,
      expiresAt,
      lastSeenAt: new Date()
    }
  });
  if (updated.count !== 1) throw new Error("Pending admin session is no longer valid");
  await setOpaqueSessionCookie(token, expiresAt);
}

export async function revokeCurrentAdminSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;
  if (!token) return;
  await prisma.adminSession.updateMany({
    where: { tokenHash: hashSessionToken(token), revokedAt: null },
    data: { revokedAt: new Date() }
  });
}

export async function clearAdminSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(ADMIN_SESSION_COOKIE);
}

export async function setOpaqueSessionCookie(token: string, expiresAt: Date) {
  const cookieStore = await cookies();
  cookieStore.set(ADMIN_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000))
  });
}

async function sessionRecordFromCookie() {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  return prisma.adminSession.findFirst({
    where: { tokenHash: hashSessionToken(token), revokedAt: null, expiresAt: { gt: new Date() } },
    include: { staffUser: true }
  });
}
