export interface ActionEnvelopeLike {
  actionType: string;
  actionPayload: Record<string, unknown>;
  targetEntityIds: string[];
  scope: { entityCount: number; reversible: boolean; financialImpactCents?: number };
}

const ACTION_LABELS: Record<string, string> = {
  "meal_plan.activate": "Ativar plano alimentar",
  "workout_plan.activate": "Ativar plano de treino",
  "composite.activate_plans": "Ativar plano alimentar + plano de treino",
  "goal.update_target": "Atualizar meta",
  "goal.delete": "Excluir meta",
  "profile.update_sensitive": "Atualizar dado sensível do perfil",
};

export function decisionTitle(actionType: string): string {
  return ACTION_LABELS[actionType] ?? actionType;
}

export function decisionSummary(envelope: ActionEnvelopeLike): string {
  const count = envelope.scope?.entityCount ?? envelope.targetEntityIds?.length ?? 1;
  const entities = count === 1 ? "1 item afetado" : `${count} itens afetados`;
  const reversible = envelope.scope?.reversible ? "reversível" : "não reversível";
  return `${entities} · ${reversible}`;
}
