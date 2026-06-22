import { NextResponse, type NextRequest } from "next/server";
import { handle } from "@/lib/http";
import { requireAuth } from "@/lib/auth";
import { fetchActiveBoardRow } from "@/lib/boards";
import { rehydrateImages } from "@/lib/images";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/boards/[id]/export — download a .excalidraw file (real Excalidraw format).
// Public if the board is public; otherwise requires auth. Images are rehydrated so
// the file embeds full dataURLs and opens in real Excalidraw.
export async function GET(req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    const row = await fetchActiveBoardRow(id); // 404 if missing / soft-deleted
    if (!row.is_public) requireAuth(req); // private board → must be authed (else 401)

    const file = {
      type: "excalidraw",
      version: 2,
      source: "jandraw",
      elements: Array.isArray(row.elements) ? row.elements : [],
      appState: row.app_state && typeof row.app_state === "object" ? row.app_state : {},
      files: await rehydrateImages(row.id, row.files ?? {}),
    };

    return new NextResponse(JSON.stringify(file, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="${row.id}.excalidraw"`,
      },
    });
  });
}
