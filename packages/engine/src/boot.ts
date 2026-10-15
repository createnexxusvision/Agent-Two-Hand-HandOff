/** Builds an Engine from environment variables, the same way locally and on Render. */
import { providerFor } from "@handoff/agents";
import { migrate, openDb, Store, type Db } from "@handoff/db";
import { loadPayPalConfig, PayPalClient } from "@handoff/paypal";
import { parseMasterKey, sha256, utf8 } from "@handoff/trust";
import { Engine } from "./engine.ts";
import { serverSigners, signingSeedFromEnv } from "./keys.ts";

export type BootInfo = {
  database: "postgres" | "embedded";
  paypal: boolean;
  webhooks: boolean;
  ai: string;
  demoKeys: boolean;
};

function masterKeyFromEnv(env: NodeJS.ProcessEnv): Uint8Array {
  const raw = env.TRUST_MASTER_KEY?.trim();
  if (raw) return parseMasterKey(raw);
  if (env.RENDER) throw new Error("TRUST_MASTER_KEY is required on Render");
  return sha256(utf8("handoff local demo master key, not secret"));
}

export async function bootEngine(env: NodeJS.ProcessEnv = process.env): Promise<{ engine: Engine; db: Db; info: BootInfo }> {
  const db = await openDb(env);
  await migrate(db);
  const { seed, demoKeys } = signingSeedFromEnv(env);

  let paypal: PayPalClient | undefined;
  let webhookId: string | undefined;
  if (env.PAYPAL_CLIENT_ID?.trim() && env.PAYPAL_CLIENT_SECRET?.trim()) {
    const config = loadPayPalConfig(env);
    paypal = new PayPalClient(config);
    webhookId = config.webhookId;
  }

  const payeeEmails: Record<string, string> = {};
  const first = env.GATE_PAYEE_EMAIL_1?.trim();
  const second = env.GATE_PAYEE_EMAIL_2?.trim();
  if (first) Object.assign(payeeEmails, { theo: first, sam: first });
  if (second) payeeEmails.ana = second;

  const hasAiKey = Boolean(env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() || env.ANTHROPIC_API_KEY?.trim());
  const engine = new Engine({
    store: new Store(db),
    signers: serverSigners(seed),
    masterKey: masterKeyFromEnv(env),
    payeeEmails,
    ...(paypal ? { paypal } : {}),
    ...(webhookId ? { webhookId } : {}),
    useAi: hasAiKey,
    env,
  });
  await engine.bootstrap();
  return {
    engine,
    db,
    info: {
      database: env.DATABASE_URL?.trim() ? "postgres" : "embedded",
      paypal: Boolean(paypal),
      webhooks: Boolean(paypal && webhookId),
      ai: hasAiKey ? providerFor(env) : "none (scripted demo)",
      demoKeys,
    },
  };
}
