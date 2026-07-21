import { ROLE_LABELS } from "@personalise-kings/auth";
import { prisma } from "@personalise-kings/db";
import { ResourceTable } from "../../components/resource-table";
import { safeQuery } from "../../lib/data";
import { formatDate } from "../../lib/format";
import { requirePermission } from "../../lib/rbac";

export default async function StaffPage() {
  const access = await requirePermission("manage_staff");
  if (access.error) {
    return (
      <main className="page-shell">
        <p className="error-box">Your role cannot manage staff.</p>
      </main>
    );
  }

  const users = await safeQuery(() => prisma.staffUser.findMany({
    where: { merchantId: access.session.merchantId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      email: true,
      role: true,
      mfaEnabled: true,
      createdAt: true,
      updatedAt: true
    }
  }), []);

  return (
    <main className="page-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">Access control</p>
          <h1>Staff</h1>
          <p>Staff enroll mandatory authenticator MFA on first login and receive one-time recovery codes. Role changes revoke active sessions; passkeys and verified forgotten-password recovery remain future work.</p>
        </div>
      </header>
      <ResourceTable
        items={users}
        empty="No staff users exist yet."
        columns={[
          { header: "Email", render: (user) => user.email },
          { header: "Role", render: (user) => ROLE_LABELS[user.role] },
          { header: "MFA", render: (user) => <span className="status-pill">{user.mfaEnabled ? "Enabled" : "Not enabled"}</span> },
          { header: "Created", render: (user) => formatDate(user.createdAt) },
          { header: "Updated", render: (user) => formatDate(user.updatedAt) }
        ]}
      />
    </main>
  );
}
