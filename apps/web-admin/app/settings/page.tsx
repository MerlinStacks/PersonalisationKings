import { prisma } from "@personalise-kings/db";
import { safeQuery } from "../../lib/data";
import { getAdminSession } from "../../lib/session";
import { SecuritySettings } from "../../components/security-settings";

export default async function SettingsPage() {
  const session = await getAdminSession();
  const settings = await safeQuery(() => prisma.merchantSettings.upsert({
    where: { merchantId: session.merchantId },
    update: {},
    create: { merchantId: session.merchantId }
  }), null);
  const [staff, sessions, recoveryCodesRemaining, passkeys] = await Promise.all([
    prisma.staffUser.findUnique({ where: { id: session.userId }, select: { mfaEnabledAt: true } }),
    prisma.adminSession.findMany({
      where: { staffUserId: session.userId, revokedAt: null, expiresAt: { gt: new Date() }, mfaVerifiedAt: { not: null } },
      orderBy: { lastSeenAt: "desc" },
      select: { id: true, createdAt: true, lastSeenAt: true, expiresAt: true, userAgent: true }
    }),
    prisma.staffRecoveryCode.count({ where: { staffUserId: session.userId, usedAt: null } }),
    prisma.staffPasskey.findMany({
      where: { merchantId: session.merchantId, staffUserId: session.userId },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, deviceType: true, backedUp: true, createdAt: true, lastUsedAt: true }
    })
  ]);

  return (
    <main className="page-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">Account controls</p>
          <h1>Settings</h1>
          <p>Output profiles, cleanup retention, staff security, and privacy erasure controls will be managed here.</p>
        </div>
      </header>
      <section className="grid">
        <SecuritySettings
          currentSessionId={session.sessionId}
          sessions={sessions.map((item) => ({ ...item, createdAt: item.createdAt.toISOString(), lastSeenAt: item.lastSeenAt.toISOString(), expiresAt: item.expiresAt.toISOString() }))}
          passkeys={passkeys.map((item) => ({ ...item, createdAt: item.createdAt.toISOString(), lastUsedAt: item.lastUsedAt?.toISOString() ?? null }))}
          recoveryCodesRemaining={recoveryCodesRemaining}
          mfaEnabledAt={staff?.mfaEnabledAt?.toISOString() ?? null}
        />
        <article className="card accent">
          <h2>Default UV Profile</h2>
          <p>White spot: RDG_WHITE</p>
          <p>Gloss spot: RDG_Gloss</p>
          <p>These remain unverified until Phase 0 printer/RIP acceptance tests pass.</p>
        </article>
        <article className="card">
          <h2>Cleanup Options</h2>
          <p>Default retention choices: 15, 30, 60, and 90 days.</p>
          <p>Temporary uploads: {settings?.temporaryUploadRetentionDays ?? 15} days</p>
          <p>Previews: {settings?.previewRetentionDays ?? 30} days</p>
          <p>Production artifacts: {settings?.productionArtifactRetentionDays ?? 90} days</p>
          <p>Eligible unordered customer uploads can be erased from live storage through Deletion Requests. Ordered artwork remains blocked until a legal and operational retention policy is configured.</p>
        </article>
      </section>
    </main>
  );
}
