import type { NextRequest } from "next/server";
import { handle, apiOk, HttpError } from "@/lib/http";
import { supabase } from "@/lib/supabase";
import { COLUMNS, type BoardRow } from "@/lib/boards";
import { rehydrateImages } from "@/lib/images";

type Ctx = { params: Promise<{ token: string }> };

// GET /api/view/[token] - read-only public scene by share token. No auth.
// A single 404 covers unknown token / private / soft-deleted so existence never leaks.
export async function GET(_req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    const { token } = await ctx.params;
    const { data, error } = await supabase
      .from("boards")
      .select(COLUMNS)
      .eq("share_token", token)
      .eq("is_public", true)
      .eq("is_deleted", false)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      throw new HttpError("not_found", "This board is private or the link has changed.");
    }

    const row = data as BoardRow;
    return apiOk({
      board: {
        id: row.id,
        name: row.name,
        elements: Array.isArray(row.elements) ? row.elements : [],
        app_state:
          row.app_state && typeof row.app_state === "object" ? row.app_state : {},
        files: await rehydrateImages(row.id, row.files ?? {}),
        scene_version: Number(row.scene_version),
        updated_at: row.updated_at,
      },
    });
  });
}
