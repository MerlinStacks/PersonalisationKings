import { prisma } from "@personalise-kings/db";
import { ProductMappingManager } from "../../components/product-mapping-manager";
import { safeQuery } from "../../lib/data";
import { requirePermission } from "../../lib/rbac";

export default async function ProductMappingsPage() {
  const access = await requirePermission("manage_store");
  if (access.error) {
    return <main className="page-shell"><p className="error-box">Your role cannot manage product mappings.</p></main>;
  }

  const mappings = await safeQuery(() => prisma.productMapping.findMany({
    where: { merchantId: access.session.merchantId },
    orderBy: { createdAt: "desc" },
    include: { store: true, design: true },
    take: 100
  }), []);
  const stores = await safeQuery(() => prisma.store.findMany({
    where: { merchantId: access.session.merchantId, connectionStatus: { not: "revoked" } },
    orderBy: { createdAt: "desc" }
  }), []);
  const designs = await safeQuery(() => prisma.design.findMany({
    where: { merchantId: access.session.merchantId, archivedAt: null, currentVersionId: { not: null } },
    orderBy: { name: "asc" },
    include: { currentVersion: { select: { version: true } } }
  }), []);

  return (
    <main className="page-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">Commerce links</p>
          <h1>Product Mappings</h1>
          <p>Mappings connect external WooCommerce products and variants to PersonaliseKings designs without managing commerce data in the webapp.</p>
        </div>
      </header>
      <ProductMappingManager
        mappings={mappings.map((mapping) => ({
          id: mapping.id,
          storeUrl: mapping.store.url,
          externalProductId: mapping.externalProductId,
          externalVariantId: mapping.externalVariantId,
          designId: mapping.designId,
          priceModifierMinor: mapping.priceModifierMinor,
          active: mapping.active
        }))}
        stores={stores.map((store) => ({ id: store.id, url: store.url, status: store.connectionStatus }))}
        designs={designs.map((design) => ({
          id: design.id,
          name: design.name,
          version: design.currentVersion?.version ?? 0
        }))}
      />
    </main>
  );
}
