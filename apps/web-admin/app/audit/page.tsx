import { prisma } from "@personalise-kings/db";
import { ResourceTable } from "../../components/resource-table";
import { safeQuery } from "../../lib/data";
import { formatDate } from "../../lib/format";
import { requirePermission } from "../../lib/rbac";

export default async function AuditPage() {
  const access = await requirePermission("view_audit");
  if (access.error) return <main className="page-shell"><p className="error-box">Your role cannot view audit events.</p></main>;
  const session = access.session;
  const events = await safeQuery(() => prisma.auditEvent.findMany({
    where: { merchantId: session.merchantId },
    orderBy: { createdAt: "desc" },
    take: 100
  }), []);

  return (
    <main className="page-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">Security trail</p>
          <h1>Audit</h1>
          <p>Privileged actions, authentication events, downloads, regeneration, deletion, and connection changes should be recorded here.</p>
        </div>
      </header>
      <ResourceTable
        items={events}
        empty="No audit events have been recorded yet."
        columns={[
          { header: "Action", render: (event) => event.action },
          { header: "Target", render: (event) => `${event.targetType} ${event.targetId}` },
          { header: "Actor", render: (event) => event.actorUserId ?? "System" },
          { header: "Created", render: (event) => formatDate(event.createdAt) }
        ]}
      />
    </main>
  );
}
