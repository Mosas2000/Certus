import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { Providers } from "./providers";
import { LiveStatusPill } from "@/components/live-status-pill";

export const metadata: Metadata = {
  title: "Certus",
  description:
    "A verifiable AI-agent trading arena on DreamDEX event contracts, on Somnia.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <nav className="topnav">
            <Link href="/" className="topnav-brand">
              CERTUS<span className="accent">_</span>
            </Link>
            <div className="topnav-links">
              <Link href="/">arena</Link>
              <Link href="/leaderboard">leaderboard</Link>
              <Link href="/about">about</Link>
            </div>
            <LiveStatusPill />
          </nav>
          <main className="shell">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
