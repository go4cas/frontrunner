// frontrunner — editors.js
// Pure validation/merge logic for user-edited templates, settings, themes,
// and branding. The panel UI calls these; tests cover them directly.

import { EASINGS } from "./engine.js";
import { LAYOUTS, THEMES, DEFAULT_SETTINGS, DEFAULT_BRANDING, ANCHORS } from "./builtins.js";

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function num(v, fallback, lo, hi) {
  const n = Number(v);
  return Number.isFinite(n) ? clamp(n, lo, hi) : fallback;
}

function oneOf(v, options, fallback) {
  return options.includes(v) ? v : fallback;
}

function str(v, fallback = "") {
  return typeof v === "string" ? v : fallback;
}

/**
 * Validate a layout (placeholder grid, schema v4). Unknown fields are
 * preserved; known fields are clamped; missing fields default from the
 * classic built-in. Never throws.
 */
export function validateLayout(input) {
  const errors = [];
  const d = LAYOUTS[0];
  const t = input && typeof input === "object" ? structuredClone(input) : {};
  if (!input || typeof input !== "object") errors.push("Layout must be a JSON object.");

  if (t.type != null && t.type !== "bar-race") {
    errors.push(`Unknown layout type "${t.type}" — only "bar-race" is supported.`);
  }
  t.type = "bar-race";
  t.id = str(t.id) || "custom";
  t.name = str(t.name) || "Custom layout";

  const bar = t.bar && typeof t.bar === "object" ? t.bar : {};
  t.bar = {
    ...bar,
    labelPosition: oneOf(bar.labelPosition, ["inside", "outside"], d.bar.labelPosition),
    showRank: Boolean(bar.showRank ?? d.bar.showRank),
    showValue: Boolean(bar.showValue ?? d.bar.showValue),
    showImage: Boolean(bar.showImage ?? d.bar.showImage),
    imagePosition: oneOf(bar.imagePosition, ["inside", "overlap", "outside"], d.bar.imagePosition),
  };

  const slots = t.slots && typeof t.slots === "object" ? t.slots : {};
  t.slots = {};
  for (const key of ["title", "logo", "clock", "total", "source", "legend", "caption"]) {
    t.slots[key] = oneOf(slots[key], ANCHORS, d.slots[key]);
  }
  t.slots.axis = oneOf(slots.axis, ["top", "off"], d.slots.axis);
  return { layout: t, errors };
}

/** Validate settings (configuration & behavior, schema v3). Never throws. */
export function validateSettings(input) {
  const errors = [];
  const d = DEFAULT_SETTINGS;
  const s = input && typeof input === "object" ? structuredClone(input) : {};
  if (!input || typeof input !== "object") errors.push("Settings must be a JSON object.");

  s.topN = num(s.topN, d.topN, 1, 50);
  s.barThickness = num(s.barThickness, d.barThickness, 0.2, 0.95);
  s.msPerPeriod = num(s.msPerPeriod, d.msPerPeriod, 100, 10000);
  s.easing = oneOf(s.easing, Object.keys(EASINGS), d.easing);

  const vf = s.valueFormat && typeof s.valueFormat === "object" ? s.valueFormat : {};
  s.valueFormat = {
    ...vf,
    notation: oneOf(vf.notation, ["compact", "full"], d.valueFormat.notation),
    decimals: num(vf.decimals, d.valueFormat.decimals, 0, 3),
    prefix: str(vf.prefix),
    suffix: str(vf.suffix),
  };

  s.endPeriodPause = num(s.endPeriodPause, d.endPeriodPause, 0, 10000);
  s.eventPause = num(s.eventPause, d.eventPause, 0, 10000);
  s.periodLabelFormat = oneOf(s.periodLabelFormat, ["raw", "year", "month-year"], d.periodLabelFormat);
  s.axisScale = oneOf(s.axisScale, ["dynamic", "fixed"], d.axisScale);
  return { settings: s, errors };
}

/** Validate the events list: [{ period, text }]. Empty text drops the event;
 * text caps at 200 chars; period stays a string label. Never throws. */
export function validateEvents(input) {
  const list = Array.isArray(input) ? input : [];
  const events = [];
  for (const e of list) {
    if (!e || typeof e !== "object") continue;
    const period = String(e.period ?? "").trim();
    const text = str(e.text).trim().slice(0, 200);
    if (period && text) events.push({ period, text });
  }
  return { events, errors: [] };
}

/** Validate branding (content). Trims strings, caps lengths. Never throws. */
export function validateBranding(input) {
  const b = input && typeof input === "object" ? structuredClone(input) : {};
  const out = {};
  for (const key of Object.keys(DEFAULT_BRANDING)) {
    out[key] = str(b[key]).trim().slice(0, key === "title" || key === "subtitle" ? 120 : 300);
  }
  return { branding: out, errors: [] };
}

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

export function isHexColor(v) {
  return typeof v === "string" && HEX_RE.test(v.trim());
}

/** Expand #abc → #aabbcc for input[type=color], which demands 6 digits. */
export function toSixDigitHex(v) {
  const t = String(v).trim();
  if (/^#[0-9a-f]{3}$/i.test(t)) {
    return "#" + t[1] + t[1] + t[2] + t[2] + t[3] + t[3];
  }
  return /^#[0-9a-f]{8}$/i.test(t) ? t.slice(0, 7) : t;
}

/**
 * Validate and normalize a theme. Every var from the graphite built-in must
 * exist (missing ones are filled from it — which is also how older saved
 * themes silently gain newly introduced vars like borders and shadows);
 * palette must be a non-empty array of color strings. Never throws.
 */
export function validateTheme(input) {
  const errors = [];
  const d = THEMES[0];
  const t = input && typeof input === "object" ? structuredClone(input) : {};
  if (!input || typeof input !== "object") errors.push("Theme must be a JSON object.");

  t.id = str(t.id) || "custom";
  t.name = str(t.name) || "Custom theme";

  const vars = t.vars && typeof t.vars === "object" ? t.vars : {};
  t.vars = {};
  for (const [k, dv] of Object.entries(d.vars)) {
    const v = vars[k];
    t.vars[k] = typeof v === "string" && v.trim() ? v.trim() : dv;
  }
  for (const [k, v] of Object.entries(vars)) {
    if (!(k in t.vars) && k.startsWith("--fr-") && typeof v === "string") t.vars[k] = v;
  }

  const palette = Array.isArray(t.palette) ? t.palette.filter((c) => typeof c === "string" && c.trim()) : [];
  if (palette.length === 0) {
    errors.push("Palette needs at least one color — using the default palette.");
    t.palette = [...d.palette];
  } else {
    t.palette = palette.map((c) => c.trim());
  }
  return { theme: t, errors };
}

/** Parse user JSON from the raw editor. Returns { value } or { error }. */
export function parseUserJSON(text) {
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { error: "Expected a JSON object." };
    }
    return { value };
  } catch (err) {
    return { error: `Invalid JSON: ${err.message}` };
  }
}
