import { NextResponse } from "next/server";
import { z } from "zod";
import { getRuntimePool } from "@/lib/db/pool";
import { requireHouseholdContext, UnauthenticatedError, ForbiddenHouseholdError } from "@/lib/auth/requestContext";
import { newRequestId } from "@/lib/auth/session";
import { handleCoordinatorInvocation } from "@/lib/agents/coordinator";
import { AnthropicProvider } from "@/lib/ai-provider/anthropic";
import { FakeAIProvider } from "@/lib/ai-provider/fake";
import type { AIProvider } from "@/lib/ai-provider/types";

const bodySchema = z.object({
  householdId: z.string().uuid(),
  message: z.string().min(1),
  conversationId: z.string().uuid().optional(),
});

function getProvider(): AIProvider {
  return process.env.ANTHROPIC_API_KEY
    ? new AnthropicProvider(process.env.ANTHROPIC_API_KEY)
    : new FakeAIProvider();
}

export async function POST(req: Request) {
  const cookie = req.headers.get("cookie") ?? "";
  const token = cookie.match(/lifeos_session=([^;]+)/)?.[1];
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  try {
    const { userId, householdId } = await requireHouseholdContext(getRuntimePool(), token, parsed.data.householdId);
    const result = await handleCoordinatorInvocation(
      getRuntimePool(),
      {
        requestId: newRequestId(),
        householdId,
        userId,
        message: parsed.data.message,
        conversationId: parsed.data.conversationId,
      },
      { aiProvider: getProvider(), modelId: "claude-haiku-4-5" }
    );
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof UnauthenticatedError) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    if (err instanceof ForbiddenHouseholdError) return NextResponse.json({ error: "not_found" }, { status: 404 });
    throw err;
  }
}
