/**
 * AG Studio's view of the ledger: six tables derived from the signed receipts, the joins between
 * them, one calendar and a few calculated measures. Field ids ('tasks.paidAmount') are what the
 * report state, the custom widgets and the agents refer to.
 */
import type { AgDataSourcesDefinition, AgExpressionFieldDefinition, AgFieldDefinition, AgFormat, AgRelationDefinition } from "ag-studio";
import type { StudioData } from "@handoff/engine";

type FieldSpec = [id: string, name: string, format: AgFormat, options?: { hide?: boolean; description?: string; blankValue?: string }];
const blank = { blankValue: "—" };

const usd = { format: new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }) };
const fields = (specs: FieldSpec[]): AgFieldDefinition[] =>
  specs.map(([id, name, format, options]) => ({ id, name, format, ...(format === "currencyFormat" && { formatOptions: usd }), ...options }));

const manyToOne = (id: string, source: string, target: string): AgRelationDefinition => {
  const [sourceTable, sourceField] = source.split(".") as [string, string];
  const [targetTable, targetField] = target.split(".") as [string, string];
  return { id, source: { tableId: sourceTable, fieldId: sourceField }, target: { tableId: targetTable, fieldId: targetField }, type: "many-to-one" };
};

export const CALENDAR_ID = "calendar";
const onCalendar = (tableId: string, fieldId: string): AgRelationDefinition => ({
  id: `${tableId}-${fieldId}-calendar`,
  source: { tableId, fieldId },
  target: { calendarId: CALENDAR_ID },
  truncate: "day",
});

const ratio = (id: string, name: string, description: string, numerator: string, denominator: string): AgExpressionFieldDefinition => ({
  id,
  name,
  description,
  format: "percentageFormat",
  isMeasure: true,
  expression: { operator: "divide", inputs: [{ id: numerator, aggregation: "sum" }, { id: denominator, aggregation: "sum" }] },
});

export function buildSources(data: StudioData): AgDataSourcesDefinition {
  const { receipts, tasks, payouts, payees, mandates, flags } = data.tables;
  const days = receipts.map((r) => r.day).sort();
  const today = data.asOf.slice(0, 10);

  return {
    description:
      "HandOff's PayPal sandbox ledger for one creator (Maya) paying human contractors. AI agents plan and verify work; plain code decides and pays " +
      "through PayPal Payouts inside Maya's signed weekly mandate; every step is a signed, hash-chained receipt. All money is USD. " +
      "Amounts come only from the signed rate card. Tax figures are running totals, not filing decisions.",
    sources: [
      {
        id: "receipts",
        description: "Every signed receipt, oldest first. Actor kind says whether an AI agent, plain code or a person acted. Status is the live signature and hash-link check.",
        data: receipts,
        fields: fields([
          ["seq", "Receipt #", "integerFormat"],
          ["type", "Receipt Type", "textFormat"],
          ["actor", "Actor", "textFormat"],
          ["actorKind", "Actor Kind", "textFormat", { description: "AI agent, Plain code or Person." }],
          ["at", "Signed At", "dateTimeFormat"],
          ["day", "Receipt Day", "dateFormat", { hide: true }],
          ["summary", "What Happened", "textFormat"],
          ["amount", "Receipt Amount", "currencyFormat", blank],
          ["status", "Signature Check", "textFormat", { description: "Verified or Broken, checked when the page loaded." }],
          ["hash", "Hash", "textFormat"],
          ["taskId", "Receipt Task", "textFormat", { description: "The task this receipt belongs to, if any.", ...blank }],
          ["mandateId", "Mandate ID", "textFormat", { hide: true }],
        ]),
      },
      {
        id: "tasks",
        description:
          "One row per task the ops agent planned. Stage is where the money stands. Paid, waiting, in-flight and blocked amounts are split into separate columns so they can be summed directly.",
        data: tasks,
        fields: fields([
          ["id", "Task", "textFormat"],
          ["mandateId", "Mandate ID", "textFormat", { hide: true }],
          ["payeeId", "Payee ID", "textFormat", { hide: true }],
          ["rateLine", "Rate Line", "textFormat"],
          ["quantity", "Quantity", "integerFormat"],
          ["amount", "Task Amount", "currencyFormat", { description: "Rate card price times quantity." }],
          ["stage", "Stage", "textFormat"],
          ["stageOrder", "Stage Order", "integerFormat", { hide: true }],
          ["verdict", "Verifier Verdict", "textFormat", blank],
          ["decision", "Policy Decision", "textFormat", blank],
          ["blockedBy", "Blocked By Check", "textFormat", blank],
          ["reason", "Reason", "textFormat", blank],
          ["plannedAt", "Planned At", "dateTimeFormat"],
          ["plannedDay", "Planned Day", "dateFormat", { hide: true }],
          ["paidAmount", "Paid", "currencyFormat"],
          ["pendingAmount", "Waiting for Approval", "currencyFormat"],
          ["inFlightAmount", "Approved, Not Yet Paid", "currencyFormat"],
          ["blockedAmount", "Blocked or Failed", "currencyFormat"],
          ["isBlocked", "Blocked Tasks", "integerFormat", { description: "1 when the policy engine blocked the task; sum it to count blocks." }],
        ]),
      },
      {
        id: "payouts",
        description: "PayPal Payouts items sent by the policy engine, with the state PayPal last reported (webhook or status read).",
        data: payouts,
        fields: fields([
          ["id", "Payout Item", "textFormat"],
          ["taskId", "Task ID", "textFormat", { hide: true }],
          ["amount", "Payout Amount", "currencyFormat"],
          ["state", "Payout State", "textFormat"],
          ["sentAt", "Sent At", "dateTimeFormat"],
          ["sentDay", "Sent Day", "dateFormat", { hide: true }],
          ["batch", "Sender Batch", "textFormat"],
          ["receiptSeq", "Latest Receipt #", "integerFormat"],
        ]),
      },
      {
        id: "payees",
        description: "Contractors in the mandate, with this calendar year's PayPal-confirmed payments against the 1099-NEC ($2,000) and 1099-K ($20,000 and 200 payments) lines.",
        data: payees,
        fields: fields([
          ["id", "Payee ID", "textFormat", { hide: true }],
          ["name", "Payee", "textFormat"],
          ["year", "Tax Year", "integerFormat"],
          ["paidYtd", "Paid This Year", "currencyFormat"],
          ["payments", "Payments This Year", "integerFormat"],
          ["necThreshold", "1099-NEC Threshold", "currencyFormat"],
          ["necProgress", "1099-NEC Progress", "percentageFormat"],
          ["kThreshold", "1099-K Amount Threshold", "currencyFormat"],
          ["kPaymentsThreshold", "1099-K Payment Count Threshold", "integerFormat"],
          ["kProgress", "1099-K Progress", "percentageFormat", { description: "The nearer of the two 1099-K tests; both must be crossed." }],
        ]),
      },
      {
        id: "mandates",
        description: "Maya's signed weekly mandates: the cap and how it is spent. Remaining is the cap minus everything committed or waiting for approval.",
        data: mandates,
        fields: fields([
          ["id", "Mandate ID", "textFormat", { hide: true }],
          ["week", "Week", "textFormat"],
          ["validFrom", "Week Starts", "dateFormat"],
          ["cap", "Weekly Cap", "currencyFormat"],
          ["paid", "Paid Against Cap", "currencyFormat"],
          ["committedUnpaid", "Committed, Not Yet Paid", "currencyFormat"],
          ["pendingApproval", "Held for Approval", "currencyFormat"],
          ["used", "Used Against Cap", "currencyFormat", { description: "Paid, committed or held for approval." }],
          ["remaining", "Remaining Under Cap", "currencyFormat"],
          ["blocked", "Blocks", "integerFormat"],
          ["isActive", "Current Week", "integerFormat", { hide: true }],
        ]),
      },
      {
        id: "flags",
        description: "Things a person should look at: policy blocks, payment instructions found in contractor notes, declines, returned payouts, chain breaks.",
        data: flags,
        fields: fields([
          ["id", "Flag ID", "textFormat", { hide: true }],
          ["receiptSeq", "Flag Receipt #", "integerFormat"],
          ["kind", "Flag", "textFormat"],
          ["note", "Flag Note", "textFormat"],
        ]),
      },
    ],
    relationships: [
      manyToOne("task-mandate", "tasks.mandateId", "mandates.id"),
      manyToOne("task-payee", "tasks.payeeId", "payees.id"),
      manyToOne("payout-task", "payouts.taskId", "tasks.id"),
      manyToOne("receipt-task", "receipts.taskId", "tasks.id"),
      manyToOne("flag-receipt", "flags.receiptSeq", "receipts.seq"),
      onCalendar("receipts", "day"),
      onCalendar("payouts", "sentDay"),
      onCalendar("tasks", "plannedDay"),
    ],
    calendars: [
      {
        id: CALENDAR_ID,
        label: "Calendar",
        range: { from: { type: "date", value: days[0] ?? today }, to: { type: "date", value: today } },
        fragments: ["year", "month", "week", "day", "dayOfWeek"],
      },
    ],
    expressions: [
      ratio("capUsed", "Cap Used", "Share of the weekly cap paid, committed or held for approval.", "mandates.used", "mandates.cap"),
      ratio("paidShare", "Paid Share", "Paid / everything the tasks were worth.", "tasks.paidAmount", "tasks.amount"),
    ],
  };
}
