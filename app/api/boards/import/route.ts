import type { NextRequest } from "next/server";
import { handle, apiOk, readJson, HttpError } from "@/lib/http";
import { requireAuth } from "@/lib/auth";
import { createBoard } from "@/lib/boards";
import { isPlainObject, validateName } from "@/lib/validate";

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

// POST /api/boards/import - create a NEW board from a .excalidraw file (multipart
// `file` field) or an equivalent JSON body. Never overwrites an existing board.
export async function POST(req: NextRequest) {
  return handle(async () => {
    requireAuth(req);

    const contentType = (req.headers.get("content-type") || "").toLowerCase(); // media types are case-insensitive
    let scene: unknown;
    let fallbackName: string | undefined;

    if (contentType.includes("multipart/form-data")) {
      let form: FormData;
      try {
        form = await req.formData();
      } catch {
        throw new HttpError("bad_request", "Invalid multipart form data.");
      }
      const file = form.get("file");
      if (!(file instanceof File)) {
        throw new HttpError("bad_request", "multipart body must include a 'file' field.");
      }
      if (file.size > MAX_BYTES) {
        throw new HttpError("bad_request", "File exceeds the 5 MB limit.");
      }
      const text = await file.text();
      try {
        scene = JSON.parse(text);
      } catch {
        throw new HttpError("bad_request", "File is not valid Excalidraw JSON.");
      }
      const nameField = form.get("name");
      if (typeof nameField === "string" && nameField.trim()) {
        fallbackName = nameField;
      } else if (file.name) {
        // clamp the auto-derived filename so a long filename can't 400 an otherwise-valid
        // import (an explicit name field / scene.name still gets the full validateName rule).
        fallbackName = file.name.replace(/\.(excalidraw|json)$/i, "").trim().slice(0, 200) || undefined;
      }
    } else {
      // JSON body path: enforce the same 5 MB cap as multipart (readJson/req.json have none).
      const text = await req.text();
      if (Buffer.byteLength(text, "utf8") > MAX_BYTES) {
        throw new HttpError("bad_request", "File exceeds the 5 MB limit.");
      }
      try {
        scene = JSON.parse(text);
      } catch {
        throw new HttpError("bad_request", "Body is not valid JSON.");
      }
    }

    if (!isPlainObject(scene)) {
      throw new HttpError("bad_request", "Body is not a valid Excalidraw scene.");
    }
    if (scene.type !== "excalidraw") {
      throw new HttpError("bad_request", 'type must be "excalidraw".');
    }
    if (!Array.isArray(scene.elements)) {
      throw new HttpError("bad_request", "elements must be an array.");
    }

    const name =
      typeof scene.name === "string" && scene.name.trim()
        ? scene.name
        : fallbackName || "Imported board";

    const board = await createBoard({
      name: validateName(name), // same non-empty + max-200 rule as create/rename
      elements: scene.elements,
      app_state: isPlainObject(scene.appState) ? scene.appState : {},
      files: (isPlainObject(scene.files) ? scene.files : {}) as Record<
        string,
        Record<string, unknown>
      >,
      is_public: typeof scene.is_public === "boolean" ? scene.is_public : true,
    });
    return apiOk({ board }, 201);
  });
}
