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
const MIME_RE = /^[\w.+-]+\/[\w.+-]+$/; // a real type/subtype; rejects header-injection chars

function safeMime(v: unknown): string {
  return typeof v === "string" && MIME_RE.test(v) ? v : DEFAULT_MIME;
}

// fileId becomes a Storage object path segment (`{boardId}/{fileId}`). Reject anything
// that isn't a flat safe token so a crafted imported scene can't write/read across
// board folders via slashes or `..`. (Excalidraw fileIds are flat, so this is non-breaking.)
function isSafeFileId(id: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(id) && id !== "." && id !== "..";
}

// Distinguish a genuinely-absent object (degrade: drop it) from a transient/unknown
// Storage failure (fail loud: rethrow), so a momentary blip never returns a lossy
// scene that the editor's autosave would then persist as a permanent reference loss.
function isMissingObject(e: unknown): boolean {
  if (e instanceof Error && e.message === "missing object") return true;
  const o = e as { status?: number | string; statusCode?: number | string; message?: string } | null;
  // Only a DEFINITIVE not-found degrades (drop the entry). Any other error — including a
  // transient 400-class blip — rethrows so we never hand back a lossy scene that the
  // editor's autosave would then persist as a permanent reference loss. Supabase reports
  // a genuine miss with a "not found" message even when the HTTP status is 400, so the
  // message regex (not a blanket 400) is what catches the real misses.
  return (
    String(o?.status ?? "") === "404" ||
    String(o?.statusCode ?? "") === "404" ||
    /not.?found|does not exist|no such/i.test(String(o?.message ?? ""))
  );
}

// Runs before any board write that carries a files map (PUT, element ops, import).
// Uploads new inline images and returns a reference-only map (never persists a dataURL).
// A new image (dataURL) is always uploaded before it is marked stored. A `stored: true`
// entry already present in the input is trusted as-is and NOT existence-verified — this
// is the legitimate path for restore/element-ops (refs from our own DB); a bogus
// client-supplied stored ref with no object simply degrades on read (image dropped),
// it does not brick the board.
export async function extractAndStoreImages(boardId: string, files: FilesMap): Promise<FilesMap> {
  const out: FilesMap = {};

  for (const [fileId, entry] of Object.entries(files ?? {})) {
    if (!isSafeFileId(fileId)) {
      throw new HttpError("bad_request", `Invalid file id: ${fileId}`);
    }
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new HttpError("bad_request", `Invalid files entry for ${fileId}: must be an object.`);
    }
    const inlineDataURL =
      typeof entry.dataURL === "string" && entry.dataURL.startsWith("data:") ? entry.dataURL : null;

    // Existing stored reference with no fresh inline bytes: keep as-is, do not re-upload.
    // (If it ALSO carries a dataURL, fall through and upload the bytes so the reference
    // always has a backing object.)
    if (entry.stored === true && !inlineDataURL) {
      out[fileId] = {
        id: entry.id ?? fileId,
        mimeType: safeMime(entry.mimeType),
        created: entry.created ?? Date.now(),
        stored: true,
      };
      continue;
    }

    if (inlineDataURL) {
      const comma = inlineDataURL.indexOf(",");
      if (comma < 0) {
        throw new HttpError("bad_request", `Malformed data URL for file ${fileId}: missing payload.`);
      }
      // Excalidraw image data URLs are always base64-encoded; guard so we never decode
      // a non-base64 payload as base64. Client input → 400, not 500.
      const header = inlineDataURL.slice(5, comma); // e.g. "image/png;base64"
      if (!header.includes(";base64")) {
        throw new HttpError("bad_request", `Unsupported data URL for file ${fileId}: expected base64 encoding.`);
      }
      const mimeType = safeMime(
        (typeof entry.mimeType === "string" && entry.mimeType) || header.split(";")[0],
      );
      const bytes = Buffer.from(inlineDataURL.slice(comma + 1), "base64");

      const { error } = await supabase.storage
        .from(BOARD_IMAGES_BUCKET)
        .upload(`${boardId}/${fileId}`, bytes, { contentType: mimeType, upsert: true });
      if (error) throw error;

      out[fileId] = { id: fileId, mimeType, created: entry.created ?? Date.now(), stored: true };
    } else {
      // No inline bytes and not a stored ref: pass through WITHOUT `stored` so a future
      // read never tries to download a non-existent object.
      const rest = { ...entry };
      delete rest.dataURL;
      delete rest.stored;
      out[fileId] = { ...rest, id: rest.id ?? fileId };
    }
  }

  return out;
}

// Read side (GET board, view, export): download each stored object and rebuild the
// inline entry. A genuinely-missing object is dropped (board still loads); a transient
// failure rethrows so we never hand back a lossy scene.
export async function rehydrateImages(boardId: string, files: FilesMap): Promise<FilesMap> {
  const out: FilesMap = {};

  for (const [fileId, entry] of Object.entries(files ?? {})) {
    if (!isSafeFileId(fileId)) {
      console.warn(`[jandraw] skipping unsafe file id on read: ${fileId}`);
      continue; // never download a cross-board / traversal path
    }
    if (entry?.stored === true) {
      try {
        const { data, error } = await supabase.storage
          .from(BOARD_IMAGES_BUCKET)
          .download(`${boardId}/${fileId}`);
        if (error || !data) throw error ?? new Error("missing object");
        const bytes = Buffer.from(await data.arrayBuffer());
        const mimeType = safeMime(entry.mimeType);
        out[fileId] = {
          id: fileId,
          dataURL: `data:${mimeType};base64,${bytes.toString("base64")}`,
          mimeType,
          created: entry.created ?? Date.now(),
          lastRetrieved: Date.now(),
        };
      } catch (e) {
        if (isMissingObject(e)) {
          console.warn(`[jandraw] image object missing for ${boardId}/${fileId}; dropping reference`);
        } else {
          throw e; // transient/unknown — fail loud, don't return a lossy scene
        }
      }
    } else {
      out[fileId] = entry; // already full / inline: pass through
    }
  }

  return out;
}

// Hard-delete only (A.9): remove all Storage objects under `{boardId}/`. Always list
// from the start and delete the head batch until empty (advancing an offset is wrong
// because each remove() shifts the listing window).
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

    if (data.length < limit) break;
  }
}
