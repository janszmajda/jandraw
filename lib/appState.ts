// Persisted app_state allowlist (A.10). Excalidraw's runtime appState carries
// transient and non-serializable fields that must not be persisted: `collaborators`
// is a Map (which JSON.stringify drops/breaks), and selection/viewport keys are
// session state that would create noisy snapshots and reset other clients.
//
// We strip the transient keys and keep everything else, which preserves all
// view-relevant style defaults (viewBackgroundColor, gridSize, theme, the many
// currentItem* keys, ...) without having to enumerate every one. This is applied
// by every writer (PUT, import, element ops) and every reader/exporter so all
// paths store and emit the same clean app_state.

const TRANSIENT_KEYS = new Set<string>([
  "collaborators",
  "selectedElementIds",
  "selectedGroupIds",
  "editingElement",
  "editingGroupId",
  "cursorButton",
  "scrollX",
  "scrollY",
  "zoom",
  "width",
  "height",
  "offsetTop",
  "offsetLeft",
]);

export function sanitizeAppState(
  appState: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!appState || typeof appState !== "object" || Array.isArray(appState)) {
    return {};
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(appState)) {
    if (TRANSIENT_KEYS.has(k)) continue;
    out[k] = v;
  }
  return out;
}
