import { roleCan } from "@personalise-kings/auth";
import { prisma } from "@personalise-kings/db";
import { OperationalAlertManager } from "../../components/operational-alert-manager";
import { ResourceTable } from "../../components/resource-table";
import { formatDate } from "../../lib/format";
import { requirePermission } from "../../lib/rbac";

export default async function OperationsPage() {
  const access = await requirePermission("view_operations");
  if (access.error) return <main className="page-shell"><p className="error-box">Your role cannot view operational health.</p></main>;
  const [alerts, checks, deliveryCounts] = await Promise.all([
    prisma.operationalAlert.findMany({
      where: { merchantId: access.session.merchantId },
      orderBy: [{ status: "asc" }, { severity: "desc" }, { lastObservedAt: "desc" }],
      select: { id: true, rule: true, severity: true, status: true, summary: true, occurrences: true, lastObservedAt: true },
      take: 100
    }),
    prisma.operationalCheckRun.findMany({
      where: { merchantId: access.session.merchantId },
      orderBy: { completedAt: "desc" },
      take: 25
    }),
    prisma.operationalAlertDelivery.groupBy({
      by: ["status"],
      where: { alert: { merchantId: access.session.merchantId } },
      _count: { _all: true }
    })
  ]);

  return (
    <main className="page-shell">
      <header className="page-header"><div><p className="eyebrow">Operational health</p><h1>Operations</h1><p>Durable cleanup checks and deduplicated alerts remain visible after worker logs rotate.</p></div></header>
      <OperationalAlertManager alerts={alerts} canAcknowledge={roleCan(access.session.role, "acknowledge_operational_alert")} />
      <section className="metric-grid" aria-label="Alert delivery status">
        {deliveryCounts.map((item) => <span key={item.status}><strong>{item._count._all}</strong> {item.status} webhook deliveries</span>)}
      </section>
      <ResourceTable
        items={checks}
        empty="No operational checks have completed yet."
        columns={[
          { header: "Check", render: (check) => check.checkType },
          { header: "Status", render: (check) => <span className="status-pill">{check.status}</span> },
          { header: "Completed", render: (check) => formatDate(check.completedAt) },
          { header: "Correlation", render: (check) => check.correlationId }
        ]}
      />
    </main>
  );
}
