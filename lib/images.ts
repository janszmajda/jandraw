import { supabase, BOARD_IMAGES_BUCKET } from "./supabase";

// Image pipeline (A.7 / A.9). Excalidraw carries images inline in a files map:
//   { [fileId]: { id, dataURL, mimeType, created, lastRetrieved } }
// We never store the bytes in boards.files. On write we strip the dataURL, upload
// the bytes to Storage at `{boardId}/{fileId}`, and persist a reference only:
//   { [fileId]: { id, mimeType, created, stored: true } }
// On read we download the object and rebuild the full inline entry with a data: URL.

type FileEntry = Record<string, unknown>;
type FilesMap = Record<string, FileEntry>;

// Runs before any board write that carries a files map (PUT, element ops, import).
// Uploads new inline images and returns a reference-only map to persist. Enforces
// the invariant that boards.files never contains a dataURL, including pass-through.
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
      // Excalidraw image data URLs are always base64-encoded. Guard on that so we
      // never decode a non-base64 payload (e.g. data:image/svg+xml,<raw>) as
      // base64 and store corrupt bytes.
      const comma = dataURL.indexOf(",");
      const header = dataURL.slice(5, comma); // e.g. "image/png;base64"
      if (!header.includes(";base64")) {
        throw new Error(
          `Unsupported data URL for file ${fileId}: expected base64 encoding`,
        );
      }
      const mimeType = (entry.mimeType as string) ?? header.split(";")[0];
      const base64 = dataURL.slice(comma + 1);
      const bytes = Buffer.from(base64, "base64");

      const { error } = await supabase.storage
        .from(BOARD_IMAGES_BUCKET)
        .upload(`${boardId}/${fileId}`, bytes, {
          contentType: mimeType,
          upsert: true, // overwrite if the object exists
        });
      if (error) throw error;

      out[fileId] = {
        id: fileId,
        mimeType,
        created: entry.created ?? Date.now(),
        stored: true,
      };
    } else {
      // No inline data and not marked stored: strip any stray dataURL and persist
      // a reference only, so the invariant holds in code, not just prose.
      const rest = { ...(entry ?? {}) };
      delete (rest as Record<string, unknown>).dataURL;
      out[fileId] = { ...rest, id: rest.id ?? fileId, stored: true };
    }
  }

  return out; // store this in boards.files
}

// Runs on the read side (GET board, view, export) before handing files to the
// editor/view/export. Downloads each stored object and rebuilds a full inline entry.
export async function rehydrateImages(
  boardId: string,
  files: FilesMap,
): Promise<FilesMap> {
  const out: FilesMap = {};

  for (const [fileId, entry] of Object.entries(files ?? {})) {
    if (entry?.stored === true) {
      const { data, error } = await supabase.storage
        .from(BOARD_IMAGES_BUCKET)
        .download(`${boardId}/${fileId}`); // returns a Blob
      if (error) throw error;

      const bytes = Buffer.from(await data.arrayBuffer());
      const base64 = bytes.toString("base64");
      const mimeType = entry.mimeType as string;
      const dataURL = `data:${mimeType};base64,${base64}`;

      out[fileId] = {
        id: fileId, // preserve id so image elements still resolve
        dataURL,
        mimeType,
        created: entry.created ?? Date.now(),
        lastRetrieved: Date.now(),
      };
    } else {
      out[fileId] = entry; // already full / inline: pass through
    }
  }

  return out;
}

// Hard-delete only (A.9): remove all Storage objects under `{boardId}/`. `.remove`
// needs explicit paths and cannot delete a bare prefix, so list-then-remove, paged.
export async function deleteBoardImages(boardId: string): Promise<void> {
  const limit = 100;
  let offset = 0;

  for (;;) {
    const { data, error } = await supabase.storage
      .from(BOARD_IMAGES_BUCKET)
      .list(boardId, { limit, offset });
    if (error) throw error;
    if (!data || data.length === 0) break;

    const paths = data.map((obj) => `${boardId}/${obj.name}`);
    const { error: rmError } = await supabase.storage
      .from(BOARD_IMAGES_BUCKET)
      .remove(paths);
    if (rmError) throw rmError;

    if (data.length < limit) break;
    offset += limit;
  }
}
