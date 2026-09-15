import pg from "pg";
const { Pool } = pg;
import { randomUUID } from "node:crypto";
import { runSchedulerTick } from "../src/lib/scheduler/worker";

// The scheduler worker process (ARCHITECTURE.md §9/§11, ADR 018): polls Postgres for due jobs
// and expired leases on a fixed interval, forever. State lives entirely in scheduled_jobs/
// job_runs — this process holds nothing in memory that matters across ticks, so it can be
// killed and restarted (or run as N replicas) without losing or duplicating work.
//
// Usage: DATABASE_URL_ADMIN=... DATABASE_URL_RUNTIME=... npx tsx scripts/scheduler-worker.ts

const POLL_INTERVAL_MS = Number(process.env.SCHEDULER_POLL_INTERVAL_MS ?? 30_000);
const BATCH_SIZE = Number(process.env.SCHEDULER_BATCH_SIZE ?? 20);
const WORKER_ID = process.env.HOSTNAME ? `${process.env.HOSTNAME}:${process.pid}` : `worker:${randomUUID()}`;

async function main() {
  const adminUrl = process.env.DATABASE_URL_ADMIN;
  const runtimeUrl = process.env.DATABASE_URL_RUNTIME;
  if (!adminUrl) throw new Error("DATABASE_URL_ADMIN is not set.");
  if (!runtimeUrl) throw new Error("DATABASE_URL_RUNTIME is not set.");

  // Two distinct pools by design (worker.ts's SchedulerDeps): adminPool is used ONLY for
  // read-only cross-household discovery; every claim/mutation goes through runtimePool with RLS
  // enforced via withHouseholdContext (see worker.ts's module doc for why the discovery step
  // structurally needs cross-household visibility).
  const adminPool = new Pool({ connectionString: adminUrl, max: 5 });
  const runtimePool = new Pool({ connectionString: runtimeUrl, max: 10 });

  console.log(`[scheduler-worker] starting as ${WORKER_ID}, polling every ${POLL_INTERVAL_MS}ms`);

  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    console.log("[scheduler-worker] shutting down after current tick...");
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);

  while (!stopping) {
    try {
      const result = await runSchedulerTick({ runtimePool, adminPool, workerId: WORKER_ID, batchSize: BATCH_SIZE });
      if (result.claimed > 0 || result.reaped > 0) {
        console.log(
          `[scheduler-worker] tick: reaped=${result.reaped} claimed=${result.claimed} succeeded=${result.succeeded} failed=${result.failed} deadLettered=${result.deadLettered}`
        );
      }
    } catch (err) {
      console.error("[scheduler-worker] tick failed:", err);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  await Promise.all([adminPool.end(), runtimePool.end()]);
  console.log("[scheduler-worker] stopped.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
