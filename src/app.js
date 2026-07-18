// frontrunner — app.js
// State machine + wiring. Screens: empty → mapping → stage.
// Round 2: editor panel, project library, snapshot export, viewer mode.

// Captured before any DOM mutation — this is the source of snapshot exports.
const PRISTINE = "<!doctype html>\n" + document.documentElement.outerHTML;

import { parseCSV, detectShape, normalize, temporalType, sniffProject } from "./parse.js";
import { precompute, frameState, Playback, EASINGS } from "./engine.js";
import { Painter } from "./render.js";
import { LAYOUTS, THEMES, DEFAULT_SETTINGS, DEFAULT_BRANDING, sampleCSV, SAMPLE_NAME } from "./builtins.js";
import { validateLayout, validateSettings, validateBranding, validateEvents, validateTheme, parseUserJSON, isHexColor, toSixDigitHex } from "./editors.js";
import { migrateProject } from "./migrate.js";
import { VERSION } from "./version.js";
import * as share from "./share.js";
import * as store from "./store.js";

const $ = (id) => document.getElementById(id);

const VIEWER = Boolean(window.__FR_VIEWER__);

const state = {
  screen: "empty",
  projectId: null,
  parsed: null, // { headers, rows } — live when re-mapping is possible
  rawCSV: null, // original CSV text; travels in the envelope so reopened projects can re-map
  pendingImages: {}, // entity -> URL, entered on the mapping screen before Build race
  shapeInfo: null,
  dataset: null,
  pre: null,
  layout: structuredClone(LAYOUTS[0]),
  settings: structuredClone(DEFAULT_SETTINGS),
  theme: structuredClone(THEMES[0]),
  branding: structuredClone(DEFAULT_BRANDING),
  events: [],
  followedEntity: null,
  painter: null,
  playback: null,
  name: "Untitled race",
};

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------- helpers ---------- */

function show(screen) {
  state.screen = screen;
  for (const s of ["empty", "mapping", "stage"]) {
    $(`screen-${s}`).classList.toggle("screen--active", s === screen);
  }
  const onStage = screen === "stage";
  for (const id of ["sel-layout", "sel-theme", "btn-panel", "btn-share", "btn-export", "btn-new", "lbl-layout", "lbl-theme"]) {
    $(id).hidden = !onStage || VIEWER;
  }
  if (!onStage) $("export-menu").hidden = true;
  if (screen === "empty") renderProjectList();
}

let toastTimer;
function toast(msg, ms = 3200) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("toast--show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("toast--show"), ms);
}

function applyTheme(theme) {
  for (const [k, v] of Object.entries(theme.vars)) {
    document.documentElement.style.setProperty(k, v);
  }
  state.painter?.setTheme(theme);
  state.painter?.reflow();
  repaint();
}

function currentProject() {
  return share.makeProject({
    name: state.name,
    dataset: state.dataset,
    mapping: state.shapeInfo,
    layout: state.layout,
    settings: state.settings,
    theme: state.theme,
    branding: state.branding,
    events: validateEvents(state.events).events.length ? validateEvents(state.events).events : undefined,
    followed: state.followedEntity || undefined,
    raw: state.rawCSV ? { csv: state.rawCSV } : undefined,
  });
}

const autosave = store.debounce(() => {
  if (!state.dataset || VIEWER) return;
  if (!state.projectId) state.projectId = store.newId();
  const res = store.saveProjectAs(state.projectId, currentProject());
  const el = $("save-state");
  if (!res.ok) {
    el.textContent = "not saved — export to keep";
    el.classList.add("hd__save--warn");
  } else {
    const usage = store.storageUsage();
    const nearQuota = usage > 4 * 1024 * 1024; // ~80% of the typical 5 MB
    el.textContent = nearQuota ? `saved · storage ${(usage / 1024).toFixed(0)} KB — nearly full` : "saved";
    el.classList.toggle("hd__save--warn", nearQuota);
  }
}, 1000);

function touch() {
  repaint();
  autosave();
}

/** Reset to a blank slate and return to the landing screen — shared by the
 * "New" button and clicking the header wordmark. */
function goToLanding() {
  state.playback?.pause();
  history.replaceState(null, "", location.pathname);
  state.projectId = null;
  state.name = "Untitled race";
  state.parsed = null;
  state.rawCSV = null;
  state.pendingImages = {};
  state.layout = structuredClone(LAYOUTS[0]);
  state.settings = structuredClone(DEFAULT_SETTINGS);
  state.theme = structuredClone(THEMES[0]);
  state.branding = structuredClone(DEFAULT_BRANDING);
  $("project-name").value = state.name;
  show("empty");
}

function repaint() {
  if (state.painter && state.playback) {
    state.painter.paint(frameState(state.dataset, state.pre, state.settings, state.playback.t));
  }
}

/** Total-per-period curve above the scrubber. Gated by settings.showSparkline;
 * drawn in a 0..100 x 0..24 viewBox so it scales with the scrubber's width. */
function renderSparkline() {
  const spark = $("scrub-spark");
  if (!state.dataset || !state.settings.showSparkline) {
    spark.style.display = "none";
    return;
  }
  spark.style.display = "";
  const P = state.dataset.periods.length;
  const E = state.dataset.entities.length;
  const totals = state.dataset.periods.map((_, p) => {
    let sum = 0;
    for (let e = 0; e < E; e++) {
      const v = state.dataset.values[p * E + e];
      if (!Number.isNaN(v)) sum += v;
    }
    return sum;
  });
  const maxTotal = Math.max(1e-9, ...totals);
  const pts = totals.map((v, p) => {
    const x = P > 1 ? (p / (P - 1)) * 100 : 50;
    const y = 22 - (v / maxTotal) * 20;
    return `${x},${y}`;
  });
  spark.innerHTML = `<path d="M${pts.join(" L")}" />`;
}

function download(filename, text, type = "application/json") {
  const blob = new Blob([text], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function safeName() {
  return state.name.replace(/[^\w\- ]+/g, "").trim() || "race";
}

/* ---------- input handling ---------- */

function handleText(text, filename = "") {
  const proj = sniffProject(text);
  if (proj) return openProject(proj, { assignNewId: true });
  const parsed = parseCSV(text);
  if (parsed.headers.length < 2 || parsed.rows.length === 0) {
    toast("That doesn't look like a CSV — need a header row and at least one data row.");
    return;
  }
  state.parsed = parsed;
  state.rawCSV = text;
  state.pendingImages = {};
  state.projectId = null; // new data = new race; re-mapping keeps the id (see buildRace)
  state.shapeInfo = detectShape(parsed.headers, parsed.rows);
  if (filename) state.name = filename.replace(/\.[^.]+$/, "");
  $("project-name").value = state.name;
  renderMapping();
  show("mapping");
}

function readFile(file) {
  const reader = new FileReader();
  reader.onload = () => handleText(String(reader.result), file.name);
  reader.onerror = () => toast("Couldn't read that file.");
  reader.readAsText(file);
}

async function fetchCSV(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(String(res.status));
    handleText(await res.text(), url.split("/").pop() ?? "");
  } catch {
    toast("Couldn't fetch that URL — the source may block cross-origin requests. Download the file and drop it here instead.");
  }
}

/* ---------- project list (empty screen) ---------- */

function renderProjectList() {
  const projects = store.listProjects();
  const section = $("projects");
  section.hidden = projects.length === 0;
  if (projects.length === 0) return;

  const list = $("projects-list");
  list.textContent = "";
  for (const p of projects) {
    const li = document.createElement("li");
    li.className = "projects__item";
    const open = document.createElement("button");
    open.className = "projects__open";
    open.textContent = p.name;
    open.addEventListener("click", () => {
      const project = store.loadProjectById(p.id);
      if (project) {
        state.projectId = p.id;
        openProject(project);
      } else {
        toast("That race couldn't be loaded.");
      }
    });
    const date = document.createElement("span");
    date.className = "projects__date";
    date.textContent = (p.updated ?? "").slice(0, 10);
    const ren = document.createElement("button");
    ren.className = "projects__act";
    ren.textContent = "rename";
    ren.addEventListener("click", () => {
      const input = document.createElement("input");
      input.className = "field";
      input.value = p.name;
      input.style.flex = "1";
      const done = (commit) => {
        if (commit) {
          const name = input.value.trim();
          const project = store.loadProjectById(p.id);
          if (name && project) {
            project.name = name;
            store.saveProjectAs(p.id, project);
          }
        }
        renderProjectList();
      };
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") done(true);
        if (e.key === "Escape") done(false);
      });
      input.addEventListener("blur", () => done(true));
      open.replaceWith(input);
      input.focus();
      input.select();
    });
    const dup = document.createElement("button");
    dup.className = "projects__act";
    dup.textContent = "duplicate";
    dup.addEventListener("click", () => {
      store.duplicateProject(p.id);
      renderProjectList();
    });
    const del = document.createElement("button");
    del.className = "projects__act";
    del.textContent = "delete";
    del.addEventListener("click", () => {
      if (del.dataset.armed) {
        store.deleteProject(p.id);
        renderProjectList();
      } else {
        del.dataset.armed = "1";
        del.textContent = "really delete?";
        setTimeout(() => {
          delete del.dataset.armed;
          del.textContent = "delete";
        }, 2500);
      }
    });
    li.append(open, date, ren, dup, del);
    list.append(li);
  }
  const kb = store.storageUsage() / 1024;
  $("storage-usage").textContent = `${projects.length} saved race${projects.length === 1 ? "" : "s"} · ${kb.toFixed(0)} KB of ~5,000 KB local storage`;
}

/* ---------- mapping screen ---------- */

function renderMapping() {
  const { headers, rows } = state.parsed;
  const info = state.shapeInfo;
  $("shape-badge").textContent = info.shape + " format";

  const grid = $("mapping-grid");
  grid.textContent = "";
  const mkSelect = (labelText, key, options, value) => {
    const wrap = document.createElement("div");
    const label = document.createElement("label");
    label.className = "lbl";
    label.textContent = labelText;
    const sel = document.createElement("select");
    sel.className = "sel";
    for (const o of options) {
      const opt = document.createElement("option");
      opt.value = o;
      opt.textContent = o;
      if (o === value) opt.selected = true;
      sel.append(opt);
    }
    sel.addEventListener("change", () => {
      info.mapping[key] = sel.value;
      renderMapping();
    });
    wrap.append(label, sel);
    grid.append(wrap);
  };

  const shapeWrap = document.createElement("div");
  shapeWrap.className = "mapping__shape";
  const shapeLabel = document.createElement("label");
  shapeLabel.className = "lbl";
  shapeLabel.textContent = "Shape";
  const shapeSel = document.createElement("select");
  shapeSel.className = "sel";
  for (const s of ["long", "wide"]) {
    const opt = document.createElement("option");
    opt.value = s;
    opt.textContent = s === "long" ? "Long (one row per period)" : "Wide (one column per period)";
    if (s === info.shape) opt.selected = true;
    shapeSel.append(opt);
  }
  shapeSel.addEventListener("change", () => {
    state.shapeInfo = reshape(shapeSel.value, headers);
    renderMapping();
  });
  shapeWrap.append(shapeLabel, shapeSel);
  grid.append(shapeWrap);

  const mkOptionalSelect = (labelText, key) => {
    const wrap = document.createElement("div");
    const label = document.createElement("label");
    label.className = "lbl";
    label.textContent = labelText;
    const sel = document.createElement("select");
    sel.className = "sel";
    for (const o of ["— none", ...headers]) {
      const opt = document.createElement("option");
      opt.value = o === "— none" ? "" : o;
      opt.textContent = o;
      if ((info.mapping[key] ?? "") === opt.value) opt.selected = true;
      sel.append(opt);
    }
    sel.addEventListener("change", () => {
      info.mapping[key] = sel.value || null;
      renderMapping();
    });
    wrap.append(label, sel);
    grid.append(wrap);
  };

  const mkImageSelect = () => {
    const wrap = document.createElement("div");
    const label = document.createElement("label");
    label.className = "lbl";
    label.textContent = "Image URL column";
    const sel = document.createElement("select");
    sel.className = "sel";
    for (const o of ["— none", ...headers]) {
      const opt = document.createElement("option");
      opt.value = o === "— none" ? "" : o;
      opt.textContent = o;
      if ((info.mapping.image ?? "") === opt.value) opt.selected = true;
      sel.append(opt);
    }
    sel.addEventListener("change", () => {
      info.mapping.image = sel.value || null;
      renderMapping();
    });
    wrap.append(label, sel);
    grid.append(wrap);
  };

  if (info.shape === "long") {
    mkSelect("Time column", "time", headers, info.mapping.time);
    mkSelect("Entity column", "entity", headers, info.mapping.entity);
    mkSelect("Value column", "value", headers, info.mapping.value);
    mkImageSelect();
    mkOptionalSelect("Category column", "category");
    mkOptionalSelect("Color column (#rrggbb)", "color");
  } else {
    mkSelect("Entity column", "entity", headers, info.mapping.entity);
    const note = document.createElement("div");
    const periods = info.mapping.periods;
    note.innerHTML = `<label class="lbl">Period columns</label><span style="font-family:var(--fr-font-mono);font-size:12px">${periods.length} detected (${periods[0]} … ${periods[periods.length - 1]})</span>`;
    grid.append(note);
    mkImageSelect();
    mkOptionalSelect("Category column", "category");
    mkOptionalSelect("Color column (#rrggbb)", "color");
  }

  // No image column? Offer to add URLs right here, as part of the CSV
  // onboarding — rather than only discoverable later in the Data tab.
  const imgSection = $("mapping-images");
  imgSection.textContent = "";
  imgSection.hidden = Boolean(info.mapping.image);
  if (!info.mapping.image) {
    const idx = headers.indexOf(info.mapping.entity);
    const entities = [];
    if (idx >= 0) {
      const seen = new Set();
      for (const r of rows) {
        const name = (r[idx] ?? "").trim();
        if (name && !seen.has(name)) {
          seen.add(name);
          entities.push(name);
        }
      }
    }
    imgSection.append(el("p", { className: "panel__section", textContent: "Add image URLs (optional)" }));
    imgSection.append(
      el("p", { className: "drop__hint", style: "margin:0 0 8px" }, [
        "No image column detected. Paste one URL per entity if you'd like flags, logos, or photos on the bars — or skip this and add them later.",
      ])
    );
    state.pendingImages ??= {};
    for (const name of entities.slice(0, 30)) {
      const input = el("input", { className: "field", value: state.pendingImages[name] ?? "", placeholder: "https://…" });
      input.addEventListener("change", () => {
        const v = input.value.trim();
        if (v) state.pendingImages[name] = v;
        else delete state.pendingImages[name];
      });
      imgSection.append(el("div", { className: "panel__row" }, [labeled(name, input)]));
    }
    if (entities.length > 30) {
      imgSection.append(el("p", { className: "drop__hint", textContent: `+ ${entities.length - 30} more — showing the first 30 here.` }));
    }
  }

  const table = $("preview-table");
  table.textContent = "";
  const thead = document.createElement("tr");
  for (const h of headers.slice(0, 8)) {
    const th = document.createElement("th");
    th.textContent = h;
    thead.append(th);
  }
  table.append(thead);
  for (const r of rows.slice(0, 8)) {
    const tr = document.createElement("tr");
    for (const c of r.slice(0, 8)) {
      const td = document.createElement("td");
      td.textContent = c;
      tr.append(td);
    }
    table.append(tr);
  }
}

function reshape(shape, headers) {
  if (shape === "wide") {
    const temporal = headers.filter((h) => temporalType(h));
    const nonTemporal = headers.filter((h) => !temporalType(h));
    return {
      shape: "wide",
      confidence: 0.5,
      mapping: { entity: nonTemporal[0] ?? headers[0], periods: temporal.length ? temporal : headers.slice(1), image: null, category: null, color: null },
    };
  }
  return {
    shape: "long",
    confidence: 0.5,
    mapping: { time: headers[0], entity: headers[1] ?? headers[0], value: headers[2] ?? headers[headers.length - 1], image: null, category: null, color: null },
  };
}

/* ---------- stage ---------- */

function buildRace() {
  const ds = normalize(state.parsed.headers, state.parsed.rows, state.shapeInfo);
  for (const w of ds.warnings) toast(w, 4500);
  if (ds.periods.length < 2) return;
  if (state.pendingImages && Object.keys(state.pendingImages).length) {
    Object.assign(ds.images, state.pendingImages);
  }
  state.pendingImages = {};
  state.dataset = ds;
  if (!state.projectId) state.projectId = store.newId();
  openStage(reducedMotion ? false : true);
}

function openProject(rawProject, { assignNewId = false } = {}) {
  try {
    const project = migrateProject(rawProject);
    state.name = project.name ?? "Untitled race";
    state.dataset = share.hydrateDataset(project.dataset);
    state.shapeInfo = project.mapping;
    state.rawCSV = typeof project.raw?.csv === "string" ? project.raw.csv : null;
    state.parsed = state.rawCSV ? parseCSV(state.rawCSV) : null; // re-mapping possible when raw travelled
    state.layout = validateLayout(project.layout ?? LAYOUTS[0]).layout;
    state.settings = validateSettings(project.settings ?? DEFAULT_SETTINGS).settings;
    state.theme = validateTheme(project.theme ?? THEMES[0]).theme;
    // Migration: barThickness lived in Settings before v1.7.0. If an old
    // project has it and the theme has no explicit override, carry it across
    // so the race doesn't silently change appearance on reopen.
    const legacyThickness = project.settings?.barThickness;
    if (typeof legacyThickness === "number" && !project.theme?.vars?.["--fr-bar-thickness"]) {
      state.theme.vars["--fr-bar-thickness"] = String(Math.max(0.2, Math.min(0.95, legacyThickness)));
    }
    state.branding = validateBranding(project.branding ?? DEFAULT_BRANDING).branding;
    state.events = validateEvents(project.events).events;
    state.followedEntity =
      typeof project.followed === "string" && state.dataset.entities.includes(project.followed) ? project.followed : null;
    if (assignNewId) state.projectId = store.newId();
    $("project-name").value = state.name;
    openStage(VIEWER && !reducedMotion);
  } catch {
    toast("That project couldn't be opened — it may be from a newer version.");
  }
}

function openStage(autoplay) {
  state.pre = precompute(state.dataset);
  const svg = $("stage-svg");
  show("stage");
  syncSelect("sel-layout", "layouts", state.layout);
  syncSelect("sel-theme", "themes", state.theme);
  applyTheme(state.theme);
  state.painter = new Painter(svg, state.dataset, state.layout, state.settings, state.theme, state.branding, state.events, state.followedEntity);
  state.painter.onBarClick = (entity) => {
    state.followedEntity = state.painter.setFollowed(entity);
    repaint();
    autosave();
  };

  const P = state.dataset.periods.length;
  const scrub = $("scrubber");
  scrub.max = String(P - 1);

  const ticks = $("scrub-ticks");
  ticks.textContent = "";
  const count = Math.min(P, 8);
  for (let i = 0; i < count; i++) {
    const s = document.createElement("span");
    const pIdx = Math.round((i / (count - 1)) * (P - 1));
    s.textContent = state.dataset.periods[pIdx];
    ticks.append(s);
  }

  renderSparkline();

  state.playback?.pause();
  state.playback = new Playback({
    length: P,
    msPerPeriod: state.settings.msPerPeriod,
    holdAtPeriod: (p) => {
      const s = state.settings;
      // Read live — events may be added/removed after the race is built.
      const isEvent = state.events?.some((e) => String(e.period) === String(state.dataset.periods[p]));
      return Math.max(s.endPeriodPause ?? 0, isEvent ? (s.eventPause ?? 0) : 0);
    },
    onFrame: (t) => {
      scrub.value = String(t);
      state.painter.paint(frameState(state.dataset, state.pre, state.settings, t));
    },
    onStateChange: () => {
      $("btn-play").textContent = state.playback.playing ? "⏸" : "▶";
    },
  });

  // The SVG has just become visible; measure after layout settles.
  requestAnimationFrame(() => {
    state.painter.resize();
    state.playback.seek(state.playback.t);
    if (autoplay) state.playback.play();
  });

  renderPanel();
  autosave();
}

/* ---------- layout & theme selects ---------- */

function libraryFor(kind) {
  const builtins = kind === "layouts" ? LAYOUTS : THEMES;
  return { builtins, custom: store.listCustom(kind) };
}

function syncSelect(selId, kind, current) {
  const sel = $(selId);
  const { builtins, custom } = libraryFor(kind);
  sel.textContent = "";
  const mkGroup = (label, items) => {
    if (items.length === 0) return;
    const group = document.createElement("optgroup");
    group.label = label;
    for (const item of items) {
      const opt = document.createElement("option");
      opt.value = item.id;
      opt.textContent = item.name;
      group.append(opt);
    }
    sel.append(group);
  };
  mkGroup("Built-in", builtins);
  mkGroup("Yours", custom);
  const known = [...builtins, ...custom].some((x) => x.id === current.id);
  if (!known) {
    const opt = document.createElement("option");
    opt.value = current.id;
    opt.textContent = current.name + " (from project)";
    sel.append(opt);
  }
  sel.value = current.id;
}

function pickFromLibrary(kind, id) {
  const { builtins, custom } = libraryFor(kind);
  const found = [...builtins, ...custom].find((x) => x.id === id);
  return found ? structuredClone(found) : null;
}

function setLayout(layout) {
  state.layout = layout;
  state.painter?.setLayout(layout);
  renderLayoutPane();
  touch();
}

function setSettings(settings) {
  state.settings = settings;
  if (state.playback) state.playback.msPerPeriod = settings.msPerPeriod;
  state.painter?.setSettings(settings);
  renderSettingsPane();
  touch();
}

function setBranding(branding) {
  state.branding = branding;
  state.painter?.setBranding(branding);
  touch();
}

function setTheme(theme) {
  state.theme = theme;
  applyTheme(theme);
  renderThemePane();
  autosave();
}

/* ---------- editor panel ---------- */

function renderPanel() {
  renderDataPane();
  renderSettingsPane();
  renderLayoutPane();
  renderThemePane();
  renderBrandPane();
}

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  if (props.className) node.className = props.className;
  for (const c of children) node.append(c);
  return node;
}

function labeled(text, control) {
  return el("div", {}, [el("label", { className: "lbl", textContent: text }), control]);
}

function renderDataPane() {
  const pane = $("panel-data");
  pane.textContent = "";
  if (!state.dataset) return;
  const ds = state.dataset;
  pane.append(
    el("p", { className: "panel__section", textContent: "Dataset" }),
    el("p", { className: "panel__stat", innerHTML: `<b>${ds.entities.length}</b> entities` }),
    el("p", {
      className: "panel__stat",
      innerHTML: `<b>${ds.periods.length}</b> periods (${ds.periods[0]} → ${ds.periods[ds.periods.length - 1]})`,
    }),
    el("p", { className: "panel__stat", innerHTML: `shape: <b>${ds.meta.shape ?? "?"}</b>` })
  );
  const cats = [...new Set(Object.values(ds.categories ?? {}))];
  if (cats.length) {
    pane.append(el("p", { className: "panel__stat", innerHTML: `<b>${cats.length}</b> categories: ${cats.join(", ")}` }));
  }
  // Entity images are sourced from the CSV alone (an auto-detected column, or
  // manual entry on the mapping screen before the race is built) — no
  // separate post-build editing surface here anymore. Correcting a URL means
  // re-uploading or re-mapping, so the CSV stays the single source of truth.

  // Events: (period, text) rows rendered as captions during the race.
  pane.append(el("hr", { className: "panel__hr" }), el("p", { className: "panel__section", textContent: "Events" }));
  const evWrap = el("div");
  const rebuildEvents = () => {
    evWrap.textContent = "";
    state.events.forEach((ev, i) => {
      const periodSel = el("select", { className: "sel sel--compact" });
      for (const pd of ds.periods) {
        periodSel.append(el("option", { value: String(pd), textContent: String(pd), selected: String(pd) === String(ev.period) }));
      }
      periodSel.addEventListener("change", () => {
        ev.period = periodSel.value;
        commitEvents();
      });
      const text = el("input", { className: "field", value: ev.text, placeholder: "What happened…" });
      text.addEventListener("change", () => {
        ev.text = text.value;
        commitEvents();
      });
      const del = el("button", { className: "link link--danger", textContent: "remove" });
      del.addEventListener("click", () => {
        state.events.splice(i, 1);
        commitEvents();
        rebuildEvents();
      });
      evWrap.append(el("div", { className: "panel__row panel__row--event" }, [periodSel, text, del]));
    });
  };
  // Deliberately does NOT run validateEvents here: it drops entries missing
  // a period or text, which is normal mid-edit (e.g. date picked, text not
  // typed yet) — validating away an in-progress row would silently orphan
  // the object the inputs' closures point to. Strict validation happens
  // only at read boundaries: currentProject() (export/save) and openProject().
  const commitEvents = () => {
    state.painter?.setEvents(state.events);
    repaint();
    autosave();
  };
  const addEvent = el("button", { className: "link", textContent: "+ Add event" });
  addEvent.addEventListener("click", () => {
    state.events.push({ period: String(ds.periods[0]), text: "" });
    rebuildEvents();
    evWrap.querySelector(".panel__row--event:last-child input")?.focus();
  });
  rebuildEvents();
  pane.append(evWrap, addEvent);

  if (state.parsed) {
    const btn = el("button", { className: "btn", textContent: "Edit mapping" });
    btn.addEventListener("click", () => {
      state.playback?.pause();
      renderMapping();
      show("mapping");
    });
    pane.append(el("hr", { className: "panel__hr" }), btn);
  } else {
    pane.append(
      el("hr", { className: "panel__hr" }),
      el("p", {
        className: "drop__hint",
        textContent: "This race was opened from a saved project, so the original CSV rows aren't available to re-map. Drop the CSV again to change columns.",
      })
    );
  }
}

function renderSettingsPane() {
  const pane = $("panel-settings");
  pane.textContent = "";
  const sg = state.settings;
  const commit = () => setSettings(validateSettings(sg).settings);

  pane.append(el("p", { className: "panel__section", textContent: "Field" }));
  const topN = el("input", { className: "field", type: "number", min: 1, max: 50, value: sg.topN });
  topN.addEventListener("change", () => {
    sg.topN = topN.value;
    commit();
  });
  pane.append(el("div", { className: "panel__row" }, [labeled("Top N bars", topN)]));

  pane.append(el("hr", { className: "panel__hr" }), el("p", { className: "panel__section", textContent: "Motion" }));
  const speed = el("input", { className: "field", type: "number", min: 100, max: 10000, step: 100, value: sg.msPerPeriod });
  speed.addEventListener("change", () => {
    sg.msPerPeriod = speed.value;
    commit();
  });
  const easing = el("select", { className: "sel" });
  const EASING_LABELS = { linear: "Linear", easeOutQuad: "Ease out", easeInOutCubic: "Ease in-out" };
  for (const e of Object.keys(EASINGS)) easing.append(el("option", { value: e, textContent: EASING_LABELS[e] ?? e, selected: e === sg.easing }));
  easing.addEventListener("change", () => {
    sg.easing = easing.value;
    commit();
  });
  pane.append(el("div", { className: "panel__row--split" }, [labeled("ms / period", speed), labeled("Easing", easing)]));
  const periodPause = el("input", { className: "field", type: "number", min: 0, max: 10000, step: 100, value: sg.endPeriodPause });
  periodPause.addEventListener("change", () => {
    sg.endPeriodPause = periodPause.value;
    commit();
  });
  const eventPause = el("input", { className: "field", type: "number", min: 0, max: 10000, step: 100, value: sg.eventPause });
  eventPause.addEventListener("change", () => {
    sg.eventPause = eventPause.value;
    commit();
  });
  pane.append(el("div", { className: "panel__row--split" }, [labeled("Pause / period (ms)", periodPause), labeled("Pause on events (ms)", eventPause)]));
  const rankDir = el("select", { className: "sel" });
  for (const [v, label] of [["top", "Top N (largest)"], ["bottom", "Bottom N (smallest)"]]) {
    rankDir.append(el("option", { value: v, textContent: label, selected: v === sg.rankDirection }));
  }
  rankDir.addEventListener("change", () => {
    sg.rankDirection = rankDir.value;
    commit();
  });
  const scale = el("select", { className: "sel" });
  for (const [v, label] of [["linear", "Linear"], ["log", "Log"]]) {
    scale.append(el("option", { value: v, textContent: label, selected: v === sg.valueScale }));
  }
  scale.addEventListener("change", () => {
    sg.valueScale = scale.value;
    commit();
  });
  pane.append(el("div", { className: "panel__row--split" }, [labeled("Race direction", rankDir), labeled("Value scale", scale)]));
  const ghost = el("select", { className: "sel" });
  for (const [v, label] of [["off", "Off"], ["median", "Median"], ["mean", "Mean"]]) {
    ghost.append(el("option", { value: v, textContent: label, selected: v === sg.ghostBar }));
  }
  ghost.addEventListener("change", () => {
    sg.ghostBar = ghost.value;
    commit();
  });
  pane.append(el("div", { className: "panel__row" }, [labeled("Reference line", ghost)]));
  const sparkToggle = el("input", { type: "checkbox", checked: sg.showSparkline });
  sparkToggle.addEventListener("change", () => {
    sg.showSparkline = sparkToggle.checked;
    renderSparkline();
    commit();
  });
  pane.append(el("label", { className: "panel__check" }, [sparkToggle, document.createTextNode("Show sparkline")]));

  pane.append(el("hr", { className: "panel__hr" }), el("p", { className: "panel__section", textContent: "Value format" }));
  const notation = el("select", { className: "sel" });
  for (const n of ["compact", "full"]) notation.append(el("option", { value: n, textContent: n === "compact" ? "Compact (1.4B)" : "Full (1,400,000,000)", selected: n === sg.valueFormat.notation }));
  notation.addEventListener("change", () => {
    sg.valueFormat.notation = notation.value;
    commit();
  });
  const decimals = el("input", { className: "field", type: "number", min: 0, max: 3, value: sg.valueFormat.decimals });
  decimals.addEventListener("change", () => {
    sg.valueFormat.decimals = decimals.value;
    commit();
  });
  pane.append(el("div", { className: "panel__row--split" }, [labeled("Notation", notation), labeled("Decimals", decimals)]));
  const prefix = el("input", { className: "field", value: sg.valueFormat.prefix, placeholder: "e.g. R" });
  prefix.addEventListener("change", () => {
    sg.valueFormat.prefix = prefix.value;
    commit();
  });
  const suffix = el("input", { className: "field", value: sg.valueFormat.suffix, placeholder: "e.g. t CO₂" });
  suffix.addEventListener("change", () => {
    sg.valueFormat.suffix = suffix.value;
    commit();
  });
  pane.append(el("div", { className: "panel__row--split" }, [labeled("Prefix", prefix), labeled("Suffix", suffix)]));

  pane.append(el("hr", { className: "panel__hr" }), el("p", { className: "panel__section", textContent: "Axis" }));
  const axisScale = el("select", { className: "sel" });
  for (const [v, label] of [["dynamic", "Dynamic (rescales with the leader)"], ["fixed", "Fixed (global maximum)"]]) {
    axisScale.append(el("option", { value: v, textContent: label, selected: v === sg.axisScale }));
  }
  axisScale.addEventListener("change", () => {
    sg.axisScale = axisScale.value;
    commit();
  });
  pane.append(el("div", { className: "panel__row" }, [labeled("Scale", axisScale)]));

  pane.append(el("hr", { className: "panel__hr" }), el("p", { className: "panel__section", textContent: "Period clock" }));
  const plf = el("select", { className: "sel" });
  for (const [v, label] of [["raw", "As-is"], ["year", "Year only"], ["month-year", "Mon YYYY"], ["full-date", "Mon D, YYYY"]]) {
    plf.append(el("option", { value: v, textContent: label, selected: v === sg.periodLabelFormat }));
  }
  plf.addEventListener("change", () => {
    sg.periodLabelFormat = plf.value;
    commit();
  });
  pane.append(el("div", { className: "panel__row" }, [labeled("Label format", plf)]));
}

function renderLayoutPane() {
  const pane = $("panel-layout");
  pane.textContent = "";
  const t = state.layout;
  const commit = () => setLayout(validateLayout(t).layout);

  // Soft warning only — stacking is an intentional painter feature (blocks
  // sharing an anchor reserve-and-stack), but a pile-up is worth flagging
  // since it's rarely what someone meant to do.
  const anchorCounts = {};
  for (const [slot, anchor] of Object.entries(t.slots)) {
    if (slot === "axis" || anchor === "off") continue;
    anchorCounts[anchor] = (anchorCounts[anchor] ?? []).concat(slot);
  }
  const crowded = Object.entries(anchorCounts).filter(([, slots]) => slots.length > 1);
  if (crowded.length) {
    const names = { title: "Title", logo: "Logo", clock: "Clock", total: "Total", source: "Source", legend: "Legend", caption: "Caption" };
    const msg = crowded.map(([anchor, slots]) => `${slots.map((s) => names[s] ?? s).join(" + ")} share ${anchor}`).join("; ");
    pane.append(el("p", { className: "panel__warn", textContent: `Heads up: ${msg} — they'll stack rather than overlap.` }));
  }

  pane.append(el("p", { className: "panel__section", textContent: "Placeholders" }));
  const anchorNames = {
    "top-left": "Top left",
    "top-center": "Top center",
    "top-right": "Top right",
    "bottom-left": "Bottom left",
    "bottom-center": "Bottom center",
    "bottom-right": "Bottom right",
    off: "— off",
  };
  const slotNames = {
    title: "Title & subtitle",
    logo: "Logo",
    clock: "Period clock",
    total: "Running total",
    source: "Source & link",
    legend: "Category legend",
    caption: "Event caption",
  };
  for (const [slot, label] of Object.entries(slotNames)) {
    const sel = el("select", { className: "sel" });
    for (const [a, an] of Object.entries(anchorNames)) {
      sel.append(el("option", { value: a, textContent: an, selected: a === t.slots[slot] }));
    }
    sel.addEventListener("change", () => {
      t.slots[slot] = sel.value;
      commit();
    });
    pane.append(el("div", { className: "panel__row" }, [labeled(label, sel)]));
  }
  const axisCb = el("input", { type: "checkbox", checked: t.slots.axis === "top" });
  axisCb.addEventListener("change", () => {
    t.slots.axis = axisCb.checked ? "top" : "off";
    commit();
  });
  pane.append(el("label", { className: "panel__check" }, [axisCb, document.createTextNode("Value axis")]));

  pane.append(el("hr", { className: "panel__hr" }), el("p", { className: "panel__section", textContent: "Bar row" }));
  const labelPos = el("select", { className: "sel" });
  for (const [p, label] of [["outside", "Outside"], ["inside", "Inside"]]) {
    labelPos.append(el("option", { value: p, textContent: label, selected: p === t.bar.labelPosition }));
  }
  labelPos.addEventListener("change", () => {
    t.bar.labelPosition = labelPos.value;
    commit();
  });
  pane.append(el("div", { className: "panel__row" }, [labeled("Entity labels", labelPos)]));
  const imgPos = el("select", { className: "sel" });
  for (const [v, label] of [["inside", "Inside the bar end"], ["overlap", "Overlapping the end"], ["outside", "Outside the bar"]]) {
    imgPos.append(el("option", { value: v, textContent: label, selected: v === (t.bar.imagePosition ?? "inside") }));
  }
  imgPos.addEventListener("change", () => {
    t.bar.imagePosition = imgPos.value;
    commit();
  });
  pane.append(el("div", { className: "panel__row" }, [labeled("Images", imgPos)]));
  for (const [key, label] of [["showRank", "Rank numbers"], ["showValue", "Values"], ["showImage", "Entity images"]]) {
    const cb = el("input", { type: "checkbox", checked: t.bar[key] });
    cb.addEventListener("change", () => {
      t.bar[key] = cb.checked;
      commit();
    });
    pane.append(el("label", { className: "panel__check" }, [cb, document.createTextNode(label)]));
  }

  appendSaveAndRaw(pane, "layouts", () => state.layout, (obj) => {
    const { layout, errors } = validateLayout(obj);
    if (errors.length) toast(errors[0]);
    setLayout(layout);
  });
}

function renderBrandPane() {
  const pane = $("panel-brand");
  pane.textContent = "";
  const b = state.branding;
  const commit = () => setBranding(validateBranding(b).branding);

  const fields = [
    ["title", "Title", "e.g. World population"],
    ["subtitle", "Subtitle", "e.g. Top 10 countries, 1960–2020"],
    ["logoUrl", "Logo URL", "https://…/logo.svg"],
    ["source", "Source line", "e.g. Data: World Bank"],
    ["link", "Link", "https://…"],
  ];
  for (const [key, label, ph] of fields) {
    const input = el("input", { className: "field", value: b[key], placeholder: ph });
    input.addEventListener("change", () => {
      b[key] = input.value;
      commit();
    });
    pane.append(el("div", { className: "panel__row" }, [labeled(label, input)]));
  }
  pane.append(
    el("p", {
      className: "drop__hint",
      textContent: "Where these render is the layout's job — assign each block an anchor in the Layout tab. Logos load by URL; they aren't embedded, so keep the URL public.",
    })
  );
}

function renderThemePane() {
  const pane = $("panel-theme");
  pane.textContent = "";
  const th = state.theme;
  const commit = () => setTheme(validateTheme(th).theme);

  const colorNames = {
    "--fr-bg": "Background",
    "--fr-surface": "Surface",
    "--fr-text": "Text",
    "--fr-text-muted": "Muted text",
    "--fr-accent": "Accent",
    "--fr-axis": "Axis lines",
    "--fr-bar-label": "Bar labels",
    "--fr-bar-label-inside": "Labels inside bars",
  };
  pane.append(el("p", { className: "panel__section", textContent: "Colors" }));
  for (const [key, label] of Object.entries(colorNames)) {
    const v = th.vars[key];
    let control;
    if (isHexColor(v)) {
      control = el("input", { type: "color", value: toSixDigitHex(v) });
      control.addEventListener("input", () => {
        th.vars[key] = control.value;
        commit();
      });
    } else {
      control = el("input", { className: "field", value: v });
      control.style.width = "110px";
      control.addEventListener("change", () => {
        th.vars[key] = control.value;
        commit();
      });
    }
    pane.append(el("div", { className: "color-row" }, [control, el("span", { textContent: label })]));
  }

  pane.append(el("hr", { className: "panel__hr" }), el("p", { className: "panel__section", textContent: "Bar palette" }));
  const swatches = el("div", { className: "swatches" });
  th.palette.forEach((c, i) => {
    const wrap = el("span");
    const input = el("input", { type: "color", value: toSixDigitHex(isHexColor(c) ? c : "#888888") });
    input.addEventListener("input", () => {
      th.palette[i] = input.value;
      commit();
    });
    const x = el("button", { className: "swatch-x", textContent: "×", title: "Remove color" });
    x.addEventListener("click", () => {
      if (th.palette.length <= 1) return toast("The palette needs at least one color.");
      th.palette.splice(i, 1);
      commit();
    });
    wrap.append(input, x);
    swatches.append(wrap);
  });
  const add = el("button", { className: "btn", textContent: "+" });
  add.addEventListener("click", () => {
    th.palette.push("#888888");
    commit();
  });
  swatches.append(add);
  pane.append(swatches);

  pane.append(el("hr", { className: "panel__hr" }), el("p", { className: "panel__section", textContent: "Type & shape" }));
  const fontD = el("input", { className: "field", value: th.vars["--fr-font-display"] });
  fontD.addEventListener("change", () => {
    th.vars["--fr-font-display"] = fontD.value;
    commit();
  });
  pane.append(el("div", { className: "panel__row" }, [labeled("Display font stack", fontD)]));
  const fontM = el("input", { className: "field", value: th.vars["--fr-font-mono"] });
  fontM.addEventListener("change", () => {
    th.vars["--fr-font-mono"] = fontM.value;
    commit();
  });
  pane.append(el("div", { className: "panel__row" }, [labeled("Mono font stack", fontM)]));
  const radius = el("select", { className: "sel" });
  const radiusOptions = [["0", "Square"], ["4", "Soft"], ["10", "Round"], ["pill", "Pill"]];
  const current = String(th.vars["--fr-bar-radius"]);
  if (!radiusOptions.some(([v]) => v === current)) radiusOptions.push([current, `Custom (${current})`]);
  for (const [v, label] of radiusOptions) {
    radius.append(el("option", { value: v, textContent: label, selected: v === current }));
  }
  radius.addEventListener("change", () => {
    th.vars["--fr-bar-radius"] = radius.value;
    commit();
  });
  const thick = el("input", { type: "range", min: 0.2, max: 0.95, step: 0.05, value: th.vars["--fr-bar-thickness"] ?? "0.72" });
  thick.style.width = "100%";
  thick.addEventListener("input", () => {
    th.vars["--fr-bar-thickness"] = String(thick.value);
    commit();
  });
  const clock = el("input", { className: "field", type: "number", min: 24, max: 160, value: th.vars["--fr-period-label-size"] });
  clock.addEventListener("change", () => {
    th.vars["--fr-period-label-size"] = String(clock.value);
    commit();
  });
  pane.append(el("div", { className: "panel__row--split" }, [labeled("Bar radius", radius), labeled("Bar thickness", thick)]));
  pane.append(el("div", { className: "panel__row" }, [labeled("Clock size", clock)]));

  const BG_PRESETS = {
    none: "none",
    glow: "radial-gradient(circle at 20% 10%, color-mix(in srgb, var(--fr-accent) 12%, transparent), transparent 55%)",
    dots: "repeating-radial-gradient(circle at 0 0, var(--fr-border) 0 1.5px, transparent 1.5px 26px)",
  };
  const currentBg = th.vars["--fr-bg-image"] ?? "none";
  const isCustomBg = currentBg !== "none" && !Object.values(BG_PRESETS).includes(currentBg);
  const bgSelect = el("select", { className: "sel" });
  for (const [v, label] of [["none", "None"], ["glow", "Subtle glow"], ["dots", "Dot grid"], ["custom", "Custom image URL"]]) {
    const selected = v === "custom" ? isCustomBg : !isCustomBg && BG_PRESETS[v] === currentBg;
    bgSelect.append(el("option", { value: v, textContent: label, selected }));
  }
  const bgUrlWrap = el("div", { className: "panel__row" });
  bgUrlWrap.style.display = isCustomBg || bgSelect.value === "custom" ? "" : "none";
  const bgUrl = el("input", {
    className: "field",
    placeholder: "https://…",
    value: isCustomBg ? (currentBg.match(/url\("([^"]*)"\)/)?.[1] ?? "") : "",
  });
  bgUrl.addEventListener("change", () => {
    const v = bgUrl.value.trim();
    th.vars["--fr-bg-image"] = v ? `url("${v}")` : "none";
    applyTheme(state.theme); // background is a body-level CSS var, not part of the SVG paint loop
    commit();
  });
  bgUrlWrap.append(labeled("Background image URL", bgUrl));
  bgSelect.addEventListener("change", () => {
    const v = bgSelect.value;
    bgUrlWrap.style.display = v === "custom" ? "" : "none";
    if (v !== "custom") {
      th.vars["--fr-bg-image"] = BG_PRESETS[v];
      applyTheme(state.theme);
      commit();
    }
  });
  pane.append(el("div", { className: "panel__row" }, [labeled("Background", bgSelect)]), bgUrlWrap);

  appendSaveAndRaw(pane, "themes", () => state.theme, (obj) => {
    const { theme, errors } = validateTheme(obj);
    if (errors.length) toast(errors[0]);
    setTheme(theme);
  });
}

/** Shared footer for both editor panes: save-as, delete (custom), raw JSON. */
function appendSaveAndRaw(pane, kind, getCurrent, applyParsed) {
  pane.append(el("hr", { className: "panel__hr" }), el("p", { className: "panel__section", textContent: "Library" }));

  const nameInput = el("input", { className: "field", placeholder: "Name this…", value: "" });
  const saveBtn = el("button", { className: "btn", textContent: "Save as new preset" });
  saveBtn.addEventListener("click", () => {
    const name = nameInput.value.trim();
    if (!name) return toast("Give it a name first.");
    const item = structuredClone(getCurrent());
    item.id = "u-" + name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    item.name = name;
    const res = store.saveCustom(kind, item);
    if (!res.ok) return toast("Couldn't save — local storage is full or unavailable.");
    applyParsed(item);
    syncSelect(kind === "layouts" ? "sel-layout" : "sel-theme", kind, item);
    toast(`Saved "${name}" to your library.`);
  });
  pane.append(el("div", { className: "panel__row--split" }, [el("div", {}, [nameInput]), el("div", {}, [saveBtn])]));

  const current = getCurrent();
  if (String(current.id).startsWith("u-")) {
    const delBtn = el("button", { className: "btn btn--ghost", textContent: `Delete "${current.name}" from library` });
    delBtn.addEventListener("click", () => {
      store.deleteCustom(kind, current.id);
      const fallback = kind === "layouts" ? structuredClone(LAYOUTS[0]) : structuredClone(THEMES[0]);
      applyParsed(fallback);
      syncSelect(kind === "layouts" ? "sel-layout" : "sel-theme", kind, fallback);
      toast("Deleted.");
    });
    pane.append(el("div", { className: "panel__row" }, [delBtn]));
  }

  const rawToggle = el("button", { className: "link", textContent: "Edit as JSON" });
  const rawWrap = el("div", { className: "panel__row" });
  rawWrap.style.display = "none";
  const ta = el("textarea", { className: "rawjson field" });
  const err = el("p", { className: "err" });
  const apply = el("button", { className: "btn", textContent: "Apply JSON" });
  apply.addEventListener("click", () => {
    const res = parseUserJSON(ta.value);
    if (res.error) {
      err.textContent = res.error;
      return;
    }
    err.textContent = "";
    applyParsed(res.value);
  });
  rawToggle.addEventListener("click", () => {
    const open = rawWrap.style.display === "none";
    rawWrap.style.display = open ? "" : "none";
    if (open) ta.value = JSON.stringify(getCurrent(), null, 2);
  });
  rawWrap.append(ta, apply, err);
  pane.append(rawToggle, rawWrap);
}

/* ---------- share / export ---------- */

async function copyShareLink() {
  if (!share.supported()) {
    toast("Share links need a newer browser — export a project file instead.");
    return;
  }
  try {
    const { blob, bytes } = await share.encodeProject(currentProject());
    const url = share.shareUrl(blob);
    await navigator.clipboard.writeText(url);
    if (bytes > share.WARN_BYTES) {
      toast(`Link copied — but it's ${(bytes / 1024).toFixed(0)} KB and may not survive some chat apps. A project file is safer.`);
    } else {
      toast("Share link copied.");
    }
  } catch (err) {
    if (err?.code === "too-large") {
      toast(`This dataset is too big for a link (${(err.bytes / 1024).toFixed(0)} KB compressed). Export a project file instead.`);
    } else {
      toast("Couldn't copy the link — your browser may be blocking clipboard access.");
    }
  }
}

function exportProjectFile() {
  download(`${safeName()}.frontrunner.json`, JSON.stringify(currentProject(), null, 2));
}

function exportSnapshot() {
  const marker = '<script type="module">';
  if (!PRISTINE.includes(marker)) {
    toast("Snapshot export needs the single-file build of frontrunner — this dev copy loads its script externally.");
    return;
  }
  // CLOSE is assembled via char codes so the sequence "</script" can never
  // appear in the emitted bundle — minifiers constant-fold string
  // concatenation and normalize "<\/" escapes, either of which would emit a
  // literal "</script" that terminates the inline <script> tag early.
  const CLOSE = String.fromCharCode(60, 47) + "script>";
  const payload = JSON.stringify(currentProject()).replace(/<\//g, "<\\/");
  const inject = "<script>window.__FR_PROJECT__=" + payload + ";window.__FR_VIEWER__=true;" + CLOSE + "\n";
  const html = PRISTINE.replace(marker, () => inject + marker);
  download(`${safeName()}.race.html`, html, "text/html");
  toast("Snapshot exported — a self-contained page that plays this race anywhere.");
}

/* ---------- wiring ---------- */

function wire() {
  $("project-name").addEventListener("input", (e) => {
    state.name = e.target.value;
    autosave();
  });

  $("sel-layout").addEventListener("change", (e) => {
    const picked = pickFromLibrary("layouts", e.target.value);
    if (picked) setLayout(validateLayout(picked).layout);
  });
  $("sel-theme").addEventListener("change", (e) => {
    const picked = pickFromLibrary("themes", e.target.value);
    if (picked) setTheme(validateTheme(picked).theme);
  });

  $("btn-panel").addEventListener("click", (e) => {
    const panel = $("panel");
    const opening = !panel.classList.contains("panel--open");
    panel.classList.toggle("panel--open", opening);
    panel.setAttribute("aria-hidden", String(!opening));
    e.currentTarget.setAttribute("aria-pressed", String(opening));
    state.painter?.resize();
    repaint();
  });

  $("btn-share").addEventListener("click", copyShareLink);
  $("btn-export").addEventListener("click", (e) => {
    e.stopPropagation();
    $("export-menu").hidden = !$("export-menu").hidden;
  });
  $("btn-export-project").addEventListener("click", () => {
    $("export-menu").hidden = true;
    exportProjectFile();
  });
  $("btn-export-snapshot").addEventListener("click", () => {
    $("export-menu").hidden = true;
    exportSnapshot();
  });
  document.addEventListener("click", (e) => {
    if (!$("export-menu").hidden && !$("export-menu").contains(e.target)) $("export-menu").hidden = true;
  });

  $("hd-home").addEventListener("click", goToLanding);
  $("btn-new").addEventListener("click", goToLanding);

  // empty screen
  const drop = $("drop");
  const fileInput = $("file-input");
  drop.addEventListener("click", () => fileInput.click());
  drop.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") fileInput.click();
  });
  fileInput.addEventListener("change", () => {
    if (fileInput.files[0]) readFile(fileInput.files[0]);
    fileInput.value = "";
  });
  for (const target of [drop, document.body]) {
    target.addEventListener("dragover", (e) => {
      e.preventDefault();
      drop.classList.add("drop--over");
    });
    target.addEventListener("dragleave", () => drop.classList.remove("drop--over"));
    target.addEventListener("drop", (e) => {
      e.preventDefault();
      drop.classList.remove("drop--over");
      const f = e.dataTransfer?.files?.[0];
      if (f) readFile(f);
    });
  }

  $("btn-paste").addEventListener("click", () => {
    const ta = $("paste-input");
    ta.classList.toggle("empty__paste--open");
    if (ta.classList.contains("empty__paste--open")) ta.focus();
  });
  $("paste-input").addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") handleText(e.target.value);
  });
  $("btn-fetch").addEventListener("click", () => {
    const url = $("url-input").value.trim();
    if (url) fetchCSV(url);
  });
  $("url-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("btn-fetch").click();
  });
  $("btn-sample").addEventListener("click", () => {
    state.name = SAMPLE_NAME;
    handleText(sampleCSV());
    $("project-name").value = state.name;
  });

  // mapping screen
  $("btn-back").addEventListener("click", () => show(state.dataset ? "stage" : "empty"));
  $("btn-build").addEventListener("click", buildRace);

  // panel tabs
  for (const tab of document.querySelectorAll(".panel__tab")) {
    tab.addEventListener("click", () => {
      for (const t of document.querySelectorAll(".panel__tab")) t.classList.toggle("panel__tab--active", t === tab);
      for (const pane of document.querySelectorAll(".panel__pane")) {
        pane.classList.toggle("panel__pane--active", pane.id === "panel-" + tab.dataset.tab);
      }
    });
  }

  // transport
  $("btn-play").addEventListener("click", () => state.playback?.toggle());
  const scrub = $("scrubber");
  scrub.addEventListener("input", () => {
    state.playback?.pause();
    state.playback?.seek(Number(scrub.value));
  });
  $("sel-speed").addEventListener("change", (e) => {
    if (state.playback) state.playback.speed = Number(e.target.value);
  });
  $("btn-loop").addEventListener("click", (e) => {
    if (!state.playback) return;
    state.playback.loop = !state.playback.loop;
    e.currentTarget.setAttribute("aria-pressed", String(state.playback.loop));
  });

  // keyboard
  document.addEventListener("keydown", (e) => {
    if (state.screen !== "stage") return;
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (e.key === " ") {
      e.preventDefault();
      state.playback?.toggle();
    } else if (e.key === "ArrowRight") {
      state.playback?.step(1);
    } else if (e.key === "ArrowLeft") {
      state.playback?.step(-1);
    }
  });

  // resize
  let resizeId;
  addEventListener("resize", () => {
    clearTimeout(resizeId);
    resizeId = setTimeout(() => {
      state.painter?.resize();
      repaint();
    }, 100);
  });
}

/* ---------- boot ---------- */

async function boot() {
  $("app-version").textContent = "v" + VERSION;
  console.info(`frontrunner v${VERSION}`);
  if (VIEWER) document.body.classList.add("fr-viewer");
  wire();
  store.migrateLegacy();

  if (VIEWER && window.__FR_PROJECT__) {
    openProject(window.__FR_PROJECT__);
    return;
  }

  const hashBlob = share.readHash();
  if (hashBlob && share.supported()) {
    try {
      openProject(await share.decodeProject(hashBlob), { assignNewId: true });
      return;
    } catch {
      toast("That share link is damaged or truncated — starting fresh.");
    }
  }
  show("empty");
}

boot();
