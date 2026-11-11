import type { Metadata } from "next";
import { getEngine } from "../../lib/engine";
import { LedgerClient } from "./ledger-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "HandOff · ledger",
  description: "AG Studio dashboards over HandOff's signed receipts: money against the signed cap, 1099 running totals, and the receipt chain, with a read-only AI auditor.",
};

export default async function LedgerPage() {
  const { engine, info } = await getEngine();
  const data = await engine.studioData();
  // An AG Studio licence key is meant to ship to the browser; without one Studio shows a watermark.
  const licenseKey = process.env.AG_STUDIO_LICENSE_KEY?.trim() || undefined;
  return <LedgerClient initialData={data} licenseKey={licenseKey} aiEnabled={!info.ai.startsWith("none")} />;
}
