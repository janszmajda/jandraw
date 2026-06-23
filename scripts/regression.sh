#!/usr/bin/env bash
# Jandraw HTTP regression suite. Drives the running prod server on :3000 via the
# Authorization: Bearer header (avoids Secure-cookie-over-http friction in curl).
set -u
BASE="${JANDRAW_API_URL:-http://localhost:3000}"
# Never hard-code the secret in a committed file. Read it from the environment, falling
# back to the gitignored .env.local. (Run from the repo root, or export JANDRAW_EDIT_SECRET.)
SECRET="${JANDRAW_EDIT_SECRET:-$(grep -E '^JANDRAW_EDIT_SECRET=' .env.local 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"'"'"'"' | tr -d '[:space:]')}"
if [ -z "$SECRET" ]; then
  echo "ERROR: set JANDRAW_EDIT_SECRET (env var) or run from a repo root with .env.local present." >&2
  exit 2
fi
AUTH="Authorization: Bearer $SECRET"
CT="Content-Type: application/json"
TMP=$(mktemp)
pass=0; fail=0

chk() { # desc expected actual
  if [ "$2" = "$3" ]; then pass=$((pass+1)); echo "ok   | $1 [$3]";
  else fail=$((fail+1)); echo "FAIL | $1  expected=$2 got=$3  body=$(head -c 200 "$TMP")"; fi
}
req() { # METHOD URL [json]  -> sets HTTP, BODY (body also in $TMP)
  local m="$1" u="$2" j="${3:-}"
  if [ -n "$j" ]; then
    HTTP=$(curl -s -o "$TMP" -w "%{http_code}" -X "$m" -H "$AUTH" -H "$CT" -d "$j" "$u")
  else
    HTTP=$(curl -s -o "$TMP" -w "%{http_code}" -X "$m" -H "$AUTH" "$u")
  fi
  BODY=$(cat "$TMP")
}
st() { curl -s -o "$TMP" -w "%{http_code}" "$@"; }   # status with custom args
jget() { node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const o=JSON.parse(d);const p=process.argv[1].split(".");let v=o;for(const k of p)v=(v==null)?undefined:v[k];console.log(typeof v==="object"?JSON.stringify(v):String(v))}catch(e){console.log("__ERR__")}})' "$1" < "$TMP"; }

echo "=== AUTH GATE ==="
H=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/boards");                              chk "GET /api/boards no auth -> 401" 401 "$H"
H=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "$CT" -d '{"secret":"wrong"}' "$BASE/api/login"); chk "login wrong -> 401" 401 "$H"
H=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "$CT" -d "{\"secret\":\"$SECRET\"}" "$BASE/api/login"); chk "login ok -> 200" 200 "$H"
SC=$(curl -s -D - -o /dev/null -X POST -H "$CT" -d "{\"secret\":\"$SECRET\"}" "$BASE/api/login")
echo "$SC" | grep -qi 'set-cookie:.*jandraw_session' && chk "login sets session cookie" yes yes || chk "login sets session cookie" yes no
echo "$SC" | grep -qi 'set-cookie:.*httponly' && chk "session cookie HttpOnly" yes yes || chk "session cookie HttpOnly" yes no

echo "=== BODY VALIDATION ==="
req POST "$BASE/api/boards" '["not","object"]';   chk "POST array body -> 400" 400 "$HTTP"
req POST "$BASE/api/boards" 'not json at all';     chk "POST invalid json -> 400" 400 "$HTTP"
req POST "$BASE/api/boards" '{"name":""}';         chk "create empty name -> 400" 400 "$HTTP"
req POST "$BASE/api/boards" '{"name":"   "}';      chk "create blank name -> 400" 400 "$HTTP"

echo "=== SEARCH ESCAPING (round-7 #1) ==="
req GET "$BASE/api/boards";                        chk "list boards -> 200" 200 "$HTTP"
H=$(curl -s -o /dev/null -w "%{http_code}" -H "$AUTH" "$BASE/api/boards?q=*");    chk "search q=* (asterisk strip) -> 200" 200 "$H"
H=$(curl -s -o /dev/null -w "%{http_code}" -H "$AUTH" "$BASE/api/boards?q=%25");  chk "search q=% literal -> 200" 200 "$H"
H=$(curl -s -o /dev/null -w "%{http_code}" -H "$AUTH" "$BASE/api/boards?q=_x_");  chk "search underscore -> 200" 200 "$H"
H=$(curl -s -o /dev/null -w "%{http_code}" -H "$AUTH" "$BASE/api/boards?q=%5C");  chk "search backslash -> 200" 200 "$H"
req GET "$BASE/api/boards?trash=2";                chk "trash=2 invalid -> 400" 400 "$HTTP"

echo "=== CREATE / READ ==="
req POST "$BASE/api/boards" '{"name":"Regression Test Board"}'; chk "create board -> 201" 201 "$HTTP"
BID=$(jget board.id); TOK=$(jget board.share_token); SV=$(jget board.scene_version)
echo "  board id=$BID token=$TOK v=$SV"
chk "new board version 0" 0 "$SV"
req GET "$BASE/api/boards/$BID";                   chk "GET board -> 200" 200 "$HTTP"
req GET "$BASE/api/boards/does-not-exist";         chk "GET missing board -> 404" 404 "$HTTP"

echo "=== ELEMENTS API ==="
req POST "$BASE/api/boards/$BID/elements" '{"elements":[{"id":"el1","type":"rectangle","x":0,"y":0,"width":10,"height":10}]}'; chk "add element -> 200" 200 "$HTTP"
req POST "$BASE/api/boards/$BID/elements" '{"elements":[{"id":"el1","type":"rectangle"}]}'; chk "add duplicate id -> 400" 400 "$HTTP"
req POST "$BASE/api/boards/$BID/elements" '{"elements":[{"type":"rectangle"}]}';            chk "add element no id -> 400" 400 "$HTTP"
req POST "$BASE/api/boards/$BID/elements" '{"elements":[]}';                                 chk "add empty array -> 400" 400 "$HTTP"
req PATCH "$BASE/api/boards/$BID/elements" '{"updates":[{"id":"el1","x":42}]}';              chk "update element -> 200" 200 "$HTTP"
req PATCH "$BASE/api/boards/$BID/elements" '{"updates":[{"id":"ghost","x":1}]}';             chk "update unknown id -> 400" 400 "$HTTP"
req DELETE "$BASE/api/boards/$BID/elements" '{"ids":["el1"]}';                               chk "delete element -> 200" 200 "$HTTP"
REM=$(jget removed); chk "removed count = 1" 1 "$REM"
req DELETE "$BASE/api/boards/$BID/elements" '{"ids":["el1"]}';                               chk "delete already-gone (idempotent) -> 200" 200 "$HTTP"
REM=$(jget removed); chk "removed count = 0 (idempotent)" 0 "$REM"

echo "=== VERSION GUARD (round-7 #2 fallback) ==="
req GET "$BASE/api/boards/$BID"; CV=$(jget board.scene_version); echo "  current version=$CV"
req PUT "$BASE/api/boards/$BID" "{\"elements\":[{\"id\":\"r1\",\"type\":\"rectangle\"}],\"app_state\":{},\"files\":{},\"expected_scene_version\":$CV}"; chk "PUT correct expected version -> 200" 200 "$HTTP"
NV=$(jget scene_version); echo "  new version=$NV"
[ "$NV" -gt "$CV" ] 2>/dev/null && chk "version bumped after PUT" yes yes || chk "version bumped after PUT" yes "no($CV->$NV)"
req PUT "$BASE/api/boards/$BID" '{"elements":[],"app_state":{},"files":{},"expected_scene_version":0}'; chk "PUT stale version -> 409" 409 "$HTTP"

echo "=== SNAPSHOTS / RESTORE ==="
req GET "$BASE/api/boards/$BID/snapshots"; chk "list snapshots -> 200" 200 "$HTTP"
SNAP=$(jget snapshots.0.id); echo "  latest snapshot=$SNAP"
req GET "$BASE/api/boards/$BID/snapshots?limit=0";   chk "snapshots limit=0 -> 400" 400 "$HTTP"
req GET "$BASE/api/boards/$BID/snapshots?limit=abc"; chk "snapshots limit=abc -> 400" 400 "$HTTP"
if [ -n "$SNAP" ] && [ "$SNAP" != "undefined" ] && [ "$SNAP" != "__ERR__" ]; then
  req POST "$BASE/api/boards/$BID/restore/$SNAP"; chk "restore snapshot -> 200" 200 "$HTTP"
else chk "had a snapshot to restore" yes no; fi
req POST "$BASE/api/boards/$BID/restore/not-a-uuid"; chk "restore non-uuid snapId -> 404" 404 "$HTTP"
req POST "$BASE/api/boards/$BID/restore/00000000-0000-0000-0000-000000000000"; chk "restore unknown snapId -> 404" 404 "$HTTP"

echo "=== EXPORT ==="
req GET "$BASE/api/boards/$BID/export"; chk "export -> 200" 200 "$HTTP"
echo "$BODY" | grep -q '"excalidraw"' && chk "export contains excalidraw type" yes yes || chk "export contains excalidraw type" yes no

echo "=== VIEW (public read) ==="
H=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/view/$TOK");        chk "view public token -> 200" 200 "$H"
H=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/view/bogus-tok");   chk "view bogus token -> 404" 404 "$H"
req PATCH "$BASE/api/boards/$BID" '{"is_public":false}';                  chk "make private -> 200" 200 "$HTTP"
H=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/view/$TOK");        chk "view private board -> 404" 404 "$H"
req PATCH "$BASE/api/boards/$BID" '{"is_public":true}';                   chk "make public again -> 200" 200 "$HTTP"

echo "=== METADATA / PATCH ==="
req PATCH "$BASE/api/boards/$BID" '{"name":"Renamed Regression Board"}';  chk "rename -> 200" 200 "$HTTP"
NM=$(jget board.name); chk "name updated" "Renamed Regression Board" "$NM"
req PATCH "$BASE/api/boards/$BID" '{}';                                   chk "patch empty body -> 400" 400 "$HTTP"

echo "=== ROTATE TOKEN ==="
req POST "$BASE/api/boards/$BID/rotate-token"; chk "rotate token -> 200" 200 "$HTTP"
NEWTOK=$(jget share_token)
[ -n "$NEWTOK" ] && [ "$NEWTOK" != "$TOK" ] && [ "$NEWTOK" != "undefined" ] && chk "token changed" yes yes || chk "token changed" yes no
H=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/view/$TOK"); chk "old token now dead -> 404" 404 "$H"

echo "=== IMPORT ==="
printf '{"type":"excalidraw","version":2,"elements":[],"appState":{},"files":{}}' > /tmp/jd_scene.json
LONGNAME=$(printf 'a%.0s' $(seq 1 300))
H=$(curl -s -o "$TMP" -w "%{http_code}" -X POST -H "$AUTH" -F "file=@/tmp/jd_scene.json;filename=${LONGNAME}.excalidraw;type=application/json" "$BASE/api/boards/import"); chk "import long filename (round-7 #3) -> 201" 201 "$H"
IBID=$(jget board.id); INAME=$(jget board.name)
NLEN=$(printf '%s' "$INAME" | wc -c); echo "  imported name length=$NLEN"
[ "$NLEN" -le 200 ] && [ "$NLEN" -gt 0 ] && chk "import name clamped 1..200" yes yes || chk "import name clamped 1..200" yes "no($NLEN)"
req POST "$BASE/api/boards/import" '{"type":"excalidraw","elements":[],"name":"JSON Import"}'; chk "import json body -> 201" 201 "$HTTP"
JBID=$(jget board.id)
req POST "$BASE/api/boards/import" '{"type":"notexcalidraw","elements":[]}'; chk "import wrong type -> 400" 400 "$HTTP"
req POST "$BASE/api/boards/import" '{"type":"excalidraw","elements":"x"}';   chk "import non-array elements -> 400" 400 "$HTTP"

echo "=== SOFT DELETE / TRASH / RESTORE ==="
req DELETE "$BASE/api/boards/$BID"; chk "soft delete -> 200" 200 "$HTTP"
req GET "$BASE/api/boards?trash=1"; echo "$BODY" | grep -q "$BID" && chk "trash lists deleted board" yes yes || chk "trash lists deleted board" yes no
req GET "$BASE/api/boards/$BID";                  chk "GET trashed board -> 404" 404 "$HTTP"
req PATCH "$BASE/api/boards/$BID" '{"name":"x"}'; chk "rename trashed board -> 404" 404 "$HTTP"
req PATCH "$BASE/api/boards/$BID" '{"is_deleted":false}'; chk "restore from trash -> 200" 200 "$HTTP"
req GET "$BASE/api/boards/$BID";                  chk "GET restored board -> 200" 200 "$HTTP"

echo "=== HARD DELETE VALIDATION + CLEANUP ==="
req DELETE "$BASE/api/boards/$BID?hard=2"; chk "hard=2 invalid -> 400" 400 "$HTTP"
for x in "$BID" "$IBID" "$JBID"; do
  if [ -n "$x" ] && [ "$x" != "undefined" ] && [ "$x" != "__ERR__" ]; then
    H=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE -H "$AUTH" "$BASE/api/boards/$x?hard=1"); chk "hard delete $x -> 200" 200 "$H"
  fi
done

echo ""
echo "================ RESULT: $pass passed, $fail failed ================"
rm -f "$TMP" /tmp/jd_scene.json
exit $fail
