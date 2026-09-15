-- Fase 6 (Automation): columns the actual polling worker needs. The core shape
-- (scheduled_jobs/job_runs, claim-friendly columns, RLS) already exists since Fase 1
-- (0007_scheduler_and_runs.sql, ADR 018/021, ARCHITECTURE.md §9) — this adds what running
-- (not just defining) jobs requires: bookkeeping columns, exponential-backoff config, and the
-- index the actual claim query filters on.

ALTER TABLE scheduled_jobs ADD COLUMN last_run_at timestamptz;
ALTER TABLE scheduled_jobs ADD COLUMN backoff_base_seconds integer NOT NULL DEFAULT 30 CHECK (backoff_base_seconds > 0);
ALTER TABLE scheduled_jobs ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
CREATE TRIGGER scheduled_jobs_set_updated_at BEFORE UPDATE ON scheduled_jobs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- scheduled_jobs_claim_idx (status, lease_expires_at) from 0007 serves the reaper's query
-- (status='running' AND lease_expires_at<now()). The claim query itself filters on
-- (status='pending' AND next_run_at<=now()) — a different composite, needs its own index.
CREATE INDEX scheduled_jobs_next_run_idx ON scheduled_jobs (status, next_run_at);

-- Which attempt number this particular execution record represents (scheduled_jobs.attempts
-- tracks the job DEFINITION's running failure count; this is the per-run snapshot at claim
-- time — lets a test/operator see "attempt 2 of 3" directly on the job_runs row).
ALTER TABLE job_runs ADD COLUMN attempt integer NOT NULL DEFAULT 1 CHECK (attempt > 0);
ALTER TABLE job_runs ADD COLUMN error_text text;
