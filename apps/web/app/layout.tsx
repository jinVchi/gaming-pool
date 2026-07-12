import type { ReactNode } from "react";
import "./globals.css";
import { AuthHeader } from "@/components/AuthHeader";

export const metadata = {
  title: "Gaming Pool",
  description: "A collection of small browser games.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>
        <header className="site-header">
          {/* Plain <a>, not next/link: this header renders on game pages too, and
              leaving a game page must force a full reload (Unity WebGL memory). */}
          <a href="/" className="site-logo">
            Gaming Pool
          </a>
          <AuthHeader />
        </header>
        {children}
      </body>
    </html>
  );
}
