import type { NextRequest } from "next/server";
import { handle, apiOk } from "@/lib/http";
import { requireAuth, clearSessionCookie } from "@/lib/auth";

// POST /api/logout — clear the session cookie. Requires auth.
export async function POST(req: NextRequest) {
  return handle(async () => {
    requireAuth(req);
    await clearSessionCookie();
    return apiOk({ ok: true });
  });
}
