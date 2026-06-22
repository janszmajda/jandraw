import type { NextRequest } from "next/server";
import { handle, apiOk, readJson, HttpError } from "@/lib/http";
import { requireAuth } from "@/lib/auth";
import { fetchActiveBoardRow, toFullBoard, saveScene } from "@/lib/boards";
import { expectArray, assertVersion, isPlainObject } from "@/lib/validate";

type Ctx = { params: Promise<{ id: string }> };

function currentElements(row: { elements: unknown }): Record<string, unknown>[] {
  return (Array.isArray(row.elements) ? row.elements : []) as Record<string, unknown>[];
}

// POST /api/boards/[id]/elements — append elements (land on top, in given order).
export async function POST(req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    requireAuth(req);
    const { id } = await ctx.params;
    const body = await readJson<{ elements?: unknown; expected_scene_version?: unknown }>(req);

    const incoming = expectArray(body.elements, "elements");
    if (incoming.length === 0) {
      throw new HttpError("bad_request", "elements must be a non-empty array.");
    }
    for (const el of incoming) {
      if (!isPlainObject(el) || typeof el.id !== "string") {
        throw new HttpError("bad_request", "each element must be an object with a string id.");
      }
    }

    const row = await fetchActiveBoardRow(id);
    assertVersion(body.expected_scene_version, Number(row.scene_version));

    const merged = [...currentElements(row), ...incoming];
    const version = await saveScene(id, merged, row.app_state, row.files);
    const fresh = await fetchActiveBoardRow(id);
    return apiOk({ scene_version: version, board: await toFullBoard(fresh) });
  });
}

// PATCH /api/boards/[id]/elements — shallow-merge partial updates by id (atomic;
// any unknown id rejects the whole request with 400).
export async function PATCH(req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    requireAuth(req);
    const { id } = await ctx.params;
    const body = await readJson<{ updates?: unknown; expected_scene_version?: unknown }>(req);

    const updates = expectArray(body.updates, "updates");
    if (updates.length === 0) {
      throw new HttpError("bad_request", "updates must be a non-empty array.");
    }
    const byId = new Map<string, Record<string, unknown>>();
    for (const u of updates) {
      if (!isPlainObject(u) || typeof u.id !== "string") {
        throw new HttpError("bad_request", "each update must include a string id.");
      }
      byId.set(u.id, u);
    }

    const row = await fetchActiveBoardRow(id);
    assertVersion(body.expected_scene_version, Number(row.scene_version));

    const current = currentElements(row);
    const existingIds = new Set(current.map((e) => String(e.id)));
    for (const uid of byId.keys()) {
      if (!existingIds.has(uid)) {
        throw new HttpError("bad_request", `No element with id ${uid} on this board.`);
      }
    }

    const merged = current.map((e) => {
      const u = byId.get(String(e.id));
      return u ? { ...e, ...u } : e; // shallow top-level overwrite
    });
    const version = await saveScene(id, merged, row.app_state, row.files);
    const fresh = await fetchActiveBoardRow(id);
    return apiOk({ scene_version: version, board: await toFullBoard(fresh) });
  });
}

// DELETE /api/boards/[id]/elements — remove elements by id (idempotent). Per the
// orphan policy, removing an image element does NOT delete its Storage object.
export async function DELETE(req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    requireAuth(req);
    const { id } = await ctx.params;
    const body = await readJson<{ ids?: unknown; expected_scene_version?: unknown }>(req);

    const ids = expectArray(body.ids, "ids");
    if (ids.length === 0) {
      throw new HttpError("bad_request", "ids must be a non-empty array.");
    }
    for (const x of ids) {
      if (typeof x !== "string") {
        throw new HttpError("bad_request", "ids must be an array of strings.");
      }
    }

    const row = await fetchActiveBoardRow(id);
    assertVersion(body.expected_scene_version, Number(row.scene_version));

    const idSet = new Set(ids as string[]);
    const current = currentElements(row);
    const remaining = current.filter((e) => !idSet.has(String(e.id)));
    const removed = current.length - remaining.length;

    const version = await saveScene(id, remaining, row.app_state, row.files);
    const fresh = await fetchActiveBoardRow(id);
    return apiOk({ scene_version: version, removed, board: await toFullBoard(fresh) });
  });
}
