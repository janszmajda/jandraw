import { supabase, BOARD_IMAGES_BUCKET } from "./supabase";
import { HttpError } from "./http";

// Image pipeline (A.7 / A.9). Excalidraw carries images inline in a files map:
//   { [fileId]: { id, dataURL, mimeType, created, lastRetrieved } }
// We never store the bytes in boards.files. On write we strip the dataURL, upload
// the bytes to Storage at `{boardId}/{fileId}`, and persist a reference only:
//   { [fileId]: { id, mimeType, created, stored: true } }
// On read we download the object and rebuild the full inline entry with a data: URL.

type FileEntry = Record<string, unknown>;
type FilesMap = Record<string, FileEntry>;

const DEFAULT_MIME = "image/png";

// Runs before any board write that carries a files map (PUT, element ops, import).
// Uploads new inline images and returns a reference-only map to persist. Enforces
// the invariant that boards.files never contains a dataURL AND that a `stored: true`
// reference always has a backing Storage object (so reads can't brick the board).
export async function extractAndStoreImages(
  boardId: string,
  files: FilesMap,
): Promise<FilesMap> {
  const out: FilesMap = {};

  for (const [fileId, entry] of Object.entries(files ?? {})) {
    // Already a stored reference from a prior write: keep as-is, do not re-upload.
    if (entry?.stored === true) {
      out[fileId] = {
        id: entry.id ?? fileId,
        mimeType: entry.mimeType,
        created: entry.created ?? Date.now(),
        stored: true,
      };
      continue;
    }

    const dataURL = entry?.dataURL;
    if (typeof dataURL === "string" && dataURL.startsWith("data:")) {
      const comma = dataURL.indexOf(",");
      if (comma < 0) {
        // No payload separator — malformed client input, not a server fault.
        throw new HttpError("bad_request", `Malformed data URL for file ${fileId}: missing payload.`);
      }
      // Excalidraw image data URLs are always base64-encoded. Guard on that so we
      // never decode a non-base64 payload (e.g. data:image/svg+xml,<raw>) as base64
      // and store corrupt bytes. This is client-supplied input → 400, not 500.
      const header = dataURL.slice(5, comma); // e.g. "image/png;base64"
      if (!header.includes(";base64")) {
        throw new HttpError(
          "bad_request",
          `Unsupported data URL for file ${fileId}: expected base64 encoding.`,
        );
      }
      const mimeType =
        (typeof entry.mimeType === "string" && entry.mimeType) || header.split(";")[0] || DEFAULT_MIME;
      const base64 = dataURL.slice(comma + 1);
      const bytes = Buffer.from(base64, "base64");

      const { error } = await supabase.storage
        .from(BOARD_IMAGES_BUCKET)
        .upload(`${boardId}/${fileId}`, bytes, { contentType: mimeType, upsert: true });
      if (error) throw error;

      out[fileId] = { id: fileId, mimeType, created: entry.created ?? Date.now(), stored: true };
    } else {
      // No inline bytes and not already stored: we have NOTHING to upload, so we must
      // NOT mark it stored:true (that would create a reference with no Storage object,
      // which bricks every future read). Pass it through WITHOUT `stored`, so
      // rehydrateImages treats it as inline/pass-through and never tries to download.
      const rest = { ...(entry ?? {}) };
      delete (rest as Record<string, unknown>).dataURL;
      delete (rest as Record<string, unknown>).stored;
      out[fileId] = { ...rest, id: rest.id ?? fileId };
    }
  }

  return out; // store this in boards.files
}

// Runs on the read side (GET board, view, export) before handing files to the
// editor/view/export. Downloads each stored object and rebuilds a full inline entry.
// A single missing/failed object degrades to "skip that image" instead of failing the
// whole board, so one lost object can never make a board unreadable.
export async function rehydrateImages(boardId: string, files: FilesMap): Promise<FilesMap> {
  const out: FilesMap = {};

  for (const [fileId, entry] of Object.entries(files ?? {})) {
    if (entry?.stored === true) {
      try {
        const { data, error } = await supabase.storage
          .from(BOARD_IMAGES_BUCKET)
          .download(`${boardId}/${fileId}`);
        if (error || !data) throw error ?? new Error("missing object");
        const bytes = Buffer.from(await data.arrayBuffer());
        const base64 = bytes.toString("base64");
        const mimeType = (typeof entry.mimeType === "string" && entry.mimeType) || DEFAULT_MIME;
        out[fileId] = {
          id: fileId, // preserve id so image elements still resolve
          dataURL: `data:${mimeType};base64,${base64}`,
          mimeType,
          created: entry.created ?? Date.now(),
          lastRetrieved: Date.now(),
        };
      } catch (e) {
        // Degrade gracefully: drop this one image so the rest of the board still loads.
        console.warn(`[jandraw] rehydrate failed for ${boardId}/${fileId}:`, e);
      }
    } else {
      out[fileId] = entry; // already full / inline: pass through
    }
  }

  return out;
}

// Hard-delete only (A.9): remove all Storage objects under `{boardId}/`. `.remove`
// needs explicit paths and cannot delete a bare prefix. We always list from the start
// and delete the head batch until the prefix is empty — advancing an offset is wrong
// because each remove() shifts the listing window.
export async function deleteBoardImages(boardId: string): Promise<void> {
  const limit = 100;
  for (let guard = 0; guard < 10000; guard++) {
    const { data, error } = await supabase.storage
      .from(BOARD_IMAGES_BUCKET)
      .list(boardId, { limit });
    if (error) throw error;
    if (!data || data.length === 0) break;

    const paths = data.map((obj) => `${boardId}/${obj.name}`);
    const { error: rmError } = await supabase.storage.from(BOARD_IMAGES_BUCKET).remove(paths);
    if (rmError) throw rmError;

    if (data.length < limit) break; // last (short) page
  }
}
