import { prisma } from "@personalise-kings/db";
import { ResourceTable } from "../../components/resource-table";
import { safeQuery } from "../../lib/data";
import { formatDate } from "../../lib/format";
import { requirePermission } from "../../lib/rbac";

export default async function ArtifactsPage() {
  const access = await requirePermission("download_artifact");
  if (access.error) {
    return <main className="page-shell"><p className="error-box">Your role cannot download production artifacts.</p></main>;
  }

  const artifacts = await safeQuery(() => prisma.generatedArtifact.findMany({
    where: { merchantId: access.session.merchantId },
    orderBy: { createdAt: "desc" },
    include: {
      printJobAttempt: { include: { printJob: { include: { order: true } } } },
      outputProfileVersion: true
    },
    take: 100
  }), []);

  return (
    <main className="page-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">Production files</p>
          <h1>Artifacts</h1>
          <p>Generated files are immutable records with checksums, preflight status, output profile version, and audited download access.</p>
        </div>
      </header>
      <ResourceTable
        items={artifacts}
        empty="No generated artifacts exist yet. Production export remains gated by Phase 0 printer/RIP validation."
        columns={[
          { header: "Order", render: (artifact) => artifact.printJobAttempt.printJob.order.externalOrderNumber ?? artifact.printJobAttempt.printJob.order.externalOrderId },
          { header: "Type", render: (artifact) => artifact.artifactType },
          { header: "Preflight", render: (artifact) => <span className="status-pill">{artifact.preflightStatus}</span> },
          { header: "Output Profile", render: (artifact) => `v${artifact.outputProfileVersion.version}` },
          { header: "Checksum", render: (artifact) => artifact.checksumSha256.slice(0, 16) },
          { header: "Created", render: (artifact) => formatDate(artifact.createdAt) }
        ]}
      />
    </main>
  );
}
