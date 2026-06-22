import type { NextRequest } from "next/server";
import { handle, apiOk, HttpError } from "@/lib/http";
import { requireAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { fetchActiveBoardRow, toFullBoard, saveScene } from "@/lib/boards";

type Ctx = { params: Promise<{ id: string; snapId: string }> };

type SnapshotScene = {
  board_id: string;
  elements: unknown;
  app_state: unknown;
  files: Record<string, Record<string, unknown>>;
};

// POST /api/boards/[id]/restore/[snapId] — restore a snapshot. The current state is
// snapshotted first (via save_board_scene), so a restore is itself undoable.
export async function POST(req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    requireAuth(req);
    const { id, snapId } = await ctx.params;

    await fetchActiveBoardRow(id); // 404 if board missing / soft-deleted

    const { data, error } = await supabase
      .from("board_snapshots")
      .select("board_id,elements,app_state,files")
      .eq("id", snapId)
      .maybeSingle();
    if (error) throw error;
    const snap = data as SnapshotScene | null;
    if (!snap || snap.board_id !== id) {
      throw new HttpError("not_found", "Snapshot not found for this board.");
    }

    const version = await saveScene(
      id,
      Array.isArray(snap.elements) ? snap.elements : [],
      snap.app_state,
      snap.files ?? {},
    );
    const fresh = await fetchActiveBoardRow(id);
    return apiOk({ scene_version: version, board: await toFullBoard(fresh) });
  });
}
