import type { NextRequest } from "next/server";
import { handle, apiOk, readJson, HttpError } from "@/lib/http";
import { requireAuth } from "@/lib/auth";
import { fetchActiveBoardRow, fetchAnyBoardRow, toFullBoardSafe, saveScene } from "@/lib/boards";
import { expectArray, assertVersion, isPlainObject } from "@/lib/validate";

type Ctx = { params: Promise<{ id: string }> };

// The raw stored elements array, preserved verbatim. Element ops rewrite the WHOLE array,
// so we must NOT drop entries we don't recognize: PUT/import don't deep-validate element
// contents, so a null / non-object / non-string-id entry can legitimately be stored. We
// act only on entries that have a string id; everything else passes through untouched.
function rawElements(row: { elements: unknown }): unknown[] {
  return Array.isArray(row.elements) ? row.elements : [];
}
function elemId(e: unknown): string | null {
  return e !== null &&
    typeof e === "object" &&
    !Array.isArray(e) &&
    typeof (e as Record<string, unknown>).id === "string"
    ? ((e as Record<string, unknown>).id as string)
    : null;
}
const stringIds = (els: unknown[]): Set<string> =>
  new Set(els.map(elemId).filter((x): x is string => x !== null));

// POST /api/boards/[id]/elements - append NEW elements on top (append-only). An id that
// already exists is rejected (use PATCH); duplicate ids WITHIN the request collapse.
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
    const expected =
      typeof body.expected_scene_version === "number" ? body.expected_scene_version : undefined;
    assertVersion(body.expected_scene_version, Number(row.scene_version));

    const incomingById = new Map(
      incoming.map((e) => [String((e as Record<string, unknown>).id), e]),
    );
    const current = rawElements(row);
    const existingIds = stringIds(current);
    for (const eid of incomingById.keys()) {
      if (existingIds.has(eid)) {
        throw new HttpError("bad_request", `Element ${eid} already exists; use PATCH to update it.`);
      }
    }
    const merged = [...current, ...incomingById.values()]; // preserves every existing entry
    const newVersion = await saveScene(id, merged, row.app_state, row.files, expected);
    const board = await toFullBoardSafe(await fetchAnyBoardRow(id));
    return apiOk({ scene_version: newVersion, board }); // version this op authored, not a racy re-read
  });
}

// PATCH /api/boards/[id]/elements - shallow-merge partial updates by id (atomic; any
// unknown id rejects the whole request with 400). Unrecognized entries pass through.
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
    const expected =
      typeof body.expected_scene_version === "number" ? body.expected_scene_version : undefined;
    assertVersion(body.expected_scene_version, Number(row.scene_version));

    const current = rawElements(row);
    const existingIds = stringIds(current);
    for (const uid of byId.keys()) {
      if (!existingIds.has(uid)) {
        throw new HttpError("bad_request", `No element with id ${uid} on this board.`);
      }
    }

    const merged = current.map((e) => {
      const eid = elemId(e);
      const u = eid !== null ? byId.get(eid) : undefined;
      return u ? { ...(e as Record<string, unknown>), ...u } : e; // shallow overwrite; others untouched
    });
    const newVersion = await saveScene(id, merged, row.app_state, row.files, expected);
    const board = await toFullBoardSafe(await fetchAnyBoardRow(id));
    return apiOk({ scene_version: newVersion, board }); // version this op authored, not a racy re-read
  });
}

// DELETE /api/boards/[id]/elements - remove elements by id (idempotent). Per the orphan
// policy, removing an image element does NOT delete its Storage object.
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
    const expected =
      typeof body.expected_scene_version === "number" ? body.expected_scene_version : undefined;
    assertVersion(body.expected_scene_version, Number(row.scene_version));

    const idSet = new Set(ids as string[]);
    const current = rawElements(row);
    const remaining = current.filter((e) => {
      const eid = elemId(e);
      return !(eid !== null && idSet.has(eid)); // only string-id matches removed; rest preserved
    });
    const removed = current.length - remaining.length;

    const newVersion = await saveScene(id, remaining, row.app_state, row.files, expected);
    const board = await toFullBoardSafe(await fetchAnyBoardRow(id));
    return apiOk({ scene_version: newVersion, removed, board });
  });
}
