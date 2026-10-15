/** One plain-language line per receipt, shared by the page and the dashboard data. */
import type { Receipt } from "@handoff/trust";

const usd = (minor?: number | null) => (minor === undefined || minor === null ? "—" : `$${(minor / 100).toFixed(2)}`);

export function describeReceipt(r: Receipt): string {
  const b = r.body as Record<string, unknown>;
  switch (r.type) {
    case "MANDATE":
      return `Signed mandate ${String((b.mandate as { mandateId?: string })?.mandateId ?? "")}: rate card, $300.00 weekly cap, approval over $100.00`;
    case "PROPOSAL":
      return b.via === "mcp"
        ? `${String(b.agent)} proposed ${String(b.quantity)} × ${String(b.rateLineId)} for ${String(b.payeeId)} through the MCP door (pending review)`
        : `Goal proposed through the gateway: "${String(b.goal ?? "")}"`;
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
