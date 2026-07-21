import { prisma } from "@personalise-kings/db";
import { ResourceTable } from "../../components/resource-table";
import { safeQuery } from "../../lib/data";
import { formatDate } from "../../lib/format";
import { requirePermission } from "../../lib/rbac";
import { DeletionRequestManager } from "../../components/deletion-request-manager";

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
          <p>Customer upload requests are checked automatically. Ordered or design-bound artwork is blocked for policy review; eligible live files and derivatives are removed before backup purge is confirmed separately.</p>
        </div>
      </header>
      <DeletionRequestManager requests={requests.map((request) => ({ id: request.id, status: request.status }))} />
      <ResourceTable
        items={requests}
        empty="No deletion requests have been created yet."
        columns={[
          { header: "Subject", render: (request) => `${request.subjectType} ${request.subjectId}` },
          { header: "Status", render: (request) => <span className="status-pill">{request.status}</span> },
          { header: "Live Deleted", render: (request) => request.liveDeletedAt ? formatDate(request.liveDeletedAt) : "Not yet" },
          { header: "Eligibility / Error", render: (request) => request.eligibilityReason ?? request.lastError ?? "Pending analysis" },
          { header: "Attempts", render: (request) => request.attempts },
          { header: "Backup Note", render: (request) => request.backupExpiryNote ?? "None" },
          { header: "Completed", render: (request) => request.completedAt ? formatDate(request.completedAt) : "Awaiting backup confirmation" },
          { header: "Created", render: (request) => formatDate(request.createdAt) }
        ]}
      />
    </main>
  );
}
