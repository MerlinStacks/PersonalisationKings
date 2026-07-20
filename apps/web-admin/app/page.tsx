import { ROLE_LABELS } from "@personalise-kings/auth";
import { getDashboardCounts } from "../lib/data";
import { getAdminSession } from "../lib/session";

const foundationItems = [
  "Merchant account and staff roles",
  "Platform-neutral store connections",
  "Design versions and one print area for MVP",
  "Webhook inbox and durable outbox",
  "Object storage with cleanup and erasure records",
  "Audit events for privileged actions"
];

export default async function HomePage() {
  const session = await getAdminSession();
  const counts = await getDashboardCounts(session.merchantId);

  return (
    <main className="shell">
      <section className="hero" aria-labelledby="page-title">
        <p className="eyebrow">Phase 1 foundation</p>
        <h1 id="page-title">Personalisation operations, outside WooCommerce.</h1>
        <p className="lede">
          This admin app will become the source of truth for designs, customer customisations,
          order artwork snapshots, print jobs, and production files.
        </p>
        <div className="actions" aria-label="Primary setup actions">
          <a href="/stores" className="button primary">Connect WooCommerce</a>
          <a href="/designs" className="button secondary">Create design</a>
        </div>
      </section>

      <section className="grid" aria-label="Foundation status">
        <article className="card">
          <h2>Live Records</h2>
          <div className="metric-grid">
            <span><strong>{counts.stores}</strong> stores</span>
            <span><strong>{counts.designs}</strong> designs</span>
            <span><strong>{counts.orders}</strong> orders</span>
            <span><strong>{counts.printJobs}</strong> print jobs</span>
          </div>
        </article>
        <article className="card accent">
          <h2>Build Scope</h2>
          <ul>
            {foundationItems.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>
        <article className="card">
          <h2>MVP Roles</h2>
          <div className="role-list">
            {Object.entries(ROLE_LABELS).map(([role, label]) => (
              <span key={role}>{label}</span>
            ))}
          </div>
        </article>
        <article className="card warning">
          <h2>Phase 0 Gate</h2>
          <p>
            Production PDF export should wait until the target printer, RIP version, plate names,
            mask policies, and dimensional tolerances are verified with real fixtures.
          </p>
        </article>
      </section>
    </main>
  );
}
