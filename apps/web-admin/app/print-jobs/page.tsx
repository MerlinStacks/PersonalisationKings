import { prisma } from "@personalise-kings/db";
import { ResourceTable } from "../../components/resource-table";
import { safeQuery } from "../../lib/data";
import { formatDate } from "../../lib/format";
import { getAdminSession } from "../../lib/session";

export default async function PrintJobsPage() {
  const session = await getAdminSession();
  const printJobs = await safeQuery(() => prisma.printJob.findMany({
    where: { merchantId: session.merchantId },
    orderBy: { createdAt: "desc" },
    include: { order: true, attempts: true },
    take: 50
  }), []);

  return (
    <main className="page-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">UV production</p>
          <h1>Print Jobs</h1>
          <p>Failed and lifecycle-affected jobs are surfaced in-app. Queued work can cancel automatically, while refunds or cancellations after production starts require operator review.</p>
        </div>
      </header>
      <ResourceTable
        items={printJobs}
        empty="No print jobs have been queued yet."
        columns={[
          { header: "Order", render: (job) => job.order.externalOrderNumber ?? job.order.externalOrderId },
          { header: "Status", render: (job) => <span className="status-pill">{job.status}</span> },
          { header: "Retries", render: (job) => job.retryCount },
          { header: "Attempts", render: (job) => job.attempts.length },
          { header: "Last Error", render: (job) => job.lastError ?? "None" },
          { header: "Created", render: (job) => formatDate(job.createdAt) }
        ]}
      />
    </main>
  );
}
