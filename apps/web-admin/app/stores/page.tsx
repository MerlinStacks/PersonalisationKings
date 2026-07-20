import { roleCan } from "@personalise-kings/auth";
import { prisma } from "@personalise-kings/db";
import { StoreConnectionManager } from "../../components/store-connection-manager";
import { safeQuery } from "../../lib/data";
import { getAdminSession } from "../../lib/session";

export default async function StoresPage({ searchParams }: Readonly<{
  searchParams: Promise<{ connection?: string | string[] }>;
}>) {
  const session = await getAdminSession();
  const query = await searchParams;
  const stores = await safeQuery(() => prisma.store.findMany({
    where: { merchantId: session.merchantId },
    orderBy: { createdAt: "desc" },
    include: {
      credential: { select: { source: true, permissions: true, updatedAt: true } },
      _count: { select: { productMappings: true, orders: true } }
    }
  }), []);
  const connection = typeof query.connection === "string" ? query.connection : undefined;
  const notice = connectionNotice(connection);

  return (
    <main className="page-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">Commerce connectors</p>
          <h1>Stores</h1>
          <p>Approve read-only WooCommerce access, monitor credential health, and revoke each store independently. Shopify remains a future connector.</p>
        </div>
      </header>
      <StoreConnectionManager
        canManage={roleCan(session.role, "manage_store")}
        notice={notice?.message}
        noticeIsError={notice?.isError}
        stores={stores.map((store) => ({
          id: store.id,
          url: store.url,
          type: store.type,
          status: store.connectionStatus,
          hasCredential: Boolean(store.credential),
          credentialSource: store.credential?.source ?? null,
          credentialPermissions: store.credential?.permissions ?? null,
          credentialUpdatedAt: store.credential?.updatedAt.toISOString() ?? null,
          lastCheckedAt: store.connectionLastCheckedAt?.toISOString() ?? null,
          lastSuccessfulAt: store.connectionLastSuccessfulAt?.toISOString() ?? null,
          lastFailedAt: store.connectionLastFailedAt?.toISOString() ?? null,
          lastError: store.connectionLastError,
          mappings: store._count.productMappings,
          orders: store._count.orders,
          createdAt: store.createdAt.toISOString()
        }))}
      />
    </main>
  );
}

function connectionNotice(connection?: string) {
  if (connection === "connected") return { message: "WooCommerce approved access and the encrypted credentials were saved.", isError: false };
  if (connection === "approved") return { message: "WooCommerce approved access. The connection will update when its separate credential callback arrives.", isError: false };
  if (connection === "denied") return { message: "WooCommerce access was not approved. No credentials were saved.", isError: true };
  if (connection === "invalid") return { message: "The WooCommerce authorization return could not be matched to this session.", isError: true };
  return undefined;
}
