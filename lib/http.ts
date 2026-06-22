import { NextResponse, type NextRequest } from "next/server";

// Single error envelope used across the API (section B):
//   { "error": { "code": "string", "message": "string" } }

export type ErrorCode =
  | "bad_request"
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "server_error";

const STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  server_error: 500,
};

// Thrown anywhere in a request's call stack; the `route` wrapper turns it into
// the proper error envelope + status.
export class HttpError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function apiError(code: ErrorCode, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status: STATUS[code] });
}

export function apiOk(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

// Parse a JSON request body, mapping malformed JSON to a 400.
export async function readJson<T = unknown>(req: NextRequest): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError("bad_request", "Request body must be valid JSON.");
  }
}

// Runs a route handler body in a try/catch so a thrown HttpError becomes the error
// envelope with the right status, and any other throw becomes a logged 500. Used
// inside standard handlers: `export async function GET(req, ctx) { return handle(async () => {...}) }`.
export async function handle(
  fn: () => Promise<Response> | Response,
): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof HttpError) return apiError(e.code, e.message);
    console.error("[jandraw] unhandled route error:", e);
    return apiError("server_error", "Something went wrong.");
  }
}
