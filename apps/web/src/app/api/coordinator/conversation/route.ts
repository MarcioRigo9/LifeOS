import { NextResponse } from "next/server";
import { z } from "zod";
import { getRuntimePool, withHouseholdContext } from "@/lib/db/pool";
import { requireHouseholdContext, UnauthenticatedError, ForbiddenHouseholdError } from "@/lib/auth/requestContext";
import { getSessionToken } from "@/lib/auth/requestToken";

const querySchema = z.object({ householdId: z.string().uuid() });

/** Loads the household's most recent conversation and its message history — handleCoordinatorInvocation
 * (agents/coordinator.ts) only ever returns the LATEST reply, so the chat UI needs this
 * separately to render everything said so far. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = querySchema.safeParse({ householdId: url.searchParams.get("householdId") });
  if (!parsed.success) return NextResponse.json({ error: "invalid_query" }, { status: 400 });

  try {
    const { userId, householdId } = await requireHouseholdContext(getRuntimePool(), getSessionToken(req), parsed.data.householdId);

    const result = await withHouseholdContext(getRuntimePool(), { userId, householdId }, async (client) => {
      const convRes = await client.query<{ id: string }>(
        "SELECT id FROM conversations WHERE household_id = $1 ORDER BY started_at DESC LIMIT 1",
        [householdId]
      );
      const conversationId = convRes.rows[0]?.id ?? null;
      if (!conversationId) return { conversationId: null, messages: [] as unknown[] };

      const messages = await client.query(
        `SELECT m.id, m.role, m.content, m.created_at, a.display_name AS agent_name
         FROM messages m LEFT JOIN agents a ON a.id = m.agent_id
         WHERE m.conversation_id = $1 ORDER BY m.created_at ASC LIMIT 200`,
        [conversationId]
      );
      return { conversationId, messages: messages.rows };
    });

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof UnauthenticatedError) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    if (err instanceof ForbiddenHouseholdError) return NextResponse.json({ error: "not_found" }, { status: 404 });
    throw err;
  }
}
