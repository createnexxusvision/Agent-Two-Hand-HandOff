import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "HandOff · sandbox demo",
  description: "AI agents propose, plain code pays through PayPal Payouts (sandbox), and every step is a signed receipt.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
