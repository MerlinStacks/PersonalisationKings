import { signAdminSession, verifyAdminSession, type AdminSessionPayload } from "@personalise-kings/auth";
import { prisma } from "@personalise-kings/db";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const DEV_MERCHANT_ID = "seed-merchant";
export const ADMIN_SESSION_COOKIE = "pk_admin_session";

export type AdminSession = AdminSessionPayload;

export async function getAdminSession(): Promise<AdminSession> {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;
  const secret = adminSessionSecret();

  if (token) {
    const session = verifySession(token, secret);
    if (session) {
      const current = await reloadSession(session);
      if (current) return current;
    }
  }

  if (process.env.PK_ALLOW_DEV_SESSION === "true") {
    const current = await reloadSession({
      merchantId: DEV_MERCHANT_ID,
      userId: "seed-owner",
      role: "owner_admin",
      expiresAt: Math.floor(Date.now() / 1000) + 60 * 60
    });
    if (current) return current;
  }

  redirect("/login");
}

export async function getOptionalAdminSession(): Promise<AdminSession | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;
  const session = token ? verifySession(token, adminSessionSecret()) : null;
  return session ? reloadSession(session) : null;
}

export async function setAdminSessionCookie(session: AdminSession) {
  const cookieStore = await cookies();
  cookieStore.set(ADMIN_SESSION_COOKIE, signAdminSession(session, adminSessionSecret()), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.max(0, session.expiresAt - Math.floor(Date.now() / 1000))
  });
}

export async function clearAdminSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(ADMIN_SESSION_COOKIE);
}

function adminSessionSecret() {
  const secret = process.env.PK_ADMIN_SESSION_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("PK_ADMIN_SESSION_SECRET is required in production");
  }
  return "dev-admin-session-secret-change-me";
}

function verifySession(token: string, secret: string) {
  try {
    return verifyAdminSession(token, secret);
  } catch {
    return null;
  }
}

async function reloadSession(session: AdminSessionPayload): Promise<AdminSession | null> {
  const user = await prisma.staffUser.findUnique({
    where: { id: session.userId },
    select: { id: true, merchantId: true, role: true }
  });
  if (!user) return null;

  return {
    userId: user.id,
    merchantId: user.merchantId,
    role: user.role,
    expiresAt: session.expiresAt
  };
}
