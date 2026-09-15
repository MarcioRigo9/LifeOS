-- scheduled_jobs, job_runs (ADR 018, ADR 021), agent_runs (AGENT_CONTRACTS.md §12)
-- Schema only in Fase 1 — the polling worker itself is Fase 6 (PHASE_1_SPEC.md §2-3).

CREATE TABLE scheduled_jobs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id       uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  kind               text NOT NULL,
  cron_expr          text NOT NULL,
  timezone           text NOT NULL,
  next_run_at        timestamptz NOT NULL,
  status             text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'dead_letter', 'disabled')),
  attempts           integer NOT NULL DEFAULT 0,
  max_attempts       integer NOT NULL DEFAULT 5,
  lease_expires_at   timestamptz,
  locked_by          text,
  idempotency_key    text NOT NULL
);
CREATE INDEX scheduled_jobs_household_id_idx ON scheduled_jobs (household_id);
CREATE INDEX scheduled_jobs_claim_idx ON scheduled_jobs (status, lease_expires_at);
CREATE UNIQUE INDEX scheduled_jobs_idempotency_key_unique ON scheduled_jobs (idempotency_key);

ALTER TABLE scheduled_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY scheduled_jobs_household_scope ON scheduled_jobs
  USING (household_id = app_household_id())
  WITH CHECK (household_id = app_household_id());

CREATE TABLE job_runs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id      uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  scheduled_job_id  uuid NOT NULL REFERENCES scheduled_jobs(id) ON DELETE CASCADE,
  started_at        timestamptz NOT NULL DEFAULT now(),
  finished_at       timestamptz,
  status            text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'succeeded', 'failed')),
  result_summary    text,
  request_id        uuid NOT NULL
);
CREATE INDEX job_runs_scheduled_job_id_idx ON job_runs (scheduled_job_id);

ALTER TABLE job_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY job_runs_household_scope ON job_runs
  USING (household_id = app_household_id())
  WITH CHECK (household_id = app_household_id());

CREATE TABLE agent_runs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id      uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  request_id        uuid NOT NULL,
  conversation_id   uuid REFERENCES conversations(id) ON DELETE SET NULL,
  job_run_id        uuid REFERENCES job_runs(id) ON DELETE SET NULL,
  agent_id          uuid NOT NULL REFERENCES agents(id),
  started_at        timestamptz NOT NULL DEFAULT now(),
  finished_at       timestamptz,
  result_json       jsonb,
  token_usage_json  jsonb,
  cost_cents        integer,
  model_id          text,
  prompt_version    text,
  status             text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'proposed', 'failed', 'timeout')),
  CONSTRAINT agent_runs_origin_chk CHECK (conversation_id IS NOT NULL OR job_run_id IS NOT NULL)
);
CREATE INDEX agent_runs_household_id_idx ON agent_runs (household_id, started_at DESC);

ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY agent_runs_household_scope ON agent_runs
  USING (household_id = app_household_id())
  WITH CHECK (household_id = app_household_id());
