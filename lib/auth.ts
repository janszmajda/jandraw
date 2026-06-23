import "server-only";
import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { HttpError } from "./http";

// Auth model (section 6 / B): a single secret, JANDRAW_EDIT_SECRET, gates editing
// and all writes. A request is authed by EITHER a valid signed session cookie OR an
// `Authorization: Bearer <secret>` header. The cookie is a hand-built HMAC (no auth
// library): value = `<issuedAtMs>.<base64url(HMAC_SHA256("jandraw.v1.<issuedAtMs>", secret))>`.

export const SESSION_COOKIE = "jandraw_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // ~30 days
const MAX_AGE_MS = MAX_AGE_SECONDS * 1000;
const PAYLOAD_PREFIX = "jandraw.v1.";

function getSecret(): string {
  const s = process.env.JANDRAW_EDIT_SECRET;
  if (!s || !s.trim()) {
    throw new Error("Jandraw: JANDRAW_EDIT_SECRET must be set (see .env.local).");
  }
  // Trim once here so all three consumers (login compare, bearer compare which also
  // trims the candidate, and HMAC signing) agree even if the env value picked up a
  // stray trailing newline/space.
  return s.trim();
}

// Timing-safe string comparison with a length guard (lengths differing is itself
// information, but we still avoid early-exit content comparison).
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

// Compare a candidate passphrase / bearer token to the secret, timing-safe.
export function checkSecret(candidate: unknown): boolean {
  if (typeof candidate !== "string" || candidate.length === 0) return false;
  return safeEqual(candidate, getSecret());
}

function signature(issuedAtMs: number): Buffer {
  return createHmac("sha256", getSecret())
    .update(PAYLOAD_PREFIX + issuedAtMs)
    .digest();
}

export function createSessionValue(now: number = Date.now()): string {
  return `${now}.${signature(now).toString("base64url")}`;
}

export function verifySessionValue(
  value: string | undefined | null,
  now: number = Date.now(),
): boolean {
  if (!value) return false;
  const dot = value.indexOf(".");
  if (dot <= 0 || dot === value.length - 1) return false;

  const issuedAt = Number(value.slice(0, dot));
  if (!Number.isFinite(issuedAt) || issuedAt <= 0) return false;
  if (now - issuedAt > MAX_AGE_MS) return false; // expired (>30 days old)
  // (No future-skew rejection: an HMAC over a future issuedAt is harmless, and rejecting it
  // would invalidate valid cookies after a backward server-clock correction. Expiry above
  // already bounds the lifetime.)

  let provided: Buffer;
  try {
    provided = Buffer.from(value.slice(dot + 1), "base64url");
  } catch {
    return false;
  }
  const expected = signature(issuedAt);
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

// Read the bearer token out of an Authorization header, if present.
function bearerToken(req: NextRequest): string | null {
  const authz = req.headers.get("authorization");
  if (!authz) return null;
  const m = /^Bearer\s+(.+)$/i.exec(authz.trim());
  return m ? m[1].trim() : null;
}

// Is this request authenticated (cookie OR bearer)? Checked bearer-first.
export function isAuthed(req: NextRequest, now: number = Date.now()): boolean {
  // Fail closed like the page gate: if the secret is unset/misconfigured (getSecret
  // throws), treat the request as unauthenticated (401) rather than letting it 500.
  try {
    const token = bearerToken(req);
    if (token && checkSecret(token)) return true;
    const cookie = req.cookies.get(SESSION_COOKIE)?.value;
    return verifySessionValue(cookie, now);
  } catch {
    return false;
  }
}

// Throw a 401 unless the request is authenticated.
export function requireAuth(req: NextRequest): void {
  if (!isAuthed(req)) {
    throw new HttpError("unauthenticated", "Authentication required.");
  }
}

// For server components (page-level gating): the browser only carries the cookie
// on navigations, so a cookie check is the right gate for pages.
export async function isAuthedFromCookies(): Promise<boolean> {
  // Fail closed: if the secret is unset/misconfigured (getSecret throws inside
  // verifySessionValue), treat the request as unauthenticated so the page redirects
  // to /login instead of 500-ing - and /login itself stays reachable.
  try {
    const store = await cookies();
    return verifySessionValue(store.get(SESSION_COOKIE)?.value);
  } catch {
    return false;
  }
}

export async function setSessionCookie(now: number = Date.now()): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, createSessionValue(now), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}
