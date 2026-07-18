// frontrunner — store.js
// localStorage persistence: a project index, per-project entries, and custom
// template/theme libraries. Every write is quota-safe; failures surface as
// return values the UI can show, never as silent data loss.

const INDEX_KEY = "fr:index";
const PROJECT_PREFIX = "fr:project:";
const CUSTOM_PREFIX = "fr:custom:"; // fr:custom:templates / fr:custom:themes
const LEGACY_KEY = "fr:autosave";

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err?.name === "QuotaExceededError" ? "quota" : "unavailable" };
  }
}

function remove(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* nothing to do */
  }
}

export function newId() {
  return "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/* ---------- projects ---------- */

/** @returns {{id, name, updated}[]} newest first */
export function listProjects() {
  const index = read(INDEX_KEY, []);
  return [...index].sort((a, b) => (b.updated ?? "").localeCompare(a.updated ?? ""));
}

export function saveProjectAs(id, project) {
  const res = write(PROJECT_PREFIX + id, project);
  if (!res.ok) return res;
  const index = read(INDEX_KEY, []).filter((e) => e.id !== id);
  index.push({ id, name: project.name ?? "Untitled race", updated: new Date().toISOString() });
  return write(INDEX_KEY, index);
}

export function loadProjectById(id) {
  const project = read(PROJECT_PREFIX + id, null);
  // Any numeric envelope version is acceptable — migrateProject() (called by
  // the app on open) handles upgrading older formats. Requiring an exact
  // version here meant every project saved under a newer envelope (v4+)
  // silently failed to reload, forever, since the version was introduced.
  return typeof project?.frontrunner === "number" ? project : null;
}

export function deleteProject(id) {
  remove(PROJECT_PREFIX + id);
  const index = read(INDEX_KEY, []).filter((e) => e.id !== id);
  write(INDEX_KEY, index);
}

export function duplicateProject(id) {
  const project = loadProjectById(id);
  if (!project) return null;
  const copy = structuredClone(project);
  copy.name = `${copy.name} copy`;
  const newProjectId = newId();
  const res = saveProjectAs(newProjectId, copy);
  return res.ok ? newProjectId : null;
}

/** One-time migrations: round-1 single-slot autosave, and the custom-library
 * key rename after "template" became "layout". */
export function migrateLegacy() {
  const legacy = read(LEGACY_KEY, null);
  if (legacy?.frontrunner === 1) {
    saveProjectAs(newId(), legacy);
    remove(LEGACY_KEY);
  }
  const oldCustom = read(CUSTOM_PREFIX + "templates", null);
  if (oldCustom) {
    const existing = read(CUSTOM_PREFIX + "layouts", []);
    write(CUSTOM_PREFIX + "layouts", [...existing, ...oldCustom]);
    remove(CUSTOM_PREFIX + "templates");
  }
}

/** Approximate bytes used by frontrunner keys. */
export function storageUsage() {
  let bytes = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith("fr:")) bytes += key.length + (localStorage.getItem(key)?.length ?? 0);
    }
  } catch {
    /* unavailable */
  }
  return bytes;
}

/* ---------- custom templates & themes ---------- */

/** kind: "templates" | "themes" */
export function listCustom(kind) {
  return read(CUSTOM_PREFIX + kind, []);
}

export function saveCustom(kind, item) {
  const list = listCustom(kind).filter((x) => x.id !== item.id);
  list.push(item);
  return write(CUSTOM_PREFIX + kind, list);
}

export function deleteCustom(kind, id) {
  const list = listCustom(kind).filter((x) => x.id !== id);
  return write(CUSTOM_PREFIX + kind, list);
}

/* ---------- misc ---------- */

export function debounce(fn, ms) {
  let id = null;
  return (...args) => {
    clearTimeout(id);
    id = setTimeout(() => fn(...args), ms);
  };
}
