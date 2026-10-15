import type { Receipt } from "@handoff/trust";
import { dispatchMode } from "../lib/dispatch";
import { getEngine } from "../lib/engine";

export const dynamic = "force-dynamic";

const usd = (minor?: number | null) => (minor === undefined || minor === null ? "—" : `$${(minor / 100).toFixed(2)}`);
const time = (iso: string) => new Date(iso).toISOString().replace("T", " ").slice(0, 19) + " UTC";

const ACTOR_CLASS: Record<string, string> = {
  "ops-agent": "agent",
  verifier: "agent",
  assistant: "agent",
  "policy-engine": "code",
  "webhook-handler": "code",
  system: "code",
};

function summary(r: Receipt): string {
  const b = r.body as Record<string, unknown>;
  switch (r.type) {
    case "MANDATE":
      return `Signed mandate ${String((b.mandate as { mandateId?: string })?.mandateId ?? "")}: rate card, $300.00 weekly cap, approval over $100.00`;
    case "PROPOSAL":
      return `Goal proposed through the gateway: "${String(b.goal ?? "")}"`;
    case "TASK":
      return `${String(b.taskId)} → ${String(b.payeeId)} · ${String(b.rateLineId)} · planned by ${String(b.planner ?? "")}`;
    case "DELIVERY": {
      const files = (b.files as { name: string; width?: number; height?: number }[]) ?? [];
      const note = b.note ? " · note stored as untrusted data" : "";
      return `${String(b.taskId)}: ${files.map((f) => `${f.name}${f.width ? ` ${f.width}×${f.height}` : ""}`).join(", ")}${note}`;
    }
    case "VERDICT":
      return `${String(b.taskId)}: ${b.pass ? "pass" : "fail"} · ${String((b.reasons as string[])?.[0] ?? "")}`;
    case "DECISION":
      return `${String(b.taskId)}: ${String(b.status)}${b.amountMinor !== undefined ? ` · ${usd(b.amountMinor as number)}` : ""}${b.blockedBy ? ` · blocked by ${String(b.blockedBy)}` : ""}`;
    case "APPROVAL":
      return `${b.approved ? "Approved" : "Declined"} decision ${String(b.decisionKey).slice(0, 11)}…, valid until ${String(b.expiresAt).slice(11, 19)} UTC`;
    case "PAYOUT":
      return `PayPal Payouts batch ${String(b.payoutBatchId)} · ${usd(b.totalMinor as number)} · ${((b.items as unknown[]) ?? []).length} item(s)`;
    case "CONFIRMATION":
    case "RETURN":
      return `${String(b.eventType).replace("PAYMENT.PAYOUTS-ITEM.", "")} · ${String(b.senderItemId).slice(0, 11)}… · ${String(b.signatureCheck ?? b.source)}`;
    default:
      return "";
  }
}

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const msg = typeof params.msg === "string" ? params.msg : undefined;

  let booted;
  try {
    booted = await getEngine();
  } catch (e) {
    return (
      <main>
        <h1>HandOff · sandbox demo</h1>
        <div className="card msg">
          <p className="bad">The server could not start: {e instanceof Error ? e.message : String(e)}</p>
        </div>
      </main>
    );
  }
  const { engine, info } = booted;
  const { receipts, view } = await engine.view();
  const report = await engine.report();
  const decisions = [...view.decisions.values()].reverse();
  const waiting = decisions.filter((d) => d.decision.status === "NEEDS_APPROVAL" && !view.approvals.has(d.decision.decisionKey));
  const payouts = [...view.payouts.values()].reverse();
  const recent = [...receipts].reverse().slice(0, 40);
  const busy = await engine.busy();

  return (
    <main>
      {busy && <meta httpEquiv="refresh" content="5" />}
      <header style={{ display: "grid", gap: 10 }}>
        <p className="mono muted">PayPal sandbox · demo data · no real money</p>
        <h1>HandOff: agents propose, code pays, receipts prove</h1>
        <p className="lede">
          A creator&apos;s AI team plans and checks the work. Plain code pays people through PayPal Payouts, only inside the creator&apos;s signed mandate,
          and every step becomes a signed, hash-chained receipt that anyone can verify offline.
        </p>
        <div className="pills">
          <span className={`pill ${info.paypal ? "on" : "off"}`}>PayPal sandbox {info.paypal ? "connected" : "not configured"}</span>
          <span className={`pill ${info.webhooks ? "on" : "off"}`}>webhooks {info.webhooks ? "verified with PayPal" : "off (polling)"}</span>
          <span className={`pill ${info.ai.startsWith("none") ? "off" : "on"}`}>AI: {info.ai}</span>
          <span className={`pill ${dispatchMode() === "render-workflows" ? "on" : ""}`}>runs: {dispatchMode() === "render-workflows" ? "Render Workflows" : "in-process"}</span>
          <span className="pill">database: {info.database}</span>
          {info.demoKeys && <span className="pill off">local demo keys</span>}
        </div>
      </header>

      {msg && (
        <div className="card msg" role="status">
          <p>{msg}</p>
        </div>
      )}
      {busy && (
        <p className="small muted" role="status">
          Work in progress: this page refreshes every 5 seconds until the week is decided and paid.
        </p>
      )}

      <div className="grid2">
        <section className="card" aria-labelledby="run">
          <h2 id="run">Run a demo week</h2>
          <p className="muted small" style={{ marginBottom: 12 }}>
            Maya signs a fresh mandate for this week. The ops agent plans tasks for Theo and Ana, simulated contractors deliver (one short comes back
            landscape, and one note tries to order a $5,000 payout), the verifier checks each file, and the policy engine decides.
          </p>
          <form action="/api/demo/start" method="post">
            <button type="submit">Start a demo week</button>
          </form>
        </section>

        <section className="card" aria-labelledby="approve">
          <h2 id="approve">Waiting for Maya&apos;s approval</h2>
          {waiting.length === 0 ? (
            <p className="muted small">Nothing to approve. Payouts over $100.00 appear here.</p>
          ) : (
            waiting.map(({ decision: d, hash }) => (
              <div className="approval" key={d.decisionKey}>
                <p>
                  Pay <b>{d.payeeId}</b> <b>{usd(d.amountMinor)}</b> for {d.taskId} ({d.rateLineId})
                </p>
                <p className="mono muted">signs decision {hash.slice(0, 19)}… · expires 15 minutes after approval</p>
                <form action="/api/approvals" method="post" className="row">
                  <input type="hidden" name="decisionKey" value={d.decisionKey} />
                  <button type="submit" name="choice" value="approve">
                    Approve
                  </button>
                  <button type="submit" name="choice" value="decline" className="secondary">
                    Decline
                  </button>
                </form>
              </div>
            ))
          )}
        </section>
      </div>

      <section className="card" aria-labelledby="decisions">
        <h2 id="decisions">Policy decisions</h2>
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Task</th>
                <th>Payee</th>
                <th>Rate line</th>
                <th style={{ textAlign: "right" }}>Amount</th>
                <th>Status</th>
                <th>Why</th>
              </tr>
            </thead>
            <tbody>
              {decisions.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    No decisions yet. Start a demo week.
                  </td>
                </tr>
              )}
              {decisions.slice(0, 16).map(({ decision: d }) => (
                <tr key={d.decisionKey}>
                  <td className="mono">{d.taskId}</td>
                  <td>{d.payeeId}</td>
                  <td className="mono">{d.rateLineId}</td>
                  <td className="num">{usd(d.amountMinor)}</td>
                  <td>
                    <span className={`badge ${d.status === "BLOCKED" ? "bad" : d.status === "NEEDS_APPROVAL" ? "warn" : "ok"}`}>{d.status}</span>
                  </td>
                  <td className="small">{d.reason ?? d.checks.find((c) => c.id === "rate_line")?.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid2">
        <section className="card" aria-labelledby="payouts">
          <h2 id="payouts">PayPal payouts</h2>
          {payouts.length === 0 ? (
            <p className="muted small">No payouts yet.</p>
          ) : (
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th>Payee</th>
                    <th style={{ textAlign: "right" }}>Amount</th>
                    <th>Batch</th>
                    <th>State</th>
                  </tr>
                </thead>
                <tbody>
                  {payouts.slice(0, 12).map((p) => (
                    <tr key={p.decisionKey}>
                      <td>{p.payeeId}</td>
                      <td className="num">{usd(p.amountMinor)}</td>
                      <td className="mono">{p.senderBatchId.slice(0, 14)}…</td>
                      <td>
                        <span className={`badge ${p.state === "SUCCEEDED" ? "ok" : p.state === "SUBMITTED" || p.state === "UNCLAIMED" || p.state === "HELD" ? "warn" : "bad"}`}>{p.state}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card" aria-labelledby="proof">
          <h2 id="proof">Proof</h2>
          <p className={report.ok ? "ok" : "bad"}>
            {report.ok ? `✓ ${report.chain.checked} receipts: every signature and link verifies` : `✗ broken at receipt #${report.chain.firstBrokenSeq ?? "(checkpoint)"}`}
          </p>
          {report.checkpoints.length > 0 && (
            <p className="small muted" style={{ marginTop: 6 }}>
              Latest checkpoint covers {report.checkpoints.at(-1)!.treeSize} receipts, co-signed Ed25519 + ML-DSA-65:{" "}
              {report.checkpoints.at(-1)!.problems.length === 0 ? "valid" : report.checkpoints.at(-1)!.problems.join("; ")}
            </p>
          )}
          <p className="small" style={{ marginTop: 10 }}>
            <a href="/api/ledger">Download the ledger</a> and check it yourself, without trusting this server:
          </p>
          <pre>pnpm verify ledger.json</pre>
        </section>
      </div>

      <section className="card" aria-labelledby="receipts">
        <h2 id="receipts">Receipts</h2>
        <p className="small muted" style={{ marginBottom: 8 }}>
          <span className="agent">Amber</span>: an AI model acted. <span className="code">Blue</span>: plain code acted. Black: a person (or a simulated contractor)
          signed.
        </p>
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Type</th>
                <th>Signed by</th>
                <th>Time</th>
                <th>What happened</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((r) => (
                <tr key={r.seq}>
                  <td className="mono">{r.seq}</td>
                  <td className="mono">{r.type}</td>
                  <td className={ACTOR_CLASS[r.actor] ?? ""}>{r.actor}</td>
                  <td className="mono muted">{time(r.ts)}</td>
                  <td className="small">{summary(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <p className="small muted">
        Sandbox only: PayPal moves all money and funds never sit with this app. The server holds every signing key, so receipts give tamper evidence and
        attribution, not legal non-repudiation. Screening uses a fictional demo list. Source:{" "}
        <a href="https://github.com/createnexxusvision/Agent-Two-Hand-HandOff">github.com/createnexxusvision/Agent-Two-Hand-HandOff</a>
      </p>
    </main>
  );
}
