import type { Pool } from "pg";
import { runWeeklyReview } from "@/lib/agents/weeklyReview";
import type { RitualResult } from "./types";

/** The Monday of the week CONTAINING `from` (not next week's) — this ritual fires Saturday
 * morning, reviewing the week that's wrapping up (same week-boundary convention as
 * nutrition/planningContext.ts's nextMonday: server-local calendar days, not household-tz-aware
 * — an existing Fase 3/5 simplification this phase doesn't need to revisit). */
function currentWeekMonday(from: Date): Date {
  const result = new Date(from);
  const day = result.getDay(); // 0=Sunday..6=Saturday
  const diff = day === 0 ? 6 : day - 1; // days since Monday
  result.setDate(result.getDate() - diff);
  result.setHours(0, 0, 0, 0);
  return result;
}

/**
 * Weekly Planning ritual (Fase 6 §2.3, Saturday 09:00 household-local): drives the Fase 5
 * Weekly Review engine end to end. Human-in-the-loop is inherited for free — runWeeklyReview's
 * composite next-week proposal always lands as an agent_decisions row in PENDING status; this
 * ritual never approves anything itself (SECURITY_MODEL.md §5-6).
 */
export async function processWeeklyPlanningJob(
  pool: Pool,
  params: { householdId: string; userId: string }
): Promise<RitualResult> {
  const weekStartDate = currentWeekMonday(new Date());
  const result = await runWeeklyReview(pool, { householdId: params.householdId, userId: params.userId, weekStartDate });

  const proposalNote =
    result.proposal?.outcome === "proposed"
      ? `proposta composta PENDING gerada (decisionId=${result.proposal.decisionId}) — aguardando aprovação`
      : "sem proposta desta vez (dados de perfil insuficientes para gerar os planos da próxima semana)";

  return {
    summary: `Weekly Planning: revisão da semana de ${result.report.weekStartDate} concluída, ${result.report.deviations.length} desvio(s) identificado(s); ${proposalNote}.`,
    data: {
      weeklyReviewId: result.weeklyReviewId,
      deviations: result.report.deviations,
      decisionId: result.proposal?.outcome === "proposed" ? result.proposal.decisionId : null,
    },
  };
}
