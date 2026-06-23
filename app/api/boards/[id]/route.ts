import type { NextRequest } from "next/server";
import { handle, apiOk, readJson, HttpError } from "@/lib/http";
import { requireAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import {
  fetchActiveBoardRow,
  fetchAnyBoardRow,
  toFullBoard,
  toFullBoardSafe,
  saveScene,
  COLUMNS,
  type BoardRow,
} from "@/lib/boards";
import { deleteBoardImages } from "@/lib/images";
import {
  validateName,
  expectArray,
  expectObject,
  expectBoolean,
  assertVersion,
} from "@/lib/validate";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/boards/[id] - full owner view of one active board. Requires auth.
export async function GET(req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    requireAuth(req);
    const { id } = await ctx.params;
    const row = await fetchActiveBoardRow(id);
    return apiOk({ board: await toFullBoard(row) });
  });
}

// PUT /api/boards/[id] - full-board replace (editor autosave + import-to-replace).
// Snapshots prior state, bumps scene_version. name/is_public updated in the same write.
export async function PUT(req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    requireAuth(req);
    const { id } = await ctx.params;
    const body = await readJson<{
      name?: unknown;
      elements?: unknown;
      app_state?: unknown;
      files?: unknown;
      is_public?: unknown;
      expected_scene_version?: unknown;
    }>(req);

    const elements = expectArray(body.elements, "elements");
    const appState = expectObject(body.app_state, "app_state");
    const files = expectObject(body.files, "files");
    const cleanName = body.name !== undefined ? validateName(body.name) : undefined;
    if (body.is_public !== undefined) expectBoolean(body.is_public, "is_public");

    const row = await fetchActiveBoardRow(id);
    const expected =
      typeof body.expected_scene_version === "number" ? body.expected_scene_version : undefined;
    assertVersion(body.expected_scene_version, Number(row.scene_version));

    // Scene write first (snapshots + version bump, atomic in save_board_scene[_checked]).
    const newVersion = await saveScene(
      id,
      elements,
      appState,
      files as Record<string, Record<string, unknown>>,
      expected,
    );

    // name / is_public applied only AFTER the scene write succeeds. The scene write is the
    // durable change; if this secondary metadata update fails it is logged but NOT fatal,
    // so we never return an error for an already-committed scene (which would make the
    // client retry and double-bump the version). The re-fetched board reflects reality.
    const meta: Record<string, unknown> = {};
    if (cleanName !== undefined) meta.name = cleanName;
    if (body.is_public !== undefined) meta.is_public = body.is_public;
    if (Object.keys(meta).length > 0) {
      const { error } = await supabase.from("boards").update(meta).eq("id", id);
      if (error) console.warn("[jandraw] PUT metadata update failed (scene already saved):", error);
    }

    // fetchAnyBoardRow (not Active): the scene write already committed, so a concurrent
    // soft-delete in this window must not turn a successful PUT into a misleading 404.
    const fresh = await fetchAnyBoardRow(id);
    const board = await toFullBoardSafe(fresh);
    // Return the version THIS write authored (not a racy re-read that could reflect a
    // concurrent write's higher version and cause the client a spurious 409 next time).
    return apiOk({ board, scene_version: newVersion });
  });
}

// PATCH /api/boards/[id] - metadata only (rename, public toggle, trash/restore).
// No scene write, no snapshot, no version bump.
export async function PATCH(req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    requireAuth(req);
    const { id } = await ctx.params;
    const body = await readJson<{
      name?: unknown;
      is_public?: unknown;
      is_deleted?: unknown;
    }>(req);

    const hasName = body.name !== undefined;
    const hasPublic = body.is_public !== undefined;
    const hasDeleted = body.is_deleted !== undefined;
    if (!hasName && !hasPublic && !hasDeleted) {
      throw new HttpError(
        "bad_request",
        "At least one of name, is_public, is_deleted must be supplied.",
      );
    }

    const update: Record<string, unknown> = {};
    if (hasName) update.name = validateName(body.name);
    if (hasPublic) update.is_public = expectBoolean(body.is_public, "is_public");
    if (hasDeleted) update.is_deleted = expectBoolean(body.is_deleted, "is_deleted");

    // Only an is_deleted change is allowed to reach a soft-deleted (trashed) board.
    const row = hasDeleted ? await fetchAnyBoardRow(id) : await fetchActiveBoardRow(id);
    if (row.is_deleted && (hasName || hasPublic)) {
      // A trashed board may only have its is_deleted flag flipped - not be renamed or
      // re-published - even when those fields are bundled with is_deleted.
      throw new HttpError("not_found", "Board not found.");
    }

    const { data, error } = await supabase
      .from("boards")
      .update(update)
      .eq("id", row.id)
      .select(COLUMNS)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new HttpError("not_found", "Board not found."); // concurrently hard-deleted
    return apiOk({ board: await toFullBoardSafe(data as BoardRow) });
  });
}

// DELETE /api/boards/[id] - soft delete by default; ?hard=1 permanently deletes
// (cascades snapshots, removes Storage objects).
export async function DELETE(req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    requireAuth(req);
    const { id } = await ctx.params;
    const hard = new URL(req.url).searchParams.get("hard");
    if (hard !== null && hard !== "1") {
      throw new HttpError("bad_request", 'hard must be "1" when present.');
    }

    if (hard === "1") {
      const row = await fetchAnyBoardRow(id); // hard delete can target a trash board
      // Delete the row FIRST (snapshots cascade); only then remove Storage objects, so a
      // failed row delete can't leave a live board pointing at already-deleted images.
      const { error } = await supabase.from("boards").delete().eq("id", row.id);
      if (error) throw error;
      // Storage cleanup is best-effort: the row is already gone, and orphaned objects are
      // tolerated (A.7), so a cleanup failure must not turn a successful delete into a 500.
      try {
        await deleteBoardImages(row.id);
      } catch (e) {
        console.warn("[jandraw] hard-delete storage cleanup failed (objects orphaned) for", row.id, e);
      }
      return apiOk({ ok: true, id: row.id, hard: true });
    }

    const row = await fetchActiveBoardRow(id); // soft delete targets an active board
    const { error } = await supabase
      .from("boards")
      .update({ is_deleted: true })
      .eq("id", row.id);
    if (error) throw error;
    return apiOk({ ok: true, id: row.id, hard: false });
  });
}
