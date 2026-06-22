import { supabase } from "./supabase";
import { extractAndStoreImages, rehydrateImages } from "./images";
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
  created_at: string;
  updated_at: string;
};

export type BoardSummary = Omit<FullBoard, "elements" | "app_state" | "files">;

const COLUMNS =
  "id,name,elements,app_state,files,is_public,share_token,is_deleted,scene_version,created_at,updated_at";
const SUMMARY_COLUMNS =
  "id,name,is_public,share_token,is_deleted,scene_version,created_at,updated_at";

// Map a DB row to the full board returned by reads — files rehydrated to inline
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
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function toSummary(row: Omit<BoardRow, "elements" | "app_state" | "files">): BoardSummary {
  return {
    id: row.id,
    name: row.name,
    is_public: row.is_public,
    share_token: row.share_token,
    is_deleted: row.is_deleted,
    scene_version: Number(row.scene_version),
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
): Promise<number> {
  const storedFiles = await extractAndStoreImages(id, files ?? {});
  const cleanAppState = sanitizeAppState(appState as Record<string, unknown>);
  const { data, error } = await supabase.rpc("save_board_scene", {
    p_id: id,
    p_elements: Array.isArray(elements) ? elements : [],
    p_app_state: cleanAppState,
    p_files: storedFiles,
  });
  if (error) throw error;
  if (data === null || data === undefined) {
    throw new HttpError("not_found", "Board not found.");
  }
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
    const stored = await extractAndStoreImages(row.id, files);
    const { data, error } = await supabase
      .from("boards")
      .update({ files: stored })
      .eq("id", row.id)
      .select(COLUMNS)
      .single();
    if (error) throw error;
    row = data as BoardRow;
  }

  return toFullBoard(row);
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
