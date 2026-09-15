import pg from "pg";
const { Client } = pg;

// PHASE_1_SPEC.md §12: "Exportação de dados — Sim, mínima: um script/endpoint administrativo
// que despeja todos os dados de um household em JSON." No end-user UI required in Fase 1.
//
// Usage: DATABASE_URL_ADMIN=... npx tsx scripts/household-export.ts <householdId>

const TABLES_IN_DEPENDENCY_ORDER = [
  "households",
  "household_members",
  "profiles",
  "consents",
  "goals",
  "habits",
  "habit_goal_links",
  "conversations",
  "messages",
  "agent_memories",
  "agent_decisions",
  "decision_executions",
  "scheduled_jobs",
  "job_runs",
  "agent_runs",
  "audit_log",
];

async function main() {
  const householdId = process.argv[2];
  if (!householdId) {
    console.error("Usage: household-export.ts <householdId>");
    process.exit(1);
  }
  const adminUrl = process.env.DATABASE_URL_ADMIN;
  if (!adminUrl) throw new Error("DATABASE_URL_ADMIN is not set.");

  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try {
    const dump: Record<string, unknown[]> = {};
    for (const table of TABLES_IN_DEPENDENCY_ORDER) {
      const column = table === "households" ? "id" : "household_id";
      const res = await client.query(`SELECT * FROM ${table} WHERE ${column} = $1`, [householdId]);
      dump[table] = res.rows;
    }
    // `users` has no household_id (global-scope table) — join via household_members instead.
    const usersRes = await client.query(
      `SELECT u.id, u.email, u.created_at, u.last_login_at FROM users u
       JOIN household_members hm ON hm.user_id = u.id WHERE hm.household_id = $1`,
      [householdId]
    );
    dump.users = usersRes.rows;

    console.log(JSON.stringify(dump, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
