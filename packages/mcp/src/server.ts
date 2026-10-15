/**
 * The agent door. Any MCP client (a personal agent, Claude, an IDE) can read the creator's rate
 * card, propose work, follow a task and check the ledger. Every call goes through the default-deny
 * gateway; there is no payout tool, and no tool accepts an amount.
 */
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { Gateway, GatewayDenied, TOOL_SCHEMAS, type GatewaySpan, type ToolHandlers, type ToolName } from "@handoff/agents";
import { EngineError, type Engine } from "@handoff/engine";

export const MCP_AGENT_ID = "mcp-client";

export const MCP_TOOLS = ["list_rate_lines", "propose_task", "get_task_status", "list_receipts", "verify_chain"] as const satisfies readonly ToolName[];

const DESCRIPTIONS: Record<(typeof MCP_TOOLS)[number], string> = {
  list_rate_lines:
    "The active mandate's payees and rate lines, with prices set by the creator's signed rate card. Call this before proposing work.",
  propose_task:
    "Propose work for a payee on a rate line, with a quantity and a deliverable spec. Records a signed proposal for the creator's team to review. You cannot set or suggest an amount: the price comes from the rate card, and nothing is paid until a separate verifier and the policy engine approve delivered work.",
  get_task_status: "Where one task stands: delivered, verified, decided (approved, waiting for approval, or blocked with a reason), and paid.",
  list_receipts: "Signed, hash-chained receipts, oldest first. Use fromSeq and limit (up to 50) to page.",
  verify_chain: "Verify every receipt signature, hash link and checkpoint (Ed25519 + ML-DSA-65) right now, and report the result.",
};

const INSTRUCTIONS =
  "HandOff pays a creator's human contractors through PayPal (sandbox). Agents propose; plain code pays; every step is a signed receipt. " +
  "You can read the rate card, propose work, follow tasks and verify the ledger. You cannot pay anyone, set amounts, approve payouts or change the mandate.";

function handlersFor(engine: Engine, agentLabel: string): ToolHandlers {
  return {
    list_rate_lines: () => engine.rateCard(),
    propose_task: (args, ctx) => engine.recordProposal(args, { label: agentLabel, traceId: ctx.traceId }),
    get_task_status: (args) => engine.taskStatus(args.taskId),
    list_receipts: (args) => engine.listReceipts(args.fromSeq, args.limit),
    verify_chain: async () => {
      const r = await engine.report();
      const last = r.checkpoints.at(-1);
      return {
        ok: r.ok,
        receiptsChecked: r.chain.checked,
        firstBrokenSeq: r.chain.firstBrokenSeq ?? null,
        latestCheckpoint: last ? { treeSize: last.treeSize, valid: last.problems.length === 0, signatures: "Ed25519 + ML-DSA-65" } : null,
      };
    },
    submit_delivery: async () => {
      throw new GatewayDenied("submit_delivery is for contractors, not for the MCP door");
    },
  };
}

export type HandoffMcpOptions = {
  getEngine: () => Promise<Engine>;
  onSpan?: (span: GatewaySpan) => void;
};

export function createHandoffMcpHandler(options: HandoffMcpOptions) {
  return createMcpHandler(
    ({ authInfo }) => {
      const server = new McpServer({ name: "handoff", version: "0.1.0" }, { instructions: INSTRUCTIONS });
      const agentLabel = authInfo?.clientId ?? "mcp-client";
      for (const name of MCP_TOOLS) {
        server.registerTool(
          name,
          {
            title: name.replaceAll("_", " "),
            description: DESCRIPTIONS[name],
            inputSchema: TOOL_SCHEMAS[name],
            annotations: { readOnlyHint: name !== "propose_task", destructiveHint: false, openWorldHint: false },
          },
          async (args: unknown) => {
            const engine = await options.getEngine();
            const gateway = new Gateway(
              [{ agentId: MCP_AGENT_ID, role: "external-agent", allowedTools: MCP_TOOLS }],
              handlersFor(engine, agentLabel),
              options.onSpan,
            );
            try {
              const result = await gateway.invoke(MCP_AGENT_ID, name, args);
              return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
            } catch (e) {
              if (e instanceof GatewayDenied || e instanceof EngineError) {
                return { content: [{ type: "text" as const, text: e.message }], isError: true };
              }
              throw e;
            }
          },
        );
      }
      return server;
    },
    { responseMode: "json" },
  );
}
