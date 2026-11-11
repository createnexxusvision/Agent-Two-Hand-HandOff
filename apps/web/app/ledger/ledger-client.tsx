"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import type { StudioData } from "@handoff/engine";

// AG Studio is browser-only and large, so it loads after the page shell.
const LedgerStudio = dynamic(() => import("./studio/ledger-studio"), {
  ssr: false,
  loading: () => (
    <p className="studio-loading muted" role="status">
      Loading AG Studio…
    </p>
  ),
});

/** Changes only when money or the chain moved, so a refresh doesn't redraw the dashboards for nothing. */
const fingerprint = (d: StudioData) => `${d.chain.checked}:${d.chain.ok}:${d.tables.tasks.map((t) => t.stage).join()}:${d.tables.payouts.map((p) => p.state).join()}`;

type Props = { initialData: StudioData; licenseKey?: string; aiEnabled: boolean };

export function LedgerClient({ initialData, licenseKey, aiEnabled }: Props) {
  const [data, setData] = useState(initialData);

  // While a demo week runs elsewhere, new receipts show up here within 15 seconds.
  useEffect(() => {
    let current = fingerprint(initialData);
    const timer = setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const next = (await (await fetch("/api/studio/data", { cache: "no-store" })).json()) as StudioData;
        if (fingerprint(next) !== current) {
          current = fingerprint(next);
          setData(next);
        }
      } catch {
        // Offline for a moment; the next tick tries again.
      }
    }, 15_000);
    return () => clearInterval(timer);
  }, [initialData]);

  const updated = new Date(data.asOf).toISOString().slice(11, 19);
  return (
    <div className="studio-page">
      <header className="studio-top">
        <a href="/" className="studio-back">
          ← Demo
        </a>
        <div className="studio-title">
          <p className="mono muted">PayPal sandbox · demo data · AG Studio</p>
          <h1>The ledger</h1>
        </div>
        <div className="pills">
          <span className={`pill ${data.chain.ok ? "on" : "off"}`}>
            {data.chain.checked} receipts {data.chain.ok ? "verified" : `broken at #${data.chain.firstBrokenSeq}`}
          </span>
          {data.checkpoint && <span className="pill">checkpoint {data.checkpoint.treeSize} · Ed25519 + ML-DSA-65</span>}
          <span className="pill">AI: {aiEnabled ? "HandOff Auditor (read-only)" : "off"}</span>
          <span className="pill">as of {updated} UTC</span>
        </div>
      </header>
      <LedgerStudio data={data} licenseKey={licenseKey} aiEnabled={aiEnabled} />
    </div>
  );
}
