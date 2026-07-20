import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PersonaliseKings Customiser",
  description: "Hosted customer customiser embed"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
