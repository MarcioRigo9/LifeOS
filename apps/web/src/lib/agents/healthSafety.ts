// SECURITY_MODEL.md §13: wellness vs. health-sensitive vs. medical. "Detecção inicial pode ser
// por palavras-chave determinísticas, não só julgamento do LLM" — this classifier runs BEFORE
// the AI Provider is ever called, so a medical-boundary message never reaches the LLM asking
// it to diagnose/prescribe; it short-circuits to a fixed, safe reply instead.

export type HealthSafetyTier = "wellness" | "health-sensitive" | "medical";

// Deliberately conservative (biased toward over-flagging as "medical") — a false positive costs
// a slightly-too-cautious canned reply; a false negative could mean the system attempts to
// diagnose or prescribe, which SECURITY_MODEL.md §13 never allows. Starting list for Fase 2,
// expected to grow — not exhaustive by design (see IMPLEMENTATION_RULES.md #31).
const MEDICAL_PATTERNS: RegExp[] = [
  /\bdor no peito\b/i,
  /\bfalta de ar\b/i,
  /\bdific\w* (para|de) respirar\b/i,
  /\bsangrament\w+\b/i,
  /\bdesmai\w+\b/i,
  /\bconvuls[ãa]o\b/i,
  /\bavc\b/i,
  /\binfarto\b/i,
  /\bsuic[íi]d\w*/i,
  /\bme (diagnostiqu|diagnostica)/i,
  /\bqual (o )?diagn[óo]stico\b/i,
  /\bque rem[ée]dio (eu )?(devo|posso) tomar\b/i,
  /\bqual (a )?dose (de|do|da)\b/i,
  /\bposso tomar\b.*\b(mg|miligramas|comprimido|cápsula)\b/i,
  /\breceita m[ée]dica\b/i,
  /\bfebre alta\b/i,
  /\bsuspeita de (fratura|c[âa]ncer|tumor)\b/i,
  /\bdiagnostique\b/i,
];

const HEALTH_SENSITIVE_PATTERNS: RegExp[] = [
  /\bperdendo peso (rápido|r[áa]pido)\b/i,
  /\bcansaç?o\b/i,
  /\bestress\w*/i,
  /\bsono\b/i,
  /\benergia\b/i,
  /\btend[êe]ncia\b/i,
];

export function classifyHealthSafety(message: string): HealthSafetyTier {
  if (MEDICAL_PATTERNS.some((p) => p.test(message))) return "medical";
  if (HEALTH_SENSITIVE_PATTERNS.some((p) => p.test(message))) return "health-sensitive";
  return "wellness";
}

export const MEDICAL_BOUNDARY_FALLBACK_REPLY =
  "Não posso diagnosticar sintomas, indicar medicação ou substituir uma avaliação médica. " +
  "Pelo que você descreveu, recomendo procurar um profissional de saúde — presencialmente ou, " +
  "se for uma emergência, os serviços de emergência da sua região. Posso ajudar organizando " +
  "informações para essa consulta (histórico, medidas recentes) se for útil.";
