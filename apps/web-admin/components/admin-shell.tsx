import { ROLE_LABELS } from "@personalise-kings/auth";
import Link from "next/link";
import { getOptionalAdminSession } from "../lib/session";

const navItems = [
  ["Dashboard", "/"],
  ["Stores", "/stores"],
  ["Designs", "/designs"],
  ["Profiles", "/output-profiles"],
  ["Mappings", "/product-mappings"],
  ["Assets", "/assets"],
  ["Orders", "/orders"],
  ["Print Jobs", "/print-jobs"],
  ["Artifacts", "/artifacts"],
  ["Staff", "/staff"],
  ["Deletion", "/deletion-requests"],
  ["Audit", "/audit"],
  ["Settings", "/settings"]
] as const;

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
              {navItems.map(([label, href]) => (
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
