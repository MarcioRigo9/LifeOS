import pg, { type PoolClient } from "pg";
const { Pool } = pg;
type Pool = InstanceType<typeof pg.Pool>;

// The application NEVER connects as lifeos_admin at request time (IMPLEMENTATION_RULES.md #13).
// This is the only pool request-handling code is allowed to import.
function buildRuntimePool(): Pool {
  const connectionString = process.env.DATABASE_URL_RUNTIME;
  if (!connectionString) {
    throw new Error("DATABASE_URL_RUNTIME is not set.");
  }
  return new Pool({ connectionString, max: 10 });
}

let _runtimePool: Pool | null = null;
export function getRuntimePool(): Pool {
  if (!_runtimePool) _runtimePool = buildRuntimePool();
  return _runtimePool;
}

/**
 * Opens a transaction, sets the RLS session context (app.household_id / app.user_id) via
 * SET LOCAL, runs `fn`, then commits — or rolls back on any error. This is the ONLY way
 * request-handling code should touch the database for anything household-scoped
 * (SECURITY_MODEL.md §3.1, ADR 014).
 *
 * `householdId` is optional for the narrow pre-household-context bootstrap queries
 * (login: looking up a user's own household_members rows before the household is known).
 */
export async function withHouseholdContext<T>(
  pool: Pool,
  ctx: { userId: string; householdId?: string },
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id', $1, true)", [ctx.userId]);
    if (ctx.householdId) {
      await client.query("SELECT set_config('app.household_id', $1, true)", [ctx.householdId]);
    }
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** For the narrow set of global-scope lookups (users by email, sessions by token) that must
 * run before any user/household context exists at all — no SET LOCAL, no household exposure,
 * protected only by query pattern discipline (DATA_MODEL_REVIEW.md §1.1). */
export async function withoutContext<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}
