import type { ReactNode } from "react";

export const metadata = {
  title: "Gaming Pool",
  description: "A collection of small browser games.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
