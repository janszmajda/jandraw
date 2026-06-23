import { randomBytes } from "crypto";

// Slug generation (POST /api/boards): lowercase, trim, replace any run of
// non-alphanumeric characters with a single hyphen, strip leading/trailing
// hyphens. An empty result falls back to "board".
export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "board";
}

// Random, unguessable share token for the /v/[token] view link. base64url of
// 12 bytes ~ 16 url-safe chars.
export function randomToken(): string {
  return randomBytes(12).toString("base64url");
}

// Short random suffix used as the last-resort slug disambiguator.
export function randomSuffix(len = 6): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const buf = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[buf[i] % alphabet.length];
  return out;
}
