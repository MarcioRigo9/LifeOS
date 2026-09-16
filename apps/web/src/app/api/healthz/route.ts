import { NextResponse } from "next/server";
import { getRuntimePool } from "@/lib/db/pool";

/**
 * Infra healthcheck — not a domain route (deliberately NOT under /api/health/*, which already
 * names the measurements/history endpoints). Used by the Docker healthcheck and, optionally, a
 * Caddy/uptime monitor upstream check. Confirms the process is up AND the runtime role can
 * actually reach Postgres (a "the container started" state is not the same as "ready to serve
 * requests" — SELECT 1 catches a still-starting or unreachable database).
 */
export async function GET() {
  try {
    await getRuntimePool().query("SELECT 1");
    return NextResponse.json({ status: "ok" }, { status: 200 });
  } catch (err) {
    return NextResponse.json({ status: "error", message: err instanceof Error ? err.message : String(err) }, { status: 503 });
  }
}
