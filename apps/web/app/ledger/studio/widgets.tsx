"use client";

/**
 * HandOff's own AG Studio widgets, for what the built-in charts cannot say:
 *
 * - Receipt chain: the latest receipts as linked, signed blocks, coloured by who acted (AI agent,
 *   plain code, person), with a button that re-verifies every signature and checkpoint on the
 *   server right now. Clicking a block cross-filters the page to that task's money trail.
 * - 1099 meters: each payee's PayPal-confirmed payments this year against the 1099-NEC line and
 *   the two-part 1099-K test. Clicking a payee cross-filters the page to them.
 *
 * Both read through Studio's data engine (widgetApi.getData), so page filters, cross filters and
 * the AI agents' filters apply to them like any other widget.
 */
import { useEffect, useMemo, useState } from "react";
import type { AgDefaultRegistry, AgWidgetField, AgWidgetFormParams, AgWidgetParams, AgWidgetsConfig } from "ag-studio";
import { createWidgets } from "ag-studio-react";

export type LedgerContext = {
  chain: { ok: boolean; checked: number; firstBrokenSeq: number | null };
  checkpoint: { treeSize: number; valid: boolean; signatures: string } | null;
  tax: { necThreshold: number; kThreshold: number; kPaymentsThreshold: number; year: number; note: string };
};

type Row = Record<string, unknown>;

/** Every field in the report schema by its id, e.g. "receipts.seq". */
function schemaFields(params: AgWidgetParams): Map<string, AgWidgetField> {
  const out = new Map<string, AgWidgetField>();
  for (const table of params.widgetApi.getSchema()) for (const f of table.fields) out.set(f.fieldId, f);
  return out;
}

const valueOf = (row: Row, field: AgWidgetField): unknown => row[field.key] ?? row[field.fieldId];

/** Runs a query whenever Studio hands the widget new params (filters, data or format changed). */
function useRows(params: AgWidgetParams, build: () => Parameters<AgWidgetParams["widgetApi"]["getData"]>[0] | null) {
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => {
    let live = true;
    const query = build();
    if (!query) {
      params.widgetApi.setDisplayState("incompleteDataMapping");
      return;
    }
    params.widgetApi.setDisplayState("loading", { prominent: rows === null });
    params.widgetApi
      .getData(query as never)
      .then((response) => {
        if (!live) return;
        const result = (response as { results: { rows: Row[] } }).results.rows;
        setRows(result);
        params.widgetApi.setDisplayState(result.length ? "displayed" : "noData");
      })
      .catch(() => live && params.widgetApi.setDisplayState("noData"));
    return () => {
      live = false;
    };
    // Studio passes a new params object whenever anything the widget depends on changes.
  }, [params]);
  return rows;
}

const KIND_CLASS: Record<string, string> = { "AI agent": "agent", "Plain code": "code", Person: "person" };

function ReceiptChain(params: AgWidgetParams) {
  const ctx = params.context as LedgerContext;
  const fields = useMemo(() => schemaFields(params), [params]);
  const f = (id: string) => fields.get(id);
  const limit = Number((params.format as { style?: { blocks?: number } } | undefined)?.style?.blocks ?? 14);
  const rows = useRows(params, () => {
    const need = ["receipts.seq", "receipts.type", "receipts.actorKind", "receipts.status", "receipts.hash", "receipts.summary", "receipts.taskId"].map(f);
    if (need.some((x) => !x)) return null;
    return { fields: need as AgWidgetField[], sort: [{ field: need[0]!, direction: "desc" as const }], limit: { count: limit } };
  });
  const [check, setCheck] = useState<{ state: "idle" | "running" | "done" | "error"; text?: string; ok?: boolean }>({ state: "idle" });

  const verifyNow = async () => {
    setCheck({ state: "running" });
    try {
      const r = (await (await fetch("/api/verify", { cache: "no-store" })).json()) as { ok: boolean; receiptsChecked: number; firstBrokenSeq: number | null; latestCheckpoint: { treeSize: number; valid: boolean } | null };
      const cp = r.latestCheckpoint ? ` · checkpoint ${r.latestCheckpoint.treeSize} ${r.latestCheckpoint.valid ? "valid" : "INVALID"}` : "";
      setCheck({ state: "done", ok: r.ok, text: r.ok ? `All ${r.receiptsChecked} receipts verified just now${cp}` : `Broken at receipt #${r.firstBrokenSeq}${cp}` });
    } catch {
      setCheck({ state: "error", text: "Could not reach the verifier." });
    }
  };

  const seqF = f("receipts.seq");
  const taskF = f("receipts.taskId");
  const selected = new Set(
    (params.widgetApi.getCrossFilterSelections() ?? []).flatMap((s) => (s.type === "value" ? s.values.map(String) : [])),
  );
  const ok = ctx?.chain?.ok ?? true;

  return (
    <div className="hw hw-chain">
      <div className="hw-head">
        <div>
          <p className={`hw-status ${ok ? "ok" : "bad"}`}>
            {ok ? "✓" : "✕"} {ctx?.chain?.checked ?? "?"} receipts, {ok ? "every signature and hash link verified" : `broken at #${ctx.chain.firstBrokenSeq}`}
          </p>
          <p className="hw-sub">
            {ctx?.checkpoint ? `Merkle checkpoint at ${ctx.checkpoint.treeSize}, co-signed ${ctx.checkpoint.signatures}` : "No checkpoint yet"} · Ed25519 per actor
          </p>
        </div>
        <div className="hw-actions">
          <button type="button" className="hw-btn" onClick={verifyNow} disabled={check.state === "running"}>
            {check.state === "running" ? "Verifying…" : "Verify now"}
          </button>
          <a className="hw-link" href="/api/ledger" download>
            Download ledger
          </a>
        </div>
      </div>
      {check.text && (
        <p className={`hw-check ${check.ok ? "ok" : "bad"}`} role="status">
          {check.text}
        </p>
      )}
      <ol className="hw-blocks" aria-label="Latest receipts, newest first">
        {(rows ?? []).map((row) => {
          const seq = seqF ? Number(valueOf(row, seqF)) : 0;
          const kind = String(valueOf(row, f("receipts.actorKind")!) ?? "");
          const broken = valueOf(row, f("receipts.status")!) === "Broken";
          const taskId = taskF ? (valueOf(row, taskF) as string | null) : null;
          const on = taskId !== null && selected.has(taskId);
          return (
            <li key={seq}>
              <button
                type="button"
                className={`hw-block ${KIND_CLASS[kind] ?? "code"} ${broken ? "broken" : ""} ${on ? "on" : ""}`}
                title={String(valueOf(row, f("receipts.summary")!) ?? "")}
                disabled={!taskId || !taskF}
                onClick={() => taskF && taskId && params.widgetApi.toggleCrossFilter({ type: "value", field: taskF, value: taskId, group: 0 })}
              >
                <span className="hw-seq">#{seq}</span>
                <span className="hw-type">{String(valueOf(row, f("receipts.type")!))}</span>
                <span className="hw-hash">{broken ? "✕ broken" : String(valueOf(row, f("receipts.hash")!)).slice(0, 8)}</span>
              </button>
            </li>
          );
        })}
      </ol>
      <p className="hw-legend">
        <i className="agent" /> AI agent <i className="code" /> plain code <i className="person" /> person · click a block to follow its task
      </p>
    </div>
  );
}

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n % 1 ? 2 : 0 });

function TaxMeters(params: AgWidgetParams) {
  const ctx = params.context as LedgerContext;
  const mapping = params.dataMapping as { payee?: AgWidgetField[]; paid?: AgWidgetField[]; payments?: AgWidgetField[] };
  const payeeF = mapping.payee?.[0];
  const paidF = mapping.paid?.[0];
  const countF = mapping.payments?.[0];
  const rows = useRows(params, () => (payeeF && paidF && countF ? { fields: [payeeF, paidF, countF], sort: [{ field: paidF, direction: "desc" as const }] } : null));
  const selected = new Set((params.widgetApi.getCrossFilterSelections() ?? []).flatMap((s) => (s.type === "value" ? s.values.map(String) : [])));
  const nec = ctx?.tax?.necThreshold ?? 2000;
  const kAmount = ctx?.tax?.kThreshold ?? 20000;
  const kCount = ctx?.tax?.kPaymentsThreshold ?? 200;
  const pct = (x: number, of: number) => `${Math.min(100, (x / of) * 100).toFixed(1)}%`;

  return (
    <div className="hw hw-tax">
      <ul className="hw-payees">
        {payeeF &&
          paidF &&
          countF &&
          (rows ?? []).map((row) => {
            const name = String(valueOf(row, payeeF));
            const paid = Number(valueOf(row, paidF) ?? 0);
            const count = Number(valueOf(row, countF) ?? 0);
            const necHit = paid >= nec;
            const kHit = paid > kAmount && count > kCount;
            return (
              <li key={name}>
                <button
                  type="button"
                  className={`hw-payee ${selected.has(name) ? "on" : ""}`}
                  onClick={() => params.widgetApi.toggleCrossFilter({ type: "value", field: payeeF, value: name, group: 0 })}
                >
                  <span className="hw-name">{name}</span>
                  <span className="hw-figure">
                    {money(paid)} in {ctx?.tax?.year ?? ""} · {count} payment{count === 1 ? "" : "s"}
                  </span>
                  <span className="hw-meter-label">
                    1099-NEC line {money(nec)} <b className={necHit ? "warn" : "ok"}>{necHit ? "reached" : `${money(Math.max(0, nec - paid))} to go`}</b>
                  </span>
                  <span className="hw-meter" aria-hidden>
                    <i className={necHit ? "hit" : ""} style={{ width: pct(paid, nec) }} />
                  </span>
                  <span className="hw-meter-label">
                    1099-K needs both lines <b className={kHit ? "warn" : "ok"}>{kHit ? "reached" : "not reached"}</b>
                  </span>
                  <span className="hw-k">
                    <span>{money(kAmount)}</span>
                    <span className="hw-meter thin" aria-hidden>
                      <i style={{ width: pct(paid, kAmount) }} />
                    </span>
                    <span>{kCount} payments</span>
                    <span className="hw-meter thin" aria-hidden>
                      <i style={{ width: pct(count, kCount) }} />
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
      </ul>
      <p className="hw-legend">{ctx?.tax?.note}</p>
    </div>
  );
}

const CHAIN_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="8" width="8" height="8" rx="2"/><rect x="14" y="8" width="8" height="8" rx="2"/><path d="M10 12h4"/></svg>';
const METER_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7h18M3 12h12M3 17h7"/></svg>';

export const CHAIN_WIDGET = "handoff-receipt-chain";
export const TAX_WIDGET = "handoff-tax-meters";

/** Studio's built-in widgets plus HandOff's two, under their own menu heading. */
export function ledgerWidgets(defaults: AgWidgetsConfig<AgDefaultRegistry>): AgWidgetsConfig<AgDefaultRegistry> {
  const widgets = createWidgets({
    additionalTypes: [
      {
        id: CHAIN_WIDGET,
        label: "Receipt chain",
        icon: CHAIN_ICON,
        form: (p: AgWidgetFormParams) => p.createDefaults({}),
        comp: ReceiptChain,
        defaultSize: { width: 720, height: 300 },
        minSize: { width: 320, height: 200 },
        ai: {
          label: "Receipt chain",
          description: "HandOff's signed receipts as linked blocks, newest first, coloured by who acted, with a live Verify button. Needs no data mapping.",
          usage: "Use to show that the ledger is intact, or to follow one task's money trail (clicking a block cross-filters by task).",
        },
      },
      {
        id: TAX_WIDGET,
        label: "1099 meters",
        icon: METER_ICON,
        dataMapping: {
          payee: { type: "field", supportedRoles: ["category"], requires: { cardinality: "many" }, required: true, aiDescription: "The payee name field." },
          paid: { type: "field", supportedRoles: ["numeric"], requires: { per: "dataMapping.payee", cardinality: "one" }, required: true, aiDescription: "Amount paid to the payee this year." },
          payments: { type: "field", supportedRoles: ["numeric"], requires: { per: "dataMapping.payee", cardinality: "one" }, required: true, aiDescription: "Number of payments this year." },
        },
        defaultState: {
          dataMapping: {
            payee: [{ id: "payees.name" }],
            paid: [{ id: "payees.paidYtd", aggregation: "sum" }],
            payments: [{ id: "payees.payments", aggregation: "sum" }],
          },
        } as never,
        form: (p: AgWidgetFormParams) =>
          p.createDefaults({
            dataMappingItems: [
              { key: "payee", label: "Payee" },
              { key: "paid", label: "Paid this year" },
              { key: "payments", label: "Payments this year" },
            ],
          }),
        comp: TaxMeters,
        defaultSize: { width: 480, height: 360 },
        minSize: { width: 280, height: 200 },
        ai: {
          label: "1099 meters",
          description: "Per-payee meters against the 1099-NEC line and the two-part 1099-K test, from PayPal-confirmed payments this year.",
          usage: "Use for tax exposure questions. Map payee to payees.name, paid to payees.paidYtd and payments to payees.payments.",
        },
      },
    ],
    menu: [...defaults.menu, { label: "HandOff", widgetIds: [CHAIN_WIDGET, TAX_WIDGET] }],
  } as never);
  return widgets as AgWidgetsConfig<AgDefaultRegistry>;
}
