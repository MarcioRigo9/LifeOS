import { NextResponse } from "next/server";
import { getRuntimePool } from "@/lib/db/pool";
import { revokeSession } from "@/lib/auth/session";

export async function POST(req: Request) {
  const cookie = req.headers.get("cookie") ?? "";
  const match = cookie.match(/lifeos_session=([^;]+)/);
  if (match) {
    await revokeSession(getRuntimePool(), match[1]);
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.delete("lifeos_session");
  return res;
}
