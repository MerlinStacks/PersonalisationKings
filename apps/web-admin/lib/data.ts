import { prisma } from "@personalise-kings/db";

export async function safeQuery<T>(query: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await query();
  } catch {
    return fallback;
  }
}

export async function getDashboardCounts(merchantId: string) {
  return safeQuery(async () => {
    const [stores, designs, orders, printJobs, failedPrintJobs] = await Promise.all([
      prisma.store.count({ where: { merchantId } }),
      prisma.design.count({ where: { merchantId, archivedAt: null } }),
      prisma.externalOrder.count({ where: { merchantId } }),
      prisma.printJob.count({ where: { merchantId } }),
      prisma.printJob.count({ where: { merchantId, status: { in: ["failed", "needs_review"] } } })
    ]);

    return { stores, designs, orders, printJobs, failedPrintJobs };
  }, { stores: 0, designs: 0, orders: 0, printJobs: 0, failedPrintJobs: 0 });
}
