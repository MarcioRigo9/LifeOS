import { NextResponse } from "next/server";
import { z } from "zod";
import { getRuntimePool } from "@/lib/db/pool";
import { findUserByEmail } from "@/lib/auth/users";
import { verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";

const bodySchema = z.object({ email: z.string().email(), password: z.string() });

// SECURITY_MODEL.md §2: rate limiting per IP and per account. In-memory limiter is sufficient
// for a two-user household app in Fase 1 — a distributed limiter would be overengineering
// (IMPLEMENTATION_RULES.md #27).
const attempts = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

function rateLimited(key: string): boolean {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > MAX_ATTEMPTS;
}

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const ip = req.headers.get("x-forwarded-for") ?? "unknown";
  if (rateLimited(`ip:${ip}`) || rateLimited(`email:${parsed.data.email}`)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const pool = getRuntimePool();
  const user = await findUserByEmail(pool, parsed.data.email);
  if (!user || !(await verifyPassword(parsed.data.password, user.password_hash))) {
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }

  const session = await createSession(pool, user.id);
  const res = NextResponse.json({ userId: user.id }, { status: 200 });
  res.cookies.set("lifeos_session", session.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    expires: session.expiresAt,
    path: "/",
  });
  return res;
}
