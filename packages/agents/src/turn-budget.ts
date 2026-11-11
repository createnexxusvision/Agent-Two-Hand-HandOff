/**
 * Caps on model turns for the public AG Studio assistant: a sliding window per client and a daily
 * total, so one visitor cannot spend the free-tier quota the judges' demo relies on.
 */
export type TurnBudgetConfig = { perClient: number; windowMs: number; perDay: number };

export type TurnBudgetDecision = { ok: true; remainingToday: number } | { ok: false; reason: "client" | "day"; retryAfterS: number };

export class TurnBudget {
  private readonly recent = new Map<string, number[]>();
  private day = "";
  private usedToday = 0;

  constructor(
    private readonly config: TurnBudgetConfig,
    private readonly now: () => number = Date.now,
  ) {}

  take(client: string): TurnBudgetDecision {
    const t = this.now();
    const today = new Date(t).toISOString().slice(0, 10);
    if (today !== this.day) {
      this.day = today;
      this.usedToday = 0;
    }
    if (this.usedToday >= this.config.perDay) {
      const midnight = Date.parse(`${today}T00:00:00.000Z`) + 86_400_000;
      return { ok: false, reason: "day", retryAfterS: Math.ceil((midnight - t) / 1000) };
    }
    const since = t - this.config.windowMs;
    const mine = (this.recent.get(client) ?? []).filter((x) => x > since);
    if (mine.length >= this.config.perClient) {
      this.recent.set(client, mine);
      return { ok: false, reason: "client", retryAfterS: Math.ceil((mine[0]! + this.config.windowMs - t) / 1000) };
    }
    mine.push(t);
    this.recent.set(client, mine);
    this.usedToday++;
    if (this.recent.size > 5000) this.prune(since);
    return { ok: true, remainingToday: this.config.perDay - this.usedToday };
  }

  private prune(since: number): void {
    for (const [client, times] of this.recent) if (times.every((x) => x <= since)) this.recent.delete(client);
  }
}

/**
 * Spaces model turns to stay under a provider's per-minute limit (Gemini Flash-Lite's free tier
 * allows 15 a minute). A multi-agent dashboard build fires turns faster than that; waiting a few
 * seconds for a slot beats failing the build halfway.
 */
export class TurnPacer {
  private times: number[] = [];

  constructor(
    private readonly perMinute: number,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  /** Resolves true once a slot is taken, or false if the wait would exceed maxWaitMs or the caller gave up. */
  async slot(maxWaitMs: number, signal?: AbortSignal): Promise<boolean> {
    let waited = 0;
    for (;;) {
      const t = this.now();
      this.times = this.times.filter((x) => x > t - 60_000);
      if (this.times.length < this.perMinute) {
        this.times.push(t);
        return true;
      }
      const ms = this.times[0]! + 60_000 - t + 25;
      if (waited + ms > maxWaitMs || signal?.aborted) return false;
      await this.sleep(ms);
      waited += ms;
    }
  }
}
