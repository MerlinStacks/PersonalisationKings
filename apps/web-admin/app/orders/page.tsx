import { prisma } from "@personalise-kings/db";
import { ResourceTable } from "../../components/resource-table";
import { safeQuery } from "../../lib/data";
import { formatDate } from "../../lib/format";
import { getAdminSession } from "../../lib/session";

export default async function OrdersPage() {
  const session = await getAdminSession();
  const orders = await safeQuery(() => prisma.externalOrder.findMany({
    where: { merchantId: session.merchantId },
    orderBy: { createdAt: "desc" },
    include: { store: true, _count: { select: { lineItems: true, printJobs: true } } },
    take: 50
  }), []);

  return (
    <main className="page-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">Production intake</p>
          <h1>Orders</h1>
          <p>Signed WooCommerce lifecycle events update orders here. Older events remain in the inbox but cannot overwrite a newer paid, cancelled, or refunded watermark.</p>
        </div>
      </header>
      <ResourceTable
        items={orders}
        empty="No orders have been synced yet."
        columns={[
          { header: "Order", render: (order) => order.externalOrderNumber ?? order.externalOrderId },
          { header: "Store", render: (order) => order.store.url },
          { header: "Status", render: (order) => <span className="status-pill">{order.status}</span> },
          { header: "Last Event", render: (order) => order.lastEventType ?? "Legacy sync" },
          { header: "Items", render: (order) => order._count.lineItems },
          { header: "Print Jobs", render: (order) => order._count.printJobs },
          { header: "Last Sync", render: (order) => formatDate(order.lastEventAt ?? order.createdAt) }
        ]}
      />
    </main>
  );
}
