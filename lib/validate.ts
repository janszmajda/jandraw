import { HttpError } from "./http";

// Small request-body validation helpers that throw the right error envelope.

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function badRequest(message: string): never {
  throw new HttpError("bad_request", message);
}

export function validateName(name: unknown): string {
  if (typeof name !== "string" || name.trim().length === 0) {
    badRequest("name is required and must be a non-empty string.");
  }
  if (name.length > 200) {
    badRequest("name must be at most 200 characters.");
  }
  return name;
}

export function expectArray(v: unknown, field: string): unknown[] {
  if (!Array.isArray(v)) badRequest(`${field} must be an array.`);
  return v;
}

export function expectObject(v: unknown, field: string): Record<string, unknown> {
  if (!isPlainObject(v)) badRequest(`${field} must be an object.`);
  return v;
}

export function expectBoolean(v: unknown, field: string): boolean {
  if (typeof v !== "boolean") badRequest(`${field} must be a boolean.`);
  return v;
}

// Optimistic-concurrency check. If the caller supplied expected_scene_version and
// it doesn't match the board's current version, reject with 409 (latest-save-wins
// is the default when it's omitted).
export function assertVersion(expected: unknown, current: number): void {
  if (expected === undefined) return;
  if (typeof expected !== "number") {
    badRequest("expected_scene_version must be a number.");
  }
  if (expected !== current) {
    throw new HttpError(
      "conflict",
      "Scene version mismatch — the board changed since you loaded it.",
    );
  }
}
