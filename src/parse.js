// frontrunner — parse.js
// CSV parsing, shape detection, normalization. Pure functions, no DOM.

/** Detect delimiter by frequency in the first non-empty line (outside quotes). */
export function detectDelimiter(text) {
  const line = text.split(/\r?\n/).find((l) => l.trim().length > 0) ?? "";
  const counts = { ",": 0, ";": 0, "\t": 0 };
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch in counts) counts[ch]++;
  }
  let best = ",";
  for (const d of Object.keys(counts)) if (counts[d] > counts[best]) best = d;
  return best;
}

/** RFC-4180-ish CSV parser. Returns { headers: string[], rows: string[][] }. */
export function parseCSV(text, delimiter) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip BOM
  const delim = delimiter ?? detectDelimiter(text);
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const push = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    push();
    // skip fully empty rows
    if (row.length > 1 || row[0].trim() !== "") rows.push(row);
    row = [];
  };
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === delim) {
      push();
      i++;
      continue;
    }
    if (ch === "\n") {
      endRow();
      i++;
      continue;
    }
    if (ch === "\r") {
      if (text[i + 1] === "\n") i++;
      endRow();
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  if (field !== "" || row.length > 0) endRow();
  if (rows.length === 0) return { headers: [], rows: [], delimiter: delim };
  const headers = rows[0].map((h) => h.trim());
  return { headers, rows: rows.slice(1), delimiter: delim };
}

/** Parse a numeric value tolerantly: "1,400,000", "$3.2", "45%", "1.4e9". NaN if not numeric. */
export function parseValue(s) {
  if (s == null) return NaN;
  const cleaned = String(s).trim().replace(/[^0-9eE+\-.]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === ".") return NaN;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

const URLISH_RE = /^(https?:\/\/|data:image\/)/i;
const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

/** Fraction of non-empty values in a column that look like #rrggbb hex colors. */
function fractionHexColor(vals) {
  const nonEmpty = vals.filter((v) => v !== "");
  if (nonEmpty.length === 0) return 0;
  let n = 0;
  for (const v of nonEmpty) if (HEX_COLOR_RE.test(v)) n++;
  return n / nonEmpty.length;
}

/** Fraction of non-empty values in a column that look like image/asset URLs. */
function fractionUrlish(vals) {
  const nonEmpty = vals.filter((v) => v !== "");
  if (nonEmpty.length === 0) return 0;
  let n = 0;
  for (const v of nonEmpty) if (URLISH_RE.test(v)) n++;
  return n / nonEmpty.length;
}

const YEAR_RE = /^\d{4}$/;
const YM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const YMD_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** Classify a string as a temporal label. Returns "year" | "ym" | "ymd" | null. */
export function temporalType(s) {
  const t = String(s).trim();
  if (YEAR_RE.test(t)) return "year";
  if (YM_RE.test(t)) return "ym";
  if (YMD_RE.test(t)) return "ymd";
  return null;
}

function columnValues(rows, idx) {
  return rows.map((r) => (r[idx] ?? "").trim());
}

function distinct(arr) {
  return new Set(arr).size;
}

function fractionNumeric(vals) {
  if (vals.length === 0) return 0;
  let n = 0;
  for (const v of vals) if (!Number.isNaN(parseValue(v))) n++;
  return n / vals.length;
}

function fractionTemporal(vals) {
  if (vals.length === 0) return 0;
  let n = 0;
  for (const v of vals) if (temporalType(v)) n++;
  return n / vals.length;
}

/**
 * Detect dataset shape and propose a column mapping.
 * Returns { shape: "long"|"wide", confidence: 0..1, mapping }.
 * Long mapping: { time, entity, value } (header names).
 * Wide mapping: { entity, periods: string[] } (header names).
 */
export function detectShape(headers, rows) {
  // Wide: two or more headers parse as temporal labels. Two 4-digit-year
  // headers essentially never happen in a long-format file, so 2 is safe.
  const temporalHeaders = headers.filter((h) => temporalType(h));
  if (temporalHeaders.length >= 2) {
    const nonTemporal = headers.filter((h) => !temporalType(h));
    const entity = nonTemporal[0] ?? headers[0];
    const sample500 = rows.slice(0, 500);
    const image = nonTemporal.find(
      (h) => h !== entity && fractionUrlish(columnValues(sample500, headers.indexOf(h))) > 0.8
    );
    const color = nonTemporal.find(
      (h) => h !== entity && h !== image && fractionHexColor(columnValues(sample500, headers.indexOf(h))) > 0.8
    );
    const category = nonTemporal.find((h) => {
      if (h === entity || h === image || h === color) return false;
      const vals = columnValues(sample500, headers.indexOf(h));
      const d = distinct(vals.filter((v) => v !== ""));
      return fractionNumeric(vals) < 0.5 && fractionUrlish(vals) < 0.5 && d >= 2 && d <= 12 && d <= rows.length;
    });
    return {
      shape: "wide",
      confidence: 0.95,
      mapping: { entity, periods: temporalHeaders, image: image ?? null, category: category ?? null, color: color ?? null },
    };
  }

  // Long: score columns for time / entity / value roles.
  const sample = rows.slice(0, 500);
  const stats = headers.map((h, idx) => {
    const vals = columnValues(sample, idx);
    return {
      header: h,
      idx,
      numeric: fractionNumeric(vals),
      temporal: fractionTemporal(vals),
      urlish: fractionUrlish(vals),
      hexColor: fractionHexColor(vals),
      distinct: distinct(vals),
      count: vals.length,
    };
  });

  // Time: mostly temporal-or-numeric, repeats (distinct < rows), fewest distinct wins.
  const timeCands = stats
    .filter((s) => (s.temporal > 0.9 || s.numeric > 0.9) && s.distinct < s.count)
    .sort((a, b) => b.temporal - a.temporal || a.distinct - b.distinct);
  // Entity: mostly non-numeric, repeats, more distinct than time typically.
  // URL-ish columns are excluded — they're image references, not entities.
  const entityCands = stats
    .filter((s) => s.numeric < 0.5 && s.urlish < 0.5 && s.distinct > 1)
    .sort((a, b) => b.distinct - a.distinct);
  // Value: numeric, not the chosen time column, most distinct wins.
  // Value: numeric, not whichever column time/entity will actually use — computed
  // via their FINAL fallback headers, not just object identity. Without this, a
  // degenerate dataset (e.g. a single entity, or too few rows) can leave time/entity
  // both unresolved, and the value scorer would then happily pick the time column
  // itself as "value", silently corrupting the mapping (confirmed via a 2-row,
  // 1-entity test case that produced value === time).
  const time = timeCands[0];
  const entity = entityCands.find((s) => s !== time);
  const timeHeader = time?.header ?? headers[0];
  const entityHeader = entity?.header ?? headers[1] ?? headers[0];
  const valueCands = stats
    .filter((s) => s.numeric > 0.9 && s.header !== timeHeader && s.header !== entityHeader)
    .sort((a, b) => b.distinct - a.distinct);
  const value = valueCands[0];

  const ok = time && entity && value;
  const image = stats.find((s) => s !== time && s !== entity && s !== value && s.urlish > 0.8);
  const color = stats.find((s) => s !== time && s !== entity && s !== value && s !== image && s.hexColor > 0.8);
  // Category: a low-cardinality string column that isn't anything else —
  // e.g. continent, sector, party. 2–12 distinct values, each repeated.
  const category = stats.find(
    (s) =>
      s !== time && s !== entity && s !== value && s !== image && s !== color &&
      s.numeric < 0.5 && s.urlish < 0.5 && s.temporal < 0.5 &&
      s.distinct >= 2 && s.distinct <= 12 && s.distinct <= (entity?.distinct ?? Infinity)
  );
  return {
    shape: "long",
    confidence: ok ? Math.min(1, 0.5 + time.temporal * 0.3 + value.numeric * 0.2) : 0.2,
    mapping: {
      time: time?.header ?? headers[0],
      entity: entity?.header ?? headers[1] ?? headers[0],
      value: value?.header ?? headers[2] ?? headers[headers.length - 1],
      image: image?.header ?? null,
      category: category?.header ?? null,
      color: color?.header ?? null,
    },
  };
}

function sortPeriods(periods) {
  const allNumeric = periods.every((p) => !Number.isNaN(Number(p)));
  const sorted = [...periods];
  if (allNumeric) sorted.sort((a, b) => Number(a) - Number(b));
  else if (periods.every((p) => temporalType(p))) sorted.sort(); // ISO sorts lexically
  // else: keep first-appearance order (opaque labels)
  return sorted;
}

/**
 * Normalize parsed CSV into the internal dataset model.
 * @returns {{ periods: string[], entities: string[], values: Float64Array, meta: object, warnings: string[] }}
 */
export function normalize(headers, rows, shapeInfo) {
  const warnings = [];
  const idxOf = (h) => headers.indexOf(h);

  const images = {};
  const categories = {};
  const colors = {};
  let periods, entities, get; // get(pIdx, eIdx) -> raw string
  if (shapeInfo.shape === "wide") {
    const { entity, periods: periodHeaders, image, category, color } = shapeInfo.mapping;
    const eIdx = idxOf(entity);
    const imgIdx = image ? idxOf(image) : -1;
    const catIdx = category ? idxOf(category) : -1;
    const colIdx = color ? idxOf(color) : -1;
    periods = sortPeriods(periodHeaders);
    entities = [];
    const rowOf = new Map();
    for (const r of rows) {
      const name = (r[eIdx] ?? "").trim();
      if (!name || rowOf.has(name)) continue;
      rowOf.set(name, r);
      entities.push(name);
      if (imgIdx >= 0) {
        const url = (r[imgIdx] ?? "").trim();
        if (url) images[name] = url;
      }
      if (catIdx >= 0) {
        const cat = (r[catIdx] ?? "").trim();
        if (cat) categories[name] = cat;
      }
      if (colIdx >= 0) {
        const hex = (r[colIdx] ?? "").trim();
        if (hex) colors[name] = hex;
      }
    }
    const pIdx = periods.map((p) => idxOf(p));
    get = (pi, ei) => rowOf.get(entities[ei])[pIdx[pi]];
  } else {
    const { time, entity, value, image, category, color } = shapeInfo.mapping;
    const tIdx = idxOf(time);
    const eIdx = idxOf(entity);
    const vIdx = idxOf(value);
    const imgIdx = image ? idxOf(image) : -1;
    const catIdx = category ? idxOf(category) : -1;
    const colIdx = color ? idxOf(color) : -1;
    const periodSet = [];
    const seenP = new Set();
    entities = [];
    const seenE = new Set();
    const cell = new Map(); // "p\u0000e" -> raw
    for (const r of rows) {
      const p = (r[tIdx] ?? "").trim();
      const e = (r[eIdx] ?? "").trim();
      if (!p || !e) continue;
      if (!seenP.has(p)) {
        seenP.add(p);
        periodSet.push(p);
      }
      if (!seenE.has(e)) {
        seenE.add(e);
        entities.push(e);
      }
      cell.set(p + "\u0000" + e, r[vIdx]);
      if (imgIdx >= 0) {
        const url = (r[imgIdx] ?? "").trim();
        if (url) images[e] = url; // last non-empty wins
      }
      if (catIdx >= 0) {
        const cat = (r[catIdx] ?? "").trim();
        if (cat) categories[e] = cat;
      }
      if (colIdx >= 0) {
        const hex = (r[colIdx] ?? "").trim();
        if (hex) colors[e] = hex;
      }
    }
    periods = sortPeriods(periodSet);
    get = (pi, ei) => cell.get(periods[pi] + "\u0000" + entities[ei]);
  }

  const P = periods.length;
  const E = entities.length;
  const values = new Float64Array(P * E);
  let clampedNegatives = 0;
  for (let pi = 0; pi < P; pi++) {
    for (let ei = 0; ei < E; ei++) {
      let v = parseValue(get(pi, ei));
      if (v < 0) {
        v = 0;
        clampedNegatives++;
      }
      values[pi * E + ei] = v; // NaN = absent
    }
  }
  if (clampedNegatives > 0)
    warnings.push(`${clampedNegatives} negative value${clampedNegatives === 1 ? "" : "s"} clamped to zero.`);
  if (E > 500) warnings.push(`${E} entities is a lot — parsing may be slow, playback is unaffected.`);
  if (P > 1000) warnings.push(`${P} periods is a lot — consider aggregating.`);
  if (P < 2) warnings.push("Only one period found — there is nothing to animate.");

  return {
    periods,
    entities,
    values,
    images, // entity → image URL (may be empty)
    categories, // entity → category (may be empty; drives palette-by-category)
    colors, // entity → explicit #rrggbb hex (may be empty; overrides category/index color)
    meta: { source: "csv", shape: shapeInfo.shape },
    warnings,
  };
}

/** Sniff whether dropped/pasted text is a frontrunner project JSON rather than CSV. */
export function sniffProject(text) {
  const t = text.trimStart();
  if (!t.startsWith("{")) return null;
  try {
    const obj = JSON.parse(t);
    return obj && typeof obj === "object" && typeof obj.frontrunner === "number" ? obj : null;
  } catch {
    return null;
  }
}

/** Sniff whether text is a JSON dataset — an array of flat objects, e.g.
 * `[{"country":"China","year":1960,"population":667070000}, ...]`. Returns
 * null for anything else (project envelopes start with "{", not "["). */
export function sniffJSONDataset(text) {
  const t = text.trimStart();
  if (!t.startsWith("[")) return null;
  try {
    const arr = JSON.parse(t);
    return Array.isArray(arr) && arr.length > 0 && arr.every((r) => r && typeof r === "object" && !Array.isArray(r)) ? arr : null;
  } catch {
    return null;
  }
}

/** Flatten an array of objects into the same {headers, rows} shape parseCSV
 * produces, so detectShape/normalize work on JSON input completely unchanged.
 * Header order: keys from the first record, then any additional keys found
 * later (in first-appearance order). Missing keys become "" for that row;
 * values are stringified (numbers, booleans) to match CSV's all-string cells. */
export function jsonToTable(records) {
  const headers = [];
  const seen = new Set();
  for (const r of records) {
    for (const k of Object.keys(r)) {
      if (!seen.has(k)) {
        seen.add(k);
        headers.push(k);
      }
    }
  }
  const rows = records.map((r) =>
    headers.map((h) => {
      const v = r[h];
      if (v === null || v === undefined) return "";
      return typeof v === "string" ? v : String(v);
    })
  );
  return { headers, rows };
}
