import { prisma } from "@personalise-kings/db";
import { ResourceTable } from "../../components/resource-table";
import { safeQuery } from "../../lib/data";
import { formatDate } from "../../lib/format";
import { requirePermission } from "../../lib/rbac";

export default async function OutputProfilesPage() {
  const access = await requirePermission("manage_design");
  if (access.error) {
    return <main className="page-shell"><p className="error-box">Your role cannot manage output profiles.</p></main>;
  }

  const profiles = await safeQuery(() => prisma.outputProfile.findMany({
    where: { merchantId: access.session.merchantId },
    orderBy: { createdAt: "desc" },
    include: { versions: { orderBy: { version: "desc" }, take: 1 } }
  }), []);

  return (
    <main className="page-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">Production setup</p>
          <h1>Output Profiles</h1>
          <p>Output profile versions are immutable production settings. Orders and generated artifacts reference the active version at order time.</p>
        </div>
      </header>
      <ResourceTable
        items={profiles}
        empty="No output profiles exist yet. Seed data creates a placeholder demo UV profile."
        columns={[
          { header: "Name", render: (profile) => profile.name },
          { header: "Version", render: (profile) => profile.versions[0]?.version ?? "None" },
          { header: "Printer/RIP", render: (profile) => {
            const version = profile.versions[0];
            return version ? `${version.printerModel} / ${version.ripName} ${version.ripVersion}` : "None";
          } },
          { header: "Size", render: (profile) => {
            const version = profile.versions[0];
            return version ? `${version.widthUm} x ${version.heightUm} um` : "None";
          } },
          { header: "Spot Names", render: (profile) => {
            const version = profile.versions[0];
            return version ? `${version.whiteSpotName}, ${version.glossSpotName}` : "None";
          } },
          { header: "Created", render: (profile) => formatDate(profile.createdAt) }
        ]}
      />
    </main>
  );
}
