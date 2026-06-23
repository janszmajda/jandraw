-- Migration: atomic optimistic-concurrency check for scene writes.
--
-- Fixes the TOCTOU where two writers that both loaded a board at the same
-- scene_version could both pass a pre-flight check and both commit (silent lost
-- update), despite supplying expected_scene_version. saveScene() (lib/boards.ts)
-- calls this function when expected_scene_version is provided; if this function is
-- not installed it falls back to save_board_scene (so the app keeps working — only
-- the atomic race guard is inactive until this runs).
--
-- Run once in the Supabase SQL editor.

create or replace function save_board_scene_checked(
  p_id text,
  p_elements jsonb,
  p_app_state jsonb,
  p_files jsonb,
  p_expected_version bigint
)
returns bigint
language plpgsql
as $$
declare
  v_cur   bigint;
  v_el    jsonb;
  v_as    jsonb;
  v_files jsonb;
  v_new   bigint;
begin
  -- Lock the row so the version check and the bump are one atomic step.
  select scene_version, elements, app_state, files
    into v_cur, v_el, v_as, v_files
  from boards where id = p_id for update;

  if not found then
    return null;                              -- board missing -> 404 in the app
  end if;
  if v_cur <> p_expected_version then
    raise exception 'jandraw_version_conflict'; -- -> 409 in the app
  end if;

  insert into board_snapshots (board_id, elements, app_state, files, scene_version)
  values (p_id, v_el, v_as, v_files, v_cur);

  update boards
  set elements = p_elements, app_state = p_app_state, files = p_files,
      scene_version = scene_version + 1
  where id = p_id
  returning scene_version into v_new;

  delete from board_snapshots s
  where s.board_id = p_id
    and s.created_at < now() - interval '30 days'
    and s.id not in (
      select id from board_snapshots where board_id = p_id order by created_at desc limit 50
    );

  return v_new;
end;
$$;

grant execute on function save_board_scene_checked(text, jsonb, jsonb, jsonb, bigint) to service_role;
