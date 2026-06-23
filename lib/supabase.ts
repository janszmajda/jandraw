import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Server-only Supabase client using the service-role key. This bypasses RLS and
// has full access to the database and Storage, so it must NEVER be imported into
// a client component or shipped to the browser. All access to Supabase in Jandraw
// goes through this client from server route handlers / server components only.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    "Jandraw: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (see .env.local).",
  );
}

export const supabase: SupabaseClient = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

// Storage bucket holding raw image bytes at path `{boardId}/{fileId}` (A.5).
export const BOARD_IMAGES_BUCKET = "board-images";
