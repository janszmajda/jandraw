import type { NextRequest } from "next/server";
import { handle, apiOk } from "@/lib/http";
import { requireAuth } from "@/lib/auth";
import { rotateShareToken } from "@/lib/boards";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/boards/[id]/rotate-token — issue a fresh share token, killing old links.
export async function POST(req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    requireAuth(req);
    const { id } = await ctx.params;
    const share_token = await rotateShareToken(id);
    return apiOk({ share_token });
  });
}
