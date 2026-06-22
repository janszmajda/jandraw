import type { NextRequest } from "next/server";
import { handle, apiOk, readJson, HttpError } from "@/lib/http";
import { requireAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { createBoard, toSummary, SUMMARY_COLUMNS, type BoardRow } from "@/lib/boards";
import { validateName, expectArray, expectObject, expectBoolean } from "@/lib/validate";

type SummaryRow = Omit<BoardRow, "elements" | "app_state" | "files">;

// GET /api/boards — list active boards (or trash) for the dashboard, recent-first.
export async function GET(req: NextRequest) {
  return handle(async () => {
    requireAuth(req);
    const params = new URL(req.url).searchParams;
    const q = params.get("q");
    const trash = params.get("trash");
    if (trash !== null && trash !== "1") {
      throw new HttpError("bad_request", 'trash must be "1" when present.');
    }

    let query = supabase
      .from("boards")
      .select(SUMMARY_COLUMNS)
      .eq("is_deleted", trash === "1")
      .order("updated_at", { ascending: false });
    if (q) query = query.ilike("name", `%${q}%`);

    const { data, error } = await query;
    if (error) throw error;
    return apiOk({ boards: ((data ?? []) as SummaryRow[]).map(toSummary) });
  });
}

// POST /api/boards — create a board.
export async function POST(req: NextRequest) {
  return handle(async () => {
    requireAuth(req);
    const body = await readJson<{
      name?: unknown;
      elements?: unknown;
      app_state?: unknown;
      files?: unknown;
      is_public?: unknown;
    }>(req);

    const name = validateName(body.name);
    const elements = body.elements === undefined ? [] : expectArray(body.elements, "elements");
    const appState = body.app_state === undefined ? {} : expectObject(body.app_state, "app_state");
    const files = body.files === undefined ? {} : expectObject(body.files, "files");
    const isPublic = body.is_public === undefined ? true : expectBoolean(body.is_public, "is_public");

    const board = await createBoard({
      name,
      elements,
      app_state: appState,
      files: files as Record<string, Record<string, unknown>>,
      is_public: isPublic,
    });
    return apiOk({ board }, 201);
  });
}
