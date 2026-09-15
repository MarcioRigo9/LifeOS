/** What a ritual processor hands back to the worker — persisted verbatim into
 * job_runs.result_summary/error_text, never applied as a mutation by the worker itself. */
export interface RitualResult {
  summary: string;
  data?: Record<string, unknown>;
}
