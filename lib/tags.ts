// The known board tags. Shared by the server (validation, lib/validate.ts) and the
// client dashboard (lib/_components/Dashboard.tsx), so this module must stay free of
// `server-only` imports. To add or rename a tag, edit this list - everything else
// (validation, filtering, the UI chips) derives from it.

export const BOARD_TAGS = ["Jan", "Julia"] as const;

export type BoardTag = (typeof BOARD_TAGS)[number];

export function isBoardTag(v: unknown): v is BoardTag {
  return typeof v === "string" && (BOARD_TAGS as readonly string[]).includes(v);
}
