import pg from "pg";
const { Client, Pool } = pg;
type Pool = InstanceType<typeof pg.Pool>;
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const MIGRATIONS_DIR = path.resolve(__dirname, "../../../../db/migrations");

const ADMIN_URL = process.env.TEST_DATABASE_URL_ADMIN ?? "postgres://postgres:lifeos_dev_admin_pw@127.0.0.1:5432/postgres";
const TEST_DB_NAME = "lifeos_test";
const RUNTIME_PASSWORD = "lifeos_runtime_test_password";

function adminUrlForDb(db: string): string {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${db}`;
  return u.toString();
}

export function testRuntimeUrl(): string {
  const u = new URL(ADMIN_URL);
  u.username = "lifeos_runtime";
  u.password = RUNTIME_PASSWORD;
  u.pathname = `/${TEST_DB_NAME}`;
  return u.toString();
}

/** Creates lifeos_test + the lifeos_runtime role (mirroring db/init/01-roles.sql) and applies
 * every migration in db/migrations, idempotently. Run once per test session. */
export async function ensureTestDatabase(): Promise<void> {
  const bootstrap = new Client({ connectionString: adminUrlForDb("postgres") });
  await bootstrap.connect();
  try {
    const exists = await bootstrap.query("SELECT 1 FROM pg_database WHERE datname = $1", [TEST_DB_NAME]);
    if (exists.rowCount === 0) {
      await bootstrap.query(`CREATE DATABASE ${TEST_DB_NAME}`);
    }
    const roleExists = await bootstrap.query("SELECT 1 FROM pg_roles WHERE rolname = 'lifeos_runtime'");
    if (roleExists.rowCount === 0) {
      await bootstrap.query(
        `CREATE ROLE lifeos_runtime LOGIN PASSWORD '${RUNTIME_PASSWORD}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION`
      );
    } else {
      await bootstrap.query(`ALTER ROLE lifeos_runtime PASSWORD '${RUNTIME_PASSWORD}'`);
    }
    await bootstrap.query(`GRANT CONNECT ON DATABASE ${TEST_DB_NAME} TO lifeos_runtime`);
  } finally {
    await bootstrap.end();
  }

  const admin = new Client({ connectionString: adminUrlForDb(TEST_DB_NAME) });
  await admin.connect();
  try {
    await admin.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    const applied = new Set((await admin.query("SELECT filename FROM schema_migrations")).rows.map((r) => r.filename));
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
      await admin.query("BEGIN");
      await admin.query(sql);
      await admin.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
      await admin.query("COMMIT");
    }
  } finally {
    await admin.end();
  }
}

/** Wipes all tenant data between test files so tests don't interfere with each other. */
export async function truncateAll(): Promise<void> {
  const admin = new Client({ connectionString: adminUrlForDb(TEST_DB_NAME) });
  await admin.connect();
  try {
    await admin.query(`
      TRUNCATE TABLE
        audit_log, agent_runs, job_runs, scheduled_jobs, decision_executions, agent_decisions,
        agent_memories, messages, conversations, health_history, measurements, habit_goal_links,
        habits, goals, consents, profiles, household_members, sessions, users, households
      RESTART IDENTITY CASCADE
    `);
  } finally {
    await admin.end();
  }
}

let _testPool: Pool | null = null;
export function getTestRuntimePool(): Pool {
  if (!_testPool) _testPool = new Pool({ connectionString: testRuntimeUrl(), max: 5 });
  return _testPool;
}

export async function closeTestPool(): Promise<void> {
  if (_testPool) {
    await _testPool.end();
    _testPool = null;
  }
}
