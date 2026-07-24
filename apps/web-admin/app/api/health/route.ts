import { prisma } from "@personalise-kings/db";
import { createObjectStorageFromEnv } from "@personalise-kings/storage";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    await createObjectStorageFromEnv().checkHealth();
    return Response.json({ ok: true, service: "personalise-kings-web-admin" }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json(
      { ok: false, service: "personalise-kings-web-admin" },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }
}
