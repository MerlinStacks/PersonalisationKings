import { prisma } from "@personalise-kings/db";
import { safeQuery } from "../../lib/data";
import { getAdminSession } from "../../lib/session";

export default async function SettingsPage() {
  const session = await getAdminSession();
  const settings = await safeQuery(() => prisma.merchantSettings.upsert({
    where: { merchantId: session.merchantId },
    update: {},
    create: { merchantId: session.merchantId }
  }), null);

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
          <p>Customer uploads require deletion and erasure workflows before private beta.</p>
        </article>
      </section>
    </main>
  );
}
