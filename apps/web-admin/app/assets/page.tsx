import { prisma } from "@personalise-kings/db";
import { ResourceTable } from "../../components/resource-table";
import { safeQuery } from "../../lib/data";
import { formatDate } from "../../lib/format";
import { getAdminSession } from "../../lib/session";

export default async function AssetsPage() {
  const session = await getAdminSession();
  const assets = await safeQuery(() => prisma.asset.findMany({
    where: { merchantId: session.merchantId },
    orderBy: { createdAt: "desc" },
    include: { versions: { orderBy: { version: "desc" }, take: 1 } },
    take: 50
  }), []);

  return (
    <main className="page-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">Object storage</p>
          <h1>Assets</h1>
          <p>Fonts, clipart, uploads, previews, and production artifacts are tracked through immutable asset versions.</p>
        </div>
      </header>
      <ResourceTable
        items={assets}
        empty="No assets have been uploaded yet."
        columns={[
          { header: "Name", render: (asset) => asset.name },
          { header: "Kind", render: (asset) => asset.kind },
          { header: "Latest Status", render: (asset) => <span className="status-pill">{asset.versions[0]?.validationStatus ?? "none"}</span> },
          { header: "Object Key", render: (asset) => asset.versions[0]?.objectKey ?? "None" },
          { header: "Created", render: (asset) => formatDate(asset.createdAt) }
        ]}
      />
    </main>
  );
}
