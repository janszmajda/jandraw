-- Migration: per-board tags.
--
-- Adds a `tags` text[] column to boards so a board can be labeled with any subset
-- of the known tag set (currently Jan, Julia - see lib/tags.ts). Tags are metadata
-- only: they are set via PATCH /api/boards/[id], never touched by a scene write, so
-- they do not create snapshots or bump scene_version.
--
-- Additive and safe to run early: the column has a default, and code that does not
-- select it is unaffected. Run once in the Supabase SQL editor.

alter table boards
  add column if not exists tags text[] not null default '{}'::text[];

-- GIN index backs the dashboard tag filter (`tags @> '{Jan}'`, i.e. .contains()).
create index if not exists boards_tags_idx
  on boards using gin (tags);
