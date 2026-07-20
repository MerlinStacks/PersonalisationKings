import { prisma } from "@personalise-kings/db";
import { DesignBuilder } from "../../components/design-builder";
import { ResourceTable } from "../../components/resource-table";
import { safeQuery } from "../../lib/data";
import { formatDate } from "../../lib/format";
import { getAdminSession } from "../../lib/session";

export default async function DesignsPage() {
  const session = await getAdminSession();
  const designs = await safeQuery(() => prisma.design.findMany({
    where: { merchantId: session.merchantId, archivedAt: null },
    orderBy: { updatedAt: "desc" },
    include: {
      currentVersion: true,
      _count: { select: { versions: true, mappings: true, customisations: true } }
    }
  }), []);
  const assetVersions = await safeQuery(() => prisma.assetVersion.findMany({
    where: {
      merchantId: session.merchantId,
      validationStatus: "accepted",
      deletedAt: null,
      asset: { kind: { in: ["font", "artwork", "clipart", "upload", "mockup"] } }
    },
    include: { asset: { select: { name: true, kind: true } } },
    orderBy: { createdAt: "desc" }
  }), []);

  return (
    <main className="page-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">Templates</p>
          <h1>Designs</h1>
          <p>Designs are mutable working templates. Paid orders will reference immutable design versions and artwork snapshots.</p>
        </div>
      </header>
      <DesignBuilder
        designs={designs.map((design) => ({
          id: design.id,
          name: design.name,
          currentVersion: design.currentVersion ? {
            version: design.currentVersion.version,
            sceneGraph: design.currentVersion.sceneGraph,
            customiserConfig: design.currentVersion.customiserConfig
          } : null
        }))}
        fonts={assetVersions.filter((version) => version.asset.kind === "font").map((version) => ({
          id: version.id,
          name: version.asset.name,
          kind: version.asset.kind,
          contentType: version.contentType
        }))}
        images={assetVersions.filter((version) => version.asset.kind !== "font" && ["image/png", "image/jpeg", "image/webp"].includes(version.contentType)).map((version) => ({
          id: version.id,
          name: version.asset.name,
          kind: version.asset.kind,
          contentType: version.contentType
        }))}
      />
      <ResourceTable
        items={designs}
        empty="No designs yet. Create a design after the Phase 0 output profile has been verified."
        columns={[
          { header: "Name", render: (design) => design.name },
          { header: "Versions", render: (design) => design._count.versions },
          { header: "Mappings", render: (design) => design._count.mappings },
          { header: "Customisations", render: (design) => design._count.customisations },
          { header: "Updated", render: (design) => formatDate(design.updatedAt) }
        ]}
      />
    </main>
  );
}
