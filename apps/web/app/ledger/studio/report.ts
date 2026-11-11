/**
 * The built-in ledger report: three pages, as AG Studio report state. Field ids refer to the
 * tables in ./data.ts; the two HandOff widgets are defined in ./widgets.tsx.
 */
import type { AgPageState, AgReportState, AgWidgetLayoutState } from "ag-studio";
import { CHAIN_WIDGET, TAX_WIDGET } from "./widgets";

// Position on the canvas grid, in tracks: 24 columns wide, rows of studioCanvasRowHeight.
const at = (xTrack: number, yTrack: number, xSpan: number, ySpan: number): AgWidgetLayoutState => ({ xTrack, yTrack, xSpan, ySpan });
const title = (text: string, subtitle?: string) => ({ title: { enabled: true, text }, ...(subtitle && { subtitle: { enabled: true, text: subtitle } }) });
const sum = (id: string) => ({ id, aggregation: "sum" as const });
const countd = (id: string) => ({ id, aggregation: "countd" as const });
const kpi = (text: string, value: { id: string; aggregation?: "sum" | "countd" }) => ({
  type: "value" as const,
  dataMapping: { value: [value] },
  format: title(text),
});
/** HandOff's own widget types are registered at runtime (./widgets.tsx), outside Studio's built-in type union. */
const custom = (widget: { type: string; dataMapping: Record<string, unknown>; format?: Record<string, unknown> }) => widget as never;
const grid = (cols: string[], heading: string) => ({ type: "grid" as const, dataMapping: { cols: cols.map((id) => ({ id })) }, format: title(heading) });

export const PAGE_TITLES: Record<string, string> = { money: "Money", tax: "Tax", trust: "Trust" };

const money: AgPageState = {
  id: "money",
  widgets: {
    "kpi-income": kpi("Brand income received", sum("invoices.paidAmount")),
    "kpi-invoiced": kpi("Invoiced, awaiting payment", sum("invoices.outstandingAmount")),
    "kpi-paid": kpi("Paid to contractors", sum("tasks.paidAmount")),
    "kpi-pending": kpi("Waiting for Maya's approval", sum("tasks.pendingAmount")),
    "kpi-inflight": kpi("Approved, not yet paid", sum("tasks.inFlightAmount")),
    "kpi-blocked": kpi("Tasks blocked by policy", sum("tasks.isBlocked")),
    "cap-by-week": {
      type: "column-chart-stacked",
      dataMapping: {
        categoryKey: [{ id: "mandates.week" }],
        valueKey: [sum("mandates.paid"), sum("mandates.committedUnpaid"), sum("mandates.pendingApproval"), sum("mandates.remaining")],
      },
      format: { ...title("Each week against Maya's signed cap", "Paid, committed, held for approval, and what is left"), style: { theme: { common: { legend: { enabled: true } } } } },
    },
    "stage-bar": {
      type: "bar-chart-grouped",
      dataMapping: { categoryKey: [{ id: "tasks.stage" }], valueKey: [countd("tasks.id")] },
      format: title("Where every task stands", "Tasks by stage"),
    },
    "tasks-grid": grid(["tasks.id", "payees.name", "tasks.rateLine", "tasks.amount", "tasks.stage", "tasks.verdict", "tasks.reason"], "Tasks"),
    "invoices-grid": grid(["invoices.id", "invoices.brand", "invoices.description", "invoices.amount", "invoices.status", "invoices.paidAt"], "Brand invoices: money in through PayPal Invoicing"),
    "paid-by-payee": {
      type: "bar-chart-stacked",
      dataMapping: { categoryKey: [{ id: "payees.name" }], valueKey: [sum("tasks.paidAmount"), sum("tasks.inFlightAmount"), sum("tasks.pendingAmount")] },
      format: { ...title("By payee"), style: { theme: { common: { legend: { enabled: true } } } } },
    },
  },
  widgetLayout: {
    "kpi-income": at(0, 0, 4, 6),
    "kpi-invoiced": at(4, 0, 4, 6),
    "kpi-paid": at(8, 0, 4, 6),
    "kpi-pending": at(12, 0, 4, 6),
    "kpi-inflight": at(16, 0, 4, 6),
    "kpi-blocked": at(20, 0, 4, 6),
    "cap-by-week": at(0, 6, 15, 17),
    "stage-bar": at(15, 6, 9, 17),
    "tasks-grid": at(0, 23, 16, 19),
    "paid-by-payee": at(16, 23, 8, 19),
    "invoices-grid": at(0, 42, 24, 10),
  },
};

const tax: AgPageState = {
  id: "tax",
  widgets: {
    meters: custom({
      type: TAX_WIDGET,
      dataMapping: { payee: [{ id: "payees.name" }], paid: [sum("payees.paidYtd")], payments: [sum("payees.payments")] },
      format: title("1099 running totals", "PayPal-confirmed payments this calendar year"),
    }),
    "payees-grid": grid(["payees.name", "payees.paidYtd", "payees.payments", "payees.necProgress", "payees.kProgress"], "Payees"),
    "paid-by-month": {
      type: "column-chart-grouped",
      dataMapping: { categoryKey: [{ id: "calendar::day" }], valueKey: [sum("payouts.amount")] },
      format: title("Payouts sent by day"),
    },
  },
  widgetLayout: {
    meters: at(0, 0, 12, 26),
    "payees-grid": at(12, 0, 12, 11),
    "paid-by-month": at(12, 11, 12, 15),
  },
};

const trust: AgPageState = {
  id: "trust",
  widgets: {
    chain: custom({ type: CHAIN_WIDGET, dataMapping: {}, format: title("Receipt chain", "Newest first. Every block is signed and links to the one before it.") }),
    "who-acted": {
      type: "pivot-grid",
      dataMapping: { rows: [{ id: "receipts.type" }], columns: [{ id: "receipts.actorKind" }], values: [countd("receipts.seq")] },
      format: { ...title("Who signed what", "Agents propose; only plain code writes PAYOUT receipts"), style: { grandTotalRow: { enabled: true } } },
    },
    "receipts-grid": grid(["receipts.seq", "receipts.at", "receipts.actor", "receipts.type", "receipts.summary", "receipts.status", "receipts.hash"], "Receipts"),
    "flags-grid": grid(["flags.receiptSeq", "flags.kind", "flags.note"], "Flags for a person to look at"),
  },
  widgetLayout: {
    chain: at(0, 0, 24, 14),
    "who-acted": at(0, 14, 24, 17),
    "receipts-grid": at(0, 31, 24, 20),
    "flags-grid": at(0, 51, 24, 12),
  },
};

export const initialReport: AgReportState = {
  pages: [money, tax, trust],
  selectedPageId: "money",
  panels: { ai: { collapsed: false }, filters: { collapsed: true }, data: { collapsed: true } },
} as AgReportState;
