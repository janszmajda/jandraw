import type { NextRequest } from "next/server";
import { handle, apiOk, HttpError } from "@/lib/http";
import { requireAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { fetchActiveBoardRow } from "@/lib/boards";

type Ctx = { params: Promise<{ id: string }> };

type SnapshotRow = { id: string; board_id: string; scene_version: number | string; created_at: string };

// GET /api/boards/[id]/snapshots - history list, newest first. Heavy fields omitted.
export async function GET(req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    requireAuth(req);
    const { id } = await ctx.params;

    const limitParam = new URL(req.url).searchParams.get("limit");
    let limit = 50;
    if (limitParam !== null) {
      const n = Number(limitParam);
      if (!Number.isInteger(n) || n <= 0) {
        throw new HttpError("bad_request", "limit must be a positive integer.");
      }
      limit = Math.min(n, 50);
    }

    await fetchActiveBoardRow(id); // 404 if missing / soft-deleted

    const { data, error } = await supabase
      .from("board_snapshots")
      .select("id,board_id,scene_version,created_at")
      .eq("board_id", id)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;

    const snapshots = ((data ?? []) as SnapshotRow[]).map((s) => ({
      id: s.id,
      board_id: s.board_id,
      scene_version: Number(s.scene_version),
      created_at: s.created_at,
    }));
    return apiOk({ snapshots });
  });
}
