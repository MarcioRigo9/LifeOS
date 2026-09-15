import { beforeEach, describe, expect, it } from "vitest";
import { getTestRuntimePool, truncateAll } from "./setup/testDb";
import { createHouseholdFixture } from "./setup/fixtures";
import { withHouseholdContext } from "@/lib/db/pool";
import { handleCoordinatorInvocation } from "@/lib/agents/coordinator";
import { FakeAIProvider } from "@/lib/ai-provider/fake";
import { newRequestId } from "@/lib/auth/session";
import type { AICompleteInput, AIProvider, AIResponse } from "@/lib/ai-provider/types";

class SpyAIProvider implements AIProvider {
  calls: AICompleteInput[] = [];
  private inner = new FakeAIProvider();
  async complete(input: AICompleteInput): Promise<AIResponse> {
    this.calls.push(input);
    return this.inner.complete(input);
  }
}

describe("Medical Safety boundary (SECURITY_MODEL.md §13)", () => {
  beforeEach(truncateAll);

  it("a message describing a medical emergency triggers the safe fallback and NEVER reaches the AI Provider", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "Med1");
    const spy = new SpyAIProvider();

    const response = await handleCoordinatorInvocation(
      pool,
      {
        requestId: newRequestId(),
        householdId: household.householdId,
        userId: household.userId,
        personId: household.profileId,
        message: "Estou com dor no peito e falta de ar, o que eu faço?",
      },
      { aiProvider: spy, modelId: "test-model" }
    );

    expect(spy.calls).toHaveLength(0); // the LLM was never invoked for this turn
    expect(response.reply).toMatch(/não posso diagnosticar/i);
    expect(response.reply).toMatch(/profissional/i);

    const auditRows = await withHouseholdContext(
      pool,
      { userId: household.userId, householdId: household.householdId },
      (client) =>
        client.query("SELECT event_type, actor_type FROM audit_log WHERE event_type = $1", [
          "health_safety.medical_boundary_triggered",
        ])
    );
    expect(auditRows.rows).toHaveLength(1);
    expect(auditRows.rows[0].actor_type).toBe("system");
  });

  it("asking for a diagnosis or medication dose also triggers the boundary", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "Med2");
    const spy = new SpyAIProvider();

    const response = await handleCoordinatorInvocation(
      pool,
      {
        requestId: newRequestId(),
        householdId: household.householdId,
        userId: household.userId,
        message: "Pode me diagnosticar? Qual o diagnóstico para esses sintomas?",
      },
      { aiProvider: spy, modelId: "test-model" }
    );

    expect(spy.calls).toHaveLength(0);
    expect(response.reply).toMatch(/não posso diagnosticar/i);
  });

  it("an ordinary wellness question DOES reach the AI Provider normally", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "Med3");
    const spy = new SpyAIProvider();

    const response = await handleCoordinatorInvocation(
      pool,
      {
        requestId: newRequestId(),
        householdId: household.householdId,
        userId: household.userId,
        message: "Quais dicas gerais de hidratação você recomenda?",
      },
      { aiProvider: spy, modelId: "test-model" }
    );

    expect(spy.calls).toHaveLength(1);
    expect(response.reply).not.toMatch(/não posso diagnosticar/i);
  });
});
