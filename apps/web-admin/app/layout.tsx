import type { Metadata } from "next";
import { AdminShell } from "../components/admin-shell";
import "./globals.css";

export const metadata: Metadata = {
  title: "PersonaliseKings Admin",
  description: "Merchant admin for PersonaliseKings personalisation workflows"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body><AdminShell>{children}</AdminShell></body>
    </html>
  );
}
