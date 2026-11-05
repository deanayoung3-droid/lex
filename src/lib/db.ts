import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { MIGRATIONS } from "./schema";

// Postgres everywhere. With DATABASE_URL it connects to your Postgres. Without it (local
// development, small sites), the same SQL runs on PGlite, Postgres compiled to WebAssembly, stored in
// DATA_DIR/pg, through the same node-postgres client.

export const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), "data");

// Counts and sums come back as numbers, timestamps as ISO strings, dates as YYYY-MM-DD.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => Number(v));
pg.types.setTypeParser(pg.types.builtins.TIMESTAMPTZ, (v) => new Date(v).toISOString());
pg.types.setTypeParser(pg.types.builtins.TIMESTAMP, (v) => new Date(`${v.replace(" ", "T")}Z`).toISOString());
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);

/** Identifies this server process, for job locks and leases. */
export const INSTANCE_ID = `${process.env.K_REVISION ?? "local"}-${process.pid}-${crypto.randomBytes(3).toString("hex")}`;

declare global {
  var __lexPool: Promise<pg.Pool> | undefined;
}

async function createPool(): Promise<pg.Pool> {
  let pool: pg.Pool;
  if (process.env.DATABASE_URL) {
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.DB_POOL_SIZE || 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
  } else {
    const [{ PGlite }, { vector }, { createPgConfig }] = await Promise.all([
      import("@electric-sql/pglite"),
      import("@electric-sql/pglite-pgvector"),
      import("@electric-sql/pglite/node-postgres"),
    ]);
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const lite = new PGlite(path.join(DATA_DIR, "pg"), { extensions: { vector } });
    pool = new pg.Pool(createPgConfig(lite));
  }
  // Store and compare times in UTC, whatever the server's own zone.
  pool.on("connect", (c) => void c.query("SET TIME ZONE 'UTC'").catch(() => {}));
  pool.on("error", (err) => console.error("[db] idle client error", err));
  await migrate(pool);
  return pool;
}

/** One pool per server process; survives dev hot reloads. Migrations run before first use. */
export function pool(): Promise<pg.Pool> {
  globalThis.__lexPool ??= createPool().catch((err) => {
    globalThis.__lexPool = undefined;
    throw err;
  });
  return globalThis.__lexPool;
}

/**
 * Applies pending migrations in order, each in the same transaction as its bookkeeping. The
 * advisory lock makes instances that start together take turns instead of racing.
 */
async function migrate(p: pg.Pool) {
  const c = await p.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock(7302411)");
    await c.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         id integer PRIMARY KEY, name text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`,
    );
    const done = new Set((await c.query<{ id: number }>("SELECT id FROM schema_migrations")).rows.map((r) => r.id));
    for (const m of MIGRATIONS) {
      if (done.has(m.id)) continue;
      await c.query(m.sql);
      await c.query("INSERT INTO schema_migrations (id, name) VALUES ($1, $2)", [m.id, m.name]);
    }
    await c.query("COMMIT");
  } catch (err) {
    await c.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    c.release();
  }
}

/* Queries. Inside tx(), they run on the transaction's connection automatically. */

const txClient = new AsyncLocalStorage<pg.PoolClient>();

async function conn(): Promise<pg.Pool | pg.PoolClient> {
  return txClient.getStore() ?? (await pool());
}

/** All rows. Parameters are $1, $2, … */
export async function all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const res = await (await conn()).query(sql, params);
  return res.rows as T[];
}

/** The first row, or undefined. */
export async function get<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
  return (await all<T>(sql, params))[0];
}

/** Runs a statement and returns how many rows it touched. */
export async function run(sql: string, params: unknown[] = []): Promise<number> {
  return (await (await conn()).query(sql, params)).rowCount ?? 0;
}

/** Runs an INSERT … RETURNING id and returns the id. */
export async function insert(sql: string, params: unknown[] = []): Promise<number> {
  const row = await get<{ id: number }>(sql, params);
  if (!row) throw new Error("Insert returned no id");
  return row.id;
}

let savepoints = 0;

/** Runs fn in a transaction, rolling back if it throws. Nested calls use savepoints. */
export async function tx<T>(fn: () => Promise<T>): Promise<T> {
  const current = txClient.getStore();
  if (current) {
    const sp = `sp${++savepoints}`;
    await current.query(`SAVEPOINT ${sp}`);
    try {
      const out = await fn();
      await current.query(`RELEASE SAVEPOINT ${sp}`);
      return out;
    } catch (err) {
      await current.query(`ROLLBACK TO SAVEPOINT ${sp}`);
      throw err;
    }
  }
  const c = await (await pool()).connect();
  try {
    await c.query("BEGIN");
    const out = await txClient.run(c, fn);
    await c.query("COMMIT");
    return out;
  } catch (err) {
    await c.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    c.release();
  }
}

/**
 * A named lease, so one instance at a time does a periodic job (reading the website, grouping questions).
 * Returns true if this process holds it for the next `seconds`.
 */
export async function acquireLease(name: string, seconds: number): Promise<boolean> {
  const n = await run(
    `INSERT INTO leases (name, holder, until) VALUES ($1, $2, now() + make_interval(secs => $3))
     ON CONFLICT (name) DO UPDATE SET holder = excluded.holder, until = excluded.until
     WHERE leases.until < now() OR leases.holder = excluded.holder`,
    [name, INSTANCE_ID, seconds],
  );
  return n > 0;
}

export async function releaseLease(name: string) {
  await run("UPDATE leases SET until = now() WHERE name = $1 AND holder = $2", [name, INSTANCE_ID]);
}
