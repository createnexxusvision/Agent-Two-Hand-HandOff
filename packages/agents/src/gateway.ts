/**
 * The one door every agent tool call goes through: registered agents only, default deny,
 * strict argument schemas, a span for every call. There is no payout tool in this list,
 * and no tool takes an amount.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { SpecSchema } from "./schemas.ts";

export const TOOL_SCHEMAS = {
  propose_task: z
    .object({
      payeeId: z.string().min(1).max(64),
      rateLineId: z.string().min(1).max(64),
      quantity: z.number().int().min(1).max(100),
      spec: SpecSchema,
    })
    .strict(),
  submit_delivery: z
    .object({
      taskId: z.string().min(1).max(64),
      files: z
        .array(
          z
            .object({
              name: z.string().min(1).max(200),
              width: z.number().int().positive().optional(),
              height: z.number().int().positive().optional(),
              durationS: z.number().positive().optional(),
              count: z.number().int().positive().optional(),
              sha256: z.string().regex(/^sha256:[0-9a-f]{64}$/),
            })
            .strict(),
        )
        .min(1)
        .max(50),
      note: z.string().max(2000).optional(),
    })
    .strict(),
  list_receipts: z
    .object({ fromSeq: z.number().int().min(1).optional(), limit: z.number().int().min(1).max(50).optional() })
    .strict(),
  verify_chain: z.object({}).strict(),
  list_rate_lines: z.object({}).strict(),
  get_task_status: z.object({ taskId: z.string().min(1).max(64) }).strict(),
} as const;

export type ToolName = keyof typeof TOOL_SCHEMAS;
export type ToolArgs<T extends ToolName> = z.infer<(typeof TOOL_SCHEMAS)[T]>;
export type ToolHandlers = { [T in ToolName]: (args: ToolArgs<T>, ctx: { agentId: string; traceId: string }) => Promise<unknown> };

export type RegisteredAgent = { agentId: string; role: string; allowedTools: readonly ToolName[]; revoked?: boolean };

export type GatewaySpan = { traceId: string; agentId: string; tool: string; ok: boolean; error?: string; ms: number };

export class GatewayDenied extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GatewayDenied";
  }
}

export class Gateway {
  private readonly agents: Map<string, RegisteredAgent>;

  constructor(
    agents: readonly RegisteredAgent[],
    private readonly handlers: ToolHandlers,
    private readonly onSpan: (span: GatewaySpan) => void = () => {},
  ) {
    this.agents = new Map(agents.map((a) => [a.agentId, a]));
  }

  async invoke(agentId: string, tool: string, rawArgs: unknown, traceId: string = randomUUID()): Promise<unknown> {
    const started = performance.now();
    const span = (ok: boolean, error?: string) =>
      this.onSpan({ traceId, agentId, tool, ok, ...(error ? { error } : {}), ms: Math.round(performance.now() - started) });
    try {
      const agent = this.agents.get(agentId);
      if (!agent || agent.revoked) throw new GatewayDenied(`agent ${agentId} is not registered or was revoked`);
      if (!Object.hasOwn(TOOL_SCHEMAS, tool)) throw new GatewayDenied(`tool ${tool} does not exist`);
      const name = tool as ToolName;
      if (!agent.allowedTools.includes(name)) throw new GatewayDenied(`${agentId} may not call ${name}`);
      const parsed = TOOL_SCHEMAS[name].safeParse(rawArgs);
      if (!parsed.success) throw new GatewayDenied(`invalid arguments for ${name}: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
      const handler = this.handlers[name] as (args: unknown, ctx: { agentId: string; traceId: string }) => Promise<unknown>;
      const result = await handler(parsed.data, { agentId, traceId });
      span(true);
      return result;
    } catch (e) {
      span(false, e instanceof Error ? e.message : String(e));
      throw e;
    }
  }
}
