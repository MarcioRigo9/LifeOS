import pg from "pg";
const { Client } = pg;

// PHASE_1_SPEC.md §12: "Exclusão — Sim, documentada: rotina (script/admin) que apaga/anonimiza
// em cascata." Documented cascade order:
//   1. Capture which users belong ONLY to this household (before deleting anything).
//   2. DELETE FROM households — every household-scoped table has
//      `household_id ... REFERENCES households(id) ON DELETE CASCADE` (see db/migrations),
//      so household_members, profiles, consents, goals, habits, habit_goal_links,
//      conversations->messages, agent_memories, agent_decisions->decision_executions,
//      scheduled_jobs->job_runs, agent_runs, and audit_log all cascade automatically.
//   3. Delete the captured users (only those not shared with another household) — this
//      cascades their sessions (users.id REFERENCES ... ON DELETE CASCADE on sessions).
// `users` is intentionally NOT wiped just because a household is deleted: a future multi-
// household user (DATA_MODEL_REVIEW.md §1.1) must keep their account if they still belong to
// another household — step 3 only removes users left with zero remaining memberships.
//
// Usage: DATABASE_URL_ADMIN=... npx tsx scripts/household-delete.ts <householdId> --confirm

async function main() {
  const householdId = process.argv[2];
  const confirmed = process.argv.includes("--confirm");
  if (!householdId || !confirmed) {
    console.error("Usage: household-delete.ts <householdId> --confirm");
    console.error("(--confirm is required — this is irreversible)");
    process.exit(1);
  }
  const adminUrl = process.env.DATABASE_URL_ADMIN;
  if (!adminUrl) throw new Error("DATABASE_URL_ADMIN is not set.");

  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query("BEGIN");

    const memberUsers = await client.query<{ user_id: string }>(
      "SELECT user_id FROM household_members WHERE household_id = $1",
      [householdId]
    );
    const candidateUserIds = memberUsers.rows.map((r) => r.user_id);

    const householdRes = await client.query("DELETE FROM households WHERE id = $1 RETURNING id", [householdId]);
    if (householdRes.rowCount === 0) {
      await client.query("ROLLBACK");
      console.error(`Household ${householdId} not found — nothing deleted.`);
      process.exit(1);
    }

    let deletedUsers = 0;
    for (const userId of candidateUserIds) {
      const stillMember = await client.query("SELECT 1 FROM household_members WHERE user_id = $1 LIMIT 1", [userId]);
      if (stillMember.rowCount === 0) {
        await client.query("DELETE FROM users WHERE id = $1", [userId]);
        deletedUsers++;
      }
    }

    await client.query("COMMIT");
    console.log(`Deleted household ${householdId} (cascaded all household-scoped data) and ${deletedUsers} user(s) with no remaining memberships.`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
