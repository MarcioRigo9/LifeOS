import { NextResponse } from "next/server";
import { z } from "zod";
import { getRuntimePool } from "@/lib/db/pool";
import { signupHousehold } from "@/lib/auth/signup";
import { createSession } from "@/lib/auth/session";

const bodySchema = z.object({
  householdName: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  displayName: z.string().min(1),
});

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });
  }

  const pool = getRuntimePool();
  const { householdId, userId } = await signupHousehold(pool, parsed.data);
  const session = await createSession(pool, userId);

  const res = NextResponse.json({ householdId, userId }, { status: 201 });
  res.cookies.set("lifeos_session", session.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    expires: session.expiresAt,
    path: "/",
  });
  return res;
}
