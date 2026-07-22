import { access, constants, mkdir } from "node:fs/promises";
import { prisma } from "@personalise-kings/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const storageRoot = process.env.OBJECT_STORAGE_ROOT ?? "./storage";
    await mkdir(storageRoot, { recursive: true });
    await access(storageRoot, constants.R_OK | constants.W_OK);
    return Response.json({ ok: true, service: "personalise-kings-web-admin" }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json(
      { ok: false, service: "personalise-kings-web-admin" },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }
}
