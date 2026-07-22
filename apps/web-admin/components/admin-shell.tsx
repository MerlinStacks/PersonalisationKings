import { ROLE_LABELS, roleCan, type Permission } from "@personalise-kings/auth";
import Link from "next/link";
import { getOptionalAdminSession } from "../lib/session";

const navItems: ReadonlyArray<readonly [string, string, Permission?]> = [
  ["Dashboard", "/"],
  ["Stores", "/stores", "manage_store"],
  ["Designs", "/designs", "manage_design"],
  ["Profiles", "/output-profiles", "manage_design"],
  ["Mappings", "/product-mappings", "manage_store"],
  ["Assets", "/assets", "manage_design"],
  ["Orders", "/orders", "view_order"],
  ["Print Jobs", "/print-jobs", "view_order"],
  ["Artifacts", "/artifacts", "download_artifact"],
  ["Operations", "/operations", "view_operations"],
  ["Staff", "/staff", "manage_staff"],
  ["Deletion", "/deletion-requests", "delete_asset"],
  ["Audit", "/audit", "view_audit"],
  ["Settings", "/settings"]
];

export async function AdminShell({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await getOptionalAdminSession();

  return (
    <div className="admin-frame">
      <aside className="sidebar" aria-label="Admin navigation">
        <Link href="/" className="brand">PersonaliseKings</Link>
        {session ? (
          <>
            <p className="session-pill">{ROLE_LABELS[session.role]}</p>
            <nav>
              {navItems.filter(([, , permission]) => !permission || roleCan(session.role, permission)).map(([label, href]) => (
                <Link key={href} href={href}>{label}</Link>
              ))}
            </nav>
            <form action="/api/auth/logout" method="post">
              <button className="logout-button" type="submit">Log out</button>
            </form>
          </>
        ) : (
          <nav><Link href="/login">Log in</Link></nav>
        )}
      </aside>
      <div className="content-frame">{children}</div>
    </div>
  );
}
