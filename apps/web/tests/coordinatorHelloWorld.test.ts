import { beforeEach, describe, expect, it } from "vitest";
import { getTestRuntimePool, truncateAll } from "./setup/testDb";
import { createHouseholdFixture } from "./setup/fixtures";
import { withHouseholdContext } from "@/lib/db/pool";
import { handleCoordinatorInvocation } from "@/lib/agents/coordinator";
import { FakeAIProvider } from "@/lib/ai-provider/fake";
import { newRequestId } from "@/lib/auth/session";

describe("Coordinator end-to-end (CONV-001, CONV-002, AI-001, capabilities)", () => {
  beforeEach(truncateAll);

  it("persists the user turn, calls the AI Provider, persists the reply, and logs the agent_run", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "M");

    const response = await handleCoordinatorInvocation(
      pool,
      {
        requestId: newRequestId(),
        householdId: household.householdId,
        userId: household.userId,
        personId: household.profileId,
        message: "Olá, Coordinator!",
      },
      { aiProvider: new FakeAIProvider(), modelId: "test-model" }
    );

    expect(response.reply).toContain("Olá, Coordinator!");
    expect(response.conversationId).toBeTruthy();

    const rows = await withHouseholdContext(
      pool,
      { userId: household.userId, householdId: household.householdId },
      (client) =>
        client.query(
          "SELECT role, content FROM messages WHERE conversation_id = $1 ORDER BY created_at",
          [response.conversationId]
        )
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[0].role).toBe("user");
    expect(rows.rows[0].content).toBe("Olá, Coordinator!");
    expect(rows.rows[1].role).toBe("agent");

    const runRows = await withHouseholdContext(
      pool,
      { userId: household.userId, householdId: household.householdId },
      (client) =>
        client.query(
          "SELECT status, token_usage_json, cost_cents, model_id, conversation_id FROM agent_runs WHERE conversation_id = $1",
          [response.conversationId]
        )
    );
    expect(runRows.rows).toHaveLength(1);
    expect(runRows.rows[0].status).toBe("completed");
    expect(runRows.rows[0].cost_cents).toBeGreaterThanOrEqual(0);
    expect(runRows.rows[0].token_usage_json).toBeTruthy();
  });

  it("a second call with the same conversationId continues the same conversation, not a new one", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "N");
    const first = await handleCoordinatorInvocation(
      pool,
      { requestId: newRequestId(), householdId: household.householdId, userId: household.userId, message: "primeira" },
      { aiProvider: new FakeAIProvider(), modelId: "test-model" }
    );
    const second = await handleCoordinatorInvocation(
      pool,
      {
        requestId: newRequestId(),
        householdId: household.householdId,
        userId: household.userId,
        conversationId: first.conversationId,
        message: "segunda",
      },
      { aiProvider: new FakeAIProvider(), modelId: "test-model" }
    );

    expect(second.conversationId).toBe(first.conversationId);

    const rows = await withHouseholdContext(
      pool,
      { userId: household.userId, householdId: household.householdId },
      (client) => client.query("SELECT count(*) FROM messages WHERE conversation_id = $1", [first.conversationId])
    );
    expect(Number(rows.rows[0].count)).toBe(4); // 2 user + 2 agent turns
  });
});
