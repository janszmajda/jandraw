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
    if (!checkSecret(body.secret)) {
      throw new HttpError("unauthenticated", "Wrong passphrase.");
    }
    await setSessionCookie();
    return apiOk({ ok: true });
  });
}
