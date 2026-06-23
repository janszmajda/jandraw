import { supabase } from "./supabase";
import { extractAndStoreImages, rehydrateImages, deleteBoardImages } from "./images";
import { sanitizeAppState } from "./appState";
import { slugify, randomToken, randomSuffix } from "./slug";
import { HttpError } from "./http";

// Shared board persistence helpers used by the route handlers.

export type BoardRow = {
  id: string;
  name: string;
  elements: unknown;
  app_state: unknown;
  files: Record<string, Record<string, unknown>>;
  is_public: boolean;
  share_token: string;
  is_deleted: boolean;
  scene_version: number | string;
  tags: string[];
  created_at: string;
  updated_at: string;
};

export type FullBoard = {
  id: string;
  name: string;
  elements: unknown[];
  app_state: Record<string, unknown>;
  files: Record<string, unknown>;
  is_public: boolean;
  share_token: string;
  is_deleted: boolean;
  scene_version: number;
  tags: string[];
  created_at: string;
  updated_at: string;
};

export type BoardSummary = Omit<FullBoard, "elements" | "app_state" | "files">;

const COLUMNS =
  "id,name,elements,app_state,files,is_public,share_token,is_deleted,scene_version,tags,created_at,updated_at";
const SUMMARY_COLUMNS =
  "id,name,is_public,share_token,is_deleted,scene_version,tags,created_at,updated_at";

// Map a DB row to the full board returned by reads - files rehydrated to inline
// dataURLs, scene_version coerced from bigint to a plain JS number.
export async function toFullBoard(row: BoardRow): Promise<FullBoard> {
  return {
    id: row.id,
    name: row.name,
    elements: Array.isArray(row.elements) ? row.elements : [],
    app_state:
      row.app_state && typeof row.app_state === "object"
        ? (row.app_state as Record<string, unknown>)
        : {},
    files: await rehydrateImages(row.id, row.files ?? {}),
    is_public: row.is_public,
    share_token: row.share_token,
    is_deleted: row.is_deleted,
    scene_version: Number(row.scene_version),
    tags: Array.isArray(row.tags) ? row.tags : [],
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// Like toFullBoard but never throws on a rehydrate failure - used to build the response
// AFTER a committed write so a transient Storage blip can't turn a successful write into a
// 500 (which would make the client retry and double-commit). Degrades to reference-only files.
export async function toFullBoardSafe(row: BoardRow): Promise<FullBoard> {
  try {
    return await toFullBoard(row);
  } catch (e) {
    console.warn("[jandraw] building response: rehydrate failed; returning reference-only files:", e);
    return {
      id: row.id,
      name: row.name,
      elements: Array.isArray(row.elements) ? row.elements : [],
      app_state:
        row.app_state && typeof row.app_state === "object"
          ? (row.app_state as Record<string, unknown>)
          : {},
      files: (row.files ?? {}) as Record<string, unknown>,
      is_public: row.is_public,
      share_token: row.share_token,
      is_deleted: row.is_deleted,
      scene_version: Number(row.scene_version),
      tags: Array.isArray(row.tags) ? row.tags : [],
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
}

export function toSummary(row: Omit<BoardRow, "elements" | "app_state" | "files">): BoardSummary {
  return {
    id: row.id,
    name: row.name,
    is_public: row.is_public,
    share_token: row.share_token,
    is_deleted: row.is_deleted,
    scene_version: Number(row.scene_version),
    tags: Array.isArray(row.tags) ? row.tags : [],
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// Fetch an ACTIVE board row (404 if missing or soft-deleted). Used by GET/PUT,
// element ops, snapshots, restore, export, rotate-token.
export async function fetchActiveBoardRow(id: string): Promise<BoardRow> {
  const { data, error } = await supabase
    .from("boards")
    .select(COLUMNS)
    .eq("id", id)
    .eq("is_deleted", false)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError("not_found", "Board not found.");
  return data as BoardRow;
}

// Fetch a board row regardless of soft-delete state (PATCH restore, hard delete).
export async function fetchAnyBoardRow(id: string): Promise<BoardRow> {
  const { data, error } = await supabase
    .from("boards")
    .select(COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError("not_found", "Board not found.");
  return data as BoardRow;
}

// One scene write = snapshot prior state + overwrite + bump version, atomic in the
// DB via save_board_scene (A.8). Images are stored and app_state sanitized first.
// Returns the new scene_version. Throws 404 if the board no longer exists.
export async function saveScene(
  id: string,
  elements: unknown[],
  appState: unknown,
  files: Record<string, Record<string, unknown>>,
  expectedVersion?: number,
): Promise<number> {
  const storedFiles = await extractAndStoreImages(id, files ?? {});
  const cleanAppState = sanitizeAppState(appState as Record<string, unknown>);
  const els = Array.isArray(elements) ? elements : [];

  // When the caller supplies expected_scene_version, do the compare-and-bump
  // atomically in save_board_scene_checked (closes the read-then-write race that a
  // pre-flight check alone can't). Falls back to the plain save if that function
  // isn't installed yet (migration in mcp/../ docs); the route's pre-flight
  // assertVersion still rejects the common stale case.
  if (typeof expectedVersion === "number") {
    const { data, error } = await supabase.rpc("save_board_scene_checked", {
      p_id: id,
      p_elements: els,
      p_app_state: cleanAppState,
      p_files: storedFiles,
      p_expected_version: expectedVersion,
    });
    if (error) {
      if (typeof error.message === "string" && error.message.includes("jandraw_version_conflict")) {
        throw new HttpError(
          "conflict",
          "Scene version mismatch - the board changed since you loaded it.",
        );
      }
      // "Function not installed" can surface as Postgres 42883 OR PostgREST's PGRST202
      // schema-cache miss - treat either as the signal to fall back to the plain save.
      const code = (error as { code?: string }).code;
      const notInstalled =
        code === "42883" ||
        code === "PGRST202" ||
        (typeof error.message === "string" &&
          /schema cache|could not find the function/i.test(error.message));
      if (!notInstalled) throw error;
      // Atomic check function not installed: fall back to the plain save so the documented
      // 200/409 contract holds (the route's pre-flight assertVersion already rejected the
      // common stale case). Full atomicity returns once db/2026-06-22-atomic-version-check.sql
      // is run; single-user latest-wins makes the residual race a non-issue meanwhile.
      console.warn(
        "[jandraw] save_board_scene_checked not installed; expected_scene_version uses the pre-flight check only. Run db/2026-06-22-atomic-version-check.sql for the atomic guard.",
      );
      // fall through to the plain save_board_scene below
    } else {
      if (data === null || data === undefined) throw new HttpError("not_found", "Board not found.");
      return Number(data);
    }
  }

  const { data, error } = await supabase.rpc("save_board_scene", {
    p_id: id,
    p_elements: els,
    p_app_state: cleanAppState,
    p_files: storedFiles,
  });
  if (error) throw error;
  if (data === null || data === undefined) throw new HttpError("not_found", "Board not found.");
  return Number(data);
}

export type CreateBoardInput = {
  name: string;
  elements?: unknown[];
  app_state?: unknown;
  files?: Record<string, Record<string, unknown>>;
  is_public?: boolean;
};

type InsertResult =
  | { ok: true; row: BoardRow }
  | { ok: false; code: string | undefined; error: unknown };

async function tryInsert(
  id: string,
  name: string,
  elements: unknown[],
  appState: Record<string, unknown>,
  isPublic: boolean,
): Promise<InsertResult> {
  const { data, error } = await supabase
    .from("boards")
    .insert({
      id,
      name,
      elements,
      app_state: appState,
      files: {},
      is_public: isPublic,
      share_token: randomToken(),
      is_deleted: false,
      scene_version: 0,
    })
    .select(COLUMNS)
    .single();
  if (!error) return { ok: true, row: data as BoardRow };
  return { ok: false, code: (error as { code?: string }).code, error };
}

// Create a new board. Slug is derived from name; on a unique-violation the server
// retries base, -2..-5, then a random 6-char suffix, else 409 (no pre-check SELECT,
// to avoid a check-then-insert race). Images are stored under the final id after
// insert (the id is unknown until the insert wins the slug race).
export async function createBoard(input: CreateBoardInput): Promise<FullBoard> {
  const base = slugify(input.name);
  const elements = Array.isArray(input.elements) ? input.elements : [];
  const appState = sanitizeAppState(input.app_state as Record<string, unknown>);
  const isPublic = input.is_public === undefined ? true : !!input.is_public;

  const candidates = [base, `${base}-2`, `${base}-3`, `${base}-4`, `${base}-5`];
  let row: BoardRow | null = null;

  for (const candidate of candidates) {
    const res = await tryInsert(candidate, input.name, elements, appState, isPublic);
    if (res.ok) {
      row = res.row;
      break;
    }
    if (res.code !== "23505") throw res.error; // a real error, not a slug collision
  }

  if (!row) {
    const candidate = `${base}-${randomSuffix(6)}`;
    const res = await tryInsert(candidate, input.name, elements, appState, isPublic);
    if (res.ok) row = res.row;
    else if (res.code === "23505")
      throw new HttpError("conflict", "Could not generate a unique board id.");
    else throw res.error;
  }

  // Now that the final id is known, store any inline images and persist refs.
  const files = input.files ?? {};
  if (files && Object.keys(files).length > 0) {
    try {
      const stored = await extractAndStoreImages(row.id, files);
      const { data, error } = await supabase
        .from("boards")
        .update({ files: stored })
        .eq("id", row.id)
        .select(COLUMNS)
        .single();
      if (error) throw error;
      row = data as BoardRow;
    } catch (e) {
      // Roll back the just-inserted row (and any uploaded objects) so a failed create
      // persists nothing - the error returned to the client then matches reality. Swallow
      // the rollback delete's own outcome so the ORIGINAL error always surfaces.
      const rid = row.id; // capture (row is non-null here) for use inside the async closures
      await deleteBoardImages(rid).catch(() => {});
      await supabase
        .from("boards")
        .delete()
        .eq("id", rid)
        .then(
          () => {},
          (delErr) =>
            console.error("[jandraw] createBoard rollback delete failed; orphaned row", rid, delErr),
        );
      throw e;
    }
  }

  // toFullBoardSafe (not toFullBoard): the board is already committed, so a transient
  // Storage read-back blip must degrade to reference-only files, not 500 the create.
  return toFullBoardSafe(row);
}

// Rotate a board's share token (kills the old /v link). No snapshot, no version bump.
export async function rotateShareToken(id: string): Promise<string> {
  await fetchActiveBoardRow(id); // 404 if missing / soft-deleted
  const newToken = randomToken();
  const { error } = await supabase
    .from("boards")
    .update({ share_token: newToken })
    .eq("id", id);
  if (error) throw error;
  return newToken;
}

export { COLUMNS, SUMMARY_COLUMNS };
