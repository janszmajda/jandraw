import type { NextRequest } from "next/server";
import { handle, apiOk, readJson, HttpError } from "@/lib/http";
import { checkSecret, setSessionCookie } from "@/lib/auth";

// POST /api/login — exchange the passphrase for a session cookie. No prior auth.
export async function POST(req: NextRequest) {
  return handle(async () => {
    const body = await readJson<{ secret?: unknown }>(req);
    if (typeof body.secret !== "string") {
      throw new HttpError("bad_request", "secret is required and must be a string.");
    }
    let ok = false;
    try {
      ok = checkSecret(body.secret);
    } catch {
      ok = false; // secret unset/misconfigured → fail closed (401), never 500
    }
    if (!ok) {
      throw new HttpError("unauthenticated", "Wrong passphrase.");
    }
    await setSessionCookie();
    return apiOk({ ok: true });
  });
}
