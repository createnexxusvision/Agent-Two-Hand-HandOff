/**
 * pnpm demo:tamper
 *
 * Simulates someone with database access editing a payout: Theo's $40.00 becomes $400.00
 * in receipt #20. Run `pnpm verify .demo/ledger.json --anchors .demo/anchors` afterwards.
 */
import { readFileSync, writeFileSync } from "node:fs";
import type { LedgerFile } from "@handoff/trust";

const FILE = process.argv[2] ?? ".demo/ledger.json";
const ledger = JSON.parse(readFileSync(FILE, "utf8")) as LedgerFile;
const payout = ledger.receipts.find((r) => r.type === "PAYOUT");
if (!payout) throw new Error("no PAYOUT receipt to tamper with; run pnpm demo:ledger first");

const items = payout.body.items as { amountMinor: number }[];
const before = items[0]!.amountMinor;
items[0]!.amountMinor = before * 10;
writeFileSync(FILE, JSON.stringify(ledger, null, 2) + "\n");
console.log(`UPDATE 1 · receipt #${payout.seq} item 1: ${before} → ${items[0]!.amountMinor} cents`);
