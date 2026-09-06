import type { Metadata } from "next";
import "./globals.css";

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
        <main className="shell">{children}</main>
      </body>
    </html>
  );
}
