import type { PGlite } from "@electric-sql/pglite";
import type { Pool, PoolClient } from "pg";
import { MIGRATIONS } from "./migrations.ts";

export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

/** The small surface both node-postgres (production) and PGlite (tests, local demo) provide. */
export interface Db extends Queryable {
  /** Runs several statements without parameters. */
  exec(sql: string): Promise<void>;
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export function fromPglite(pg: PGlite): Db {
  return {
    query: async <T>(sql: string, params: unknown[] = []) => ({ rows: (await pg.query<T>(sql, params)).rows }),
    exec: async (sql) => {
      await pg.exec(sql);
    },
    transaction: (fn) =>
      pg.transaction((tx) => fn({ query: async <T>(sql: string, params: unknown[] = []) => ({ rows: (await tx.query<T>(sql, params)).rows }) })),
    close: () => pg.close(),
  };
}

export function fromPgPool(pool: Pool): Db {
  const wrap = (c: Pool | PoolClient): Queryable => ({
    query: async <T>(sql: string, params: unknown[] = []) => ({ rows: (await c.query(sql, params)).rows as T[] }),
  });
  return {
    ...wrap(pool),
    exec: async (sql) => {
      await pool.query(sql);
    },
    transaction: async (fn) => {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const result = await fn(wrap(client));
        await client.query("commit");
        return result;
      } catch (e) {
        await client.query("rollback");
        throw e;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

/** In-process Postgres. With no dataDir it lives in memory. */
export async function openPglite(dataDir?: string): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = dataDir ? new PGlite(dataDir) : new PGlite();
  await pg.waitReady;
  return fromPglite(pg);
}

export async function openPostgres(connectionString: string): Promise<Db> {
  const { default: pg } = await import("pg");
  return fromPgPool(new pg.Pool({ connectionString, max: 5 }));
}

/** Uses DATABASE_URL when set; otherwise an in-memory PGlite database. */
export async function openDb(env: NodeJS.ProcessEnv = process.env): Promise<Db> {
  const url = env.DATABASE_URL?.trim();
  return url ? openPostgres(url) : openPglite();
}

export async function migrate(db: Db): Promise<string[]> {
  await db.exec("create table if not exists schema_migrations (id text primary key, applied_at timestamptz not null default now())");
  const done = new Set((await db.query<{ id: string }>("select id from schema_migrations")).rows.map((r) => r.id));
  const applied: string[] = [];
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    await db.transaction(async (tx) => {
      for (const statement of splitStatements(m.sql)) await tx.query(statement);
      await tx.query("insert into schema_migrations (id) values ($1)", [m.id]);
    });
    applied.push(m.id);
  }
  return applied;
}

/**
 * Splits on semicolons that end statements: not inside $$ bodies, '…' strings or -- comments.
 * Comments are dropped. Enough for this repo's own migration files.
 */
export function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let current = "";
  let i = 0;
  const push = () => {
    if (current.trim()) out.push(current.trim());
    current = "";
  };
  while (i < sql.length) {
    if (sql.startsWith("--", i)) {
      const end = sql.indexOf("\n", i);
      i = end === -1 ? sql.length : end + 1;
      current += "\n";
    } else if (sql.startsWith("$$", i)) {
      const end = sql.indexOf("$$", i + 2);
      if (end === -1) throw new Error("unterminated $$ block");
      current += sql.slice(i, end + 2);
      i = end + 2;
    } else if (sql[i] === "'") {
      let j = i + 1;
      while (j < sql.length && !(sql[j] === "'" && sql[j + 1] !== "'")) j += sql[j] === "'" ? 2 : 1;
      current += sql.slice(i, j + 1);
      i = j + 1;
    } else if (sql[i] === ";") {
      push();
      i++;
    } else {
      current += sql[i];
      i++;
    }
  }
  push();
  return out;
}
