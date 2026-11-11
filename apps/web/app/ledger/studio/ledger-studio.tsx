"use client";

/**
 * One AG Studio instance over the ledger. Studio owns the report being viewed or edited; this
 * component owns page tabs, the view/edit switch, and keeping a reader's own layout in their
 * browser (a convenience only: the receipts on the server are the record).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { AgStudioAiModule, enableStudioDevValidations, type AgReportState, type AgStudioApi, type AgStudioMode } from "ag-studio";
import { AgStudio, AgStudioProvider } from "ag-studio-react";
import type { StudioData } from "@handoff/engine";
import { buildAi, setLedgerData } from "./ai";
import { buildSources } from "./data";
import { initialReport, PAGE_TITLES } from "./report";
import { handoffTheme } from "./theme";
import { ledgerWidgets, type LedgerContext } from "./widgets";

if (process.env.NODE_ENV !== "production") enableStudioDevValidations();

const SAVED_KEY = "handoff-ledger-report-v1";
const LOCALE_TEXT = { aiMessageInputPlaceholder: "Ask the HandOff Auditor about this ledger…" };

function loadSaved(): AgReportState | null {
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    return raw ? (JSON.parse(raw) as AgReportState) : null;
  } catch {
    return null;
  }
}

function save(state: AgReportState | null): void {
  try {
    if (state) localStorage.setItem(SAVED_KEY, JSON.stringify(state));
    else localStorage.removeItem(SAVED_KEY);
  } catch {
    // Private windows and blocked storage just don't remember the layout.
  }
}

type Props = { data: StudioData; licenseKey?: string; aiEnabled: boolean };

export default function LedgerStudio({ data, licenseKey, aiEnabled }: Props) {
  const apiRef = useRef<AgStudioApi | null>(null);
  const [initialState] = useState(() => loadSaved() ?? initialReport);
  const [state, setState] = useState<AgReportState>(initialState);
  const [mode, setMode] = useState<AgStudioMode>("view");

  useEffect(() => setLedgerData(data), [data]);
  const sources = useMemo(() => buildSources(data), [data]);
  const context = useMemo<LedgerContext>(() => {
    const p = data.tables.payees[0];
    return {
      chain: data.chain,
      checkpoint: data.checkpoint,
      tax: { necThreshold: p?.necThreshold ?? 2000, kThreshold: p?.kThreshold ?? 20000, kPaymentsThreshold: p?.kPaymentsThreshold ?? 200, year: p?.year ?? new Date().getUTCFullYear(), note: data.taxNote },
    };
  }, [data]);
  const ai = useMemo(() => (aiEnabled ? buildAi() : undefined), [aiEnabled]);

  const selectPage = (pageId: string) => {
    const api = apiRef.current;
    if (api) api.setState({ ...api.getState(), selectedPageId: pageId });
  };
  const reset = () => {
    save(null);
    apiRef.current?.setState(initialReport);
    setMode("view");
  };

  return (
    <div className="studio-shell">
      <nav className="studio-tabs" aria-label="Dashboard pages">
        <div role="tablist">
          {state.pages.map((page, i) => (
            <button key={page.id} type="button" role="tab" aria-selected={page.id === state.selectedPageId} className="studio-tab" onClick={() => selectPage(page.id)}>
              {PAGE_TITLES[page.id] ?? `Page ${i + 1}`}
            </button>
          ))}
        </div>
        <div className="row">
          {/* Studio shows its AI panel in edit mode, beside the widget and data panels. */}
          {mode === "view" ? (
            <button type="button" onClick={() => setMode("edit")}>
              {aiEnabled ? "Ask the AI Auditor or edit" : "Edit dashboards"}
            </button>
          ) : (
            <button type="button" className="secondary" onClick={() => setMode("view")}>
              Done
            </button>
          )}
          <button type="button" className="secondary" onClick={reset}>
            Reset layout
          </button>
        </div>
      </nav>
      <div className="studio-canvas">
        <AgStudioProvider licenseKey={licenseKey} modules={ai ? [AgStudioAiModule] : undefined}>
          <AgStudio
            style={{ height: "100%", width: "100%" }}
            theme={handoffTheme}
            layout={{ widgetBorderEnabled: true }}
            localeText={LOCALE_TEXT}
            enableFilterEditingInViewMode
            data={sources}
            widgets={ledgerWidgets}
            initialState={initialState}
            context={context}
            ai={ai}
            mode={mode}
            onApiReady={(event) => {
              apiRef.current = event.api;
            }}
            onStudioReady={(event) => setState(event.api.getState())}
            onStateUpdated={(event) => {
              setState(event.state);
              save(event.state);
            }}
          />
        </AgStudioProvider>
      </div>
    </div>
  );
}
