import { prisma } from "@personalise-kings/db";
import { ResourceTable } from "../../components/resource-table";
import { safeQuery } from "../../lib/data";
import { formatDate } from "../../lib/format";
import { requirePermission } from "../../lib/rbac";

export default async function DeletionRequestsPage() {
  const access = await requirePermission("delete_asset");
  if (access.error) {
    return <main className="page-shell"><p className="error-box">Your role cannot manage deletion requests.</p></main>;
  }

  const requests = await safeQuery(() => prisma.deletionRequest.findMany({
    where: { merchantId: access.session.merchantId },
    orderBy: { createdAt: "desc" },
    take: 100
  }), []);

  return (
    <main className="page-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">Privacy operations</p>
          <h1>Deletion Requests</h1>
          <p>Deletion requests track live storage removal and backup-retention notes for privacy erasure workflows.</p>
        </div>
      </header>
      <ResourceTable
        items={requests}
        empty="No deletion requests have been created yet."
        columns={[
          { header: "Subject", render: (request) => `${request.subjectType} ${request.subjectId}` },
          { header: "Status", render: (request) => <span className="status-pill">{request.status}</span> },
          { header: "Live Deleted", render: (request) => request.liveDeletedAt ? formatDate(request.liveDeletedAt) : "Not yet" },
          { header: "Backup Note", render: (request) => request.backupExpiryNote ?? "None" },
          { header: "Created", render: (request) => formatDate(request.createdAt) }
        ]}
      />
    </main>
  );
}
