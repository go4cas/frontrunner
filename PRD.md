# frontrunner — PRD

**Version:** 2.1 · **Date:** 2026-07-17 · **Owner:** Cas (`go4cas`)
**Status:** v1 feature-complete and in QA; this document supersedes PRD 1.0 (2026-07-16) after the concept-model revision.
**One-liner:** A zero-dependency, single-file bar chart race builder that runs entirely in the browser. Drop in a CSV, watch the race, style it, brand it, share it as a link.

---

## 1. Positioning

Bar chart races are one of the most-loved data visualizations on the internet, and the tooling for making them is either SaaS with accounts and watermarks (Flourish) or code-first (D3 notebooks). frontrunner is the third way: **open a web page, drop a CSV, get a race.** No account, no server, no build step, no dependencies.

The whole application is one HTML file. The browser is the runtime. A finished race travels as a URL.

### Design principles

1. **The file is the app.** One `index.html` is the entire product. It works hosted, and it works from `file://`.
2. **Zero runtime dependencies.** Native browser APIs only: SVG, `requestAnimationFrame`, `CompressionStream`, `localStorage`, `URL`, `Blob`. No frameworks, no chart libraries.
3. **Data stays with the user.** Nothing is uploaded anywhere. Persistence is local; sharing is peer-to-peer via URL or file.
4. **Composable artifacts.** Layouts and themes are independent, saveable, exportable objects; settings and branding belong to a project. A project composes all of them with a dataset.
5. **Restrained by default.** Ships looking like Linear, not like a confetti cannon. Playfulness is opt-in via themes.

### Non-goals (v1)

- No server component of any kind, ever.
- No video/GIF export (v2, via `MediaRecorder`).
- No JSON dataset input (v2 — trivial adapter once the internal model exists).
- No image bars (v1.5 — see phasing).
- No line races, bump charts, or other chart types (post-v2; the layout `type` field reserves the space).
- No collaborative editing, no accounts.

---

## 2. The concept model

Five concerns, kept strictly apart. This model was reached iteratively (see §14 changelog) and is the spine of the product:

| Concept | Question it answers | Contains | Scope |
|---|---|---|---|
| **Data** | *What is the race about?* | dataset + column mapping | per-project |
| **Settings** | *How much, how fast, how formatted?* | top-N, bar thickness, ms/period, easing, value format, period format, axis scale mode | per-project |
| **Layout** | *Where does everything sit?* | placeholder grid: anchor per block; bar-row composition | **library** |
| **Theme** | *How does it look?* | CSS custom properties + bar palette (colors, fonts, radius, borders, shadows) | **library** |
| **Brand** | *What does it say about its maker?* | title, subtitle, logo URL, source line, link | per-project |

Library-scoped concepts (Layout, Theme) can be saved under a user-chosen name, persist across projects, appear under a "Yours" group in the header pickers, and export as JSON. Project-scoped concepts travel only inside the project envelope.

The word **template** is deliberately unclaimed: reserved for a possible future bundled preset (layout + theme + settings applied in one click).

### 2.1 Layout: the placeholder grid

A layout assigns each named block an **anchor** — `top-left`, `top-center`, `top-right`, `bottom-left`, `bottom-center`, `bottom-right` — or `off`:

- **title** (title + subtitle render together), **logo**, **clock** (the big period readout), **total** (running Σ), **source** (source line + link)
- **axis** is special: `top` or `off`
- **bar row** composition: entity label position (`inside` / `outside`), rank numbers on/off, values on/off

Painter rules: blocks sharing an anchor stack deterministically (reserving blocks first). Title, logo (top anchors), and source **reserve** space — the plot shrinks around them. Clock and total **float** over the plot, preserving the classic translucent-giant-year look at any anchor. Blocks with no content (e.g. empty Brand fields) collapse to nothing even when anchored.

```jsonc
// Layout object (schema v4)
{
  "id": "classic",
  "name": "Classic race",
  "type": "bar-race",                    // reserved for future chart types
  "bar": { "labelPosition": "outside", "showRank": true, "showValue": true },
  "slots": {
    "title": "top-left", "logo": "top-right", "clock": "bottom-right",
    "total": "off", "source": "bottom-left", "axis": "top"
  }
}
```

Built-ins: **classic** (title left, logo right, clock bottom-right, axis on), **dense** (inside labels, running total, no axis), **broadcast** (centered title, giant bottom-center clock, no ranks — only expressible under the slot model, which is the test that the abstraction earns its keep).

### 2.2 Settings

```jsonc
{
  "topN": 10, "barThickness": 0.72,
  "msPerPeriod": 1400, "easing": "easeInOutCubic",   // linear | easeOutQuad | easeInOutCubic
  "valueFormat": { "notation": "compact", "decimals": 1, "prefix": "", "suffix": "" },
  "periodLabelFormat": "raw",                        // raw | year | month-year
  "axisScale": "dynamic"                             // dynamic (rescales with the leader) | fixed (global maximum)
}
```

Value formatting rule: scaled units (K/M/B/T) render **exactly** `decimals` places — `1.40B` stays `1.40B` — so tabular values never jitter in width or precision during playback. Unitless values (<1,000) trim trailing zeros.

### 2.3 Theme

Flat map of `--fr-*` CSS custom properties plus a palette array. Applying a theme = setting variables on `:root`; every visual surface (UI chrome and chart) derives from them. Covers colors, font stacks, bar radius, **bar border color/width**, and **bar drop shadow**. Entity colors assign from the palette by first-appearance order and never change mid-race. Built-ins: **graphite** (dark, default), **paper** (light, subtle shadow), **signal** (dark, high-saturation, square bars).

Validator behavior doubles as forward migration: any theme missing newly introduced vars is silently filled from graphite, so older saved themes gain new capabilities without breaking.

### 2.4 Brand

Title, subtitle, logo URL, source line, link. All strings, trimmed and length-capped. The link renders the source line as a real `<a>` in the SVG — clickable in exported snapshots. Logos load **by URL reference** (never embedded in v1; see phasing for embed-at-export).

---

## 3. CSV ingestion

### 3.1 Input methods

Drag-and-drop a `.csv`, paste raw CSV, or fetch from URL (CORS failures produce a friendly "download and drop it instead" message). Dropping a `.frontrunner.json` project file anywhere a CSV is accepted opens it instead — distinguished by content sniffing, not extension.

### 3.2 Parser

Hand-rolled RFC-4180-ish parser: quoted fields, escaped quotes (`""`), commas/newlines inside quotes, delimiter auto-detection among `,` `;` tab (first-line frequency, quote-aware), BOM strip, CRLF/LF, trailing newline. First row is headers.

### 3.3 Shape detection

- **Long** (`year,country,population`): time/entity/value columns scored by temporality, numericness, and distinct counts.
- **Wide** (`country,1960,1970,…`): **two or more** headers parsing as temporal labels (two 4-digit-year headers essentially never occur in a long file; the original ≥3 threshold rejected legitimate two-period files and was revised).

Auto-detection is a proposal: the mapping screen shows the guess with a preview table and dropdown overrides, including a shape override.

### 3.4 Time & value parsing

Recognized period types: integer years, `YYYY-MM`, `YYYY-MM-DD`, or opaque ordered labels (file order, warned). Periods sort (numeric / ISO-lexical) and animate as **equidistant frames** in v1; `timeScale: "proportional"` is reserved for v2. Values parse tolerantly (`1,400,000`, `$3.2`, `45%`, `1.4e9`); non-numeric/missing = absent (bar animates out); negatives clamp to zero with a warning.

### 3.5 Limits

Soft warnings above ~500 entities / ~1,000 periods. Only top-N bars ever render, so scale affects parse time, not frame rate.

---

## 4. Internal data model

```ts
type Dataset = {
  periods: string[];        // sorted, display labels preserved
  entities: string[];       // stable order = first appearance (drives palette assignment)
  values: Float64Array;     // periods.length × entities.length, NaN = absent
  meta: { source: "csv"; shape: "long" | "wide" };
};
```

Per-period ranks and maxima precompute once at load; playback never sorts.

---

## 5. Rendering engine

- **SVG driven frame-by-frame** with `requestAnimationFrame`; no CSS transitions. Everything derives from `render(t)` where `t ∈ [0, P-1]` is continuous — play, pause, scrub, step, and reverse all fall out of one function.
- **Interpolation:** values lerp between periods (easing applied to sub-period progress); fractional **rank** lerp makes bars glide through overtakes; ranks beyond top-N clamp to the first offscreen slot, giving enter/exit slides with opacity fade; the axis max lerps smoothly with 1/2/5-ladder ticks.
- **Playback:** `msPerPeriod` × speed multiplier (0.5/1/2/4×), loop toggle, spacebar play/pause, arrow-key stepping, draggable scrubber with period tick labels. `prefers-reduced-motion` starts paused.
- **Performance:** DOM nodes created lazily per entity and recycled; per-frame work is attribute updates only. Target 60 fps with N ≤ 20 visible.
- The engine module is pure (no DOM): `frameState()` output feeds a separate painter, which is what makes the math fully unit-testable.

---

## 6. Projects & persistence

### 6.1 Project envelope — format v4

```jsonc
{
  "frontrunner": 4,
  "name": "World population 1960–2023",
  "created": "…",
  "dataset": { /* normalized model; values array, null = absent */ },
  "mapping": { /* shape + column mapping */ },
  "layout":   { /* inline */ },
  "settings": { /* inline */ },
  "theme":    { /* inline */ },
  "branding": { /* inline */ },
  "raw":      { "csv": "…" }   // optional: the original CSV text
}
```

Everything inlines — a project is always self-contained. The optional `raw` field carries the original CSV so reopened projects (from the library, a link, or a file) can still re-map columns; gzip makes the duplication nearly free for typical files, and the share-link size guard covers pathological ones.

**Format history & migration:** v1 (combined "template"), v2 (template/settings/branding split), v3 (template → placeholder grid), v4 (rename template → layout). `migrate.js` chains any older version to current in one call; unknown *future* versions fail with a coded error and a friendly message. Old share links, saved projects, exported files, and custom-library items all continue to open. The custom-library localStorage key migrated alongside (`fr:custom:templates` → `fr:custom:layouts`).

### 6.2 Tier 1 — localStorage project library

Every race autosaves (debounced 1 s) under its own id; the home screen lists saved races with open / rename (inline) / duplicate / delete (two-tap confirm) and shows storage usage against the ~5 MB quota. All writes are quota-safe: failure shows "not saved — export to keep," never silent loss; above ~80% of quota the save indicator warns proactively. Re-mapping an existing race keeps its id (a new CSV drop starts a fresh project); "New" resets layout, settings, theme, and branding to defaults. Round-1 single-slot autosaves migrate into the library automatically.

### 6.3 Tier 2 — share links

Project JSON → gzip (`CompressionStream`) → base64url → `#p=<blob>`. Hash, not query string: the payload never reaches a server log. Opening a link boots straight into the race (as a new unsaved copy). Size guard: warn > 16 KB compressed, refuse > 50 KB with file-export offered. The sample dataset compresses to ~1 KB. Malformed/truncated links produce a friendly error. Feature-detected; absent API hides the button.

### 6.4 Tier 3 — files

- **Project file:** `<name>.frontrunner.json` export/import.
- **Standalone snapshot:** `<name>.race.html` — a self-contained copy of the app with the project injected, booting into **viewer mode** (transport only, no editor, name read-only) and auto-playing. Works from `file://` with zero network access (logo URLs excepted, by design). Mechanism: pristine document HTML captured at module load; a `window.__FR_PROJECT__` script injected ahead of the bundle. Hardened against `</script>` sequences in data *and* in source (see §10).

---

## 7. UI

Single page, three states:

1. **Home:** drop target, paste box, URL fetch, sample link, and the saved-races library.
2. **Mapping:** detected shape badge, column dropdowns, 8-row preview, Build race.
3. **Stage:** full-bleed race; bottom transport (play, scrubber + period ticks, speed, loop); header with project name, save state, layout/theme pickers, Customize toggle, Copy share link, Export menu, New.

**Customize panel** (right, 300 px, collapsible): five tabs — **Data / Settings / Layout / Theme / Brand** — mirroring §2 exactly. Data shows dataset stats and (when the CSV came through this session) Edit mapping. Layout and Theme panes end with the library footer: name + Save copy, delete for owned items, and an Edit-as-JSON escape hatch whose validator clamps and merges rather than crashes; unknown JSON fields survive round-trips for forward compatibility.

Aesthetic: restrained Linear/Vercel register; race-timing-tower vernacular (tabular monospace numerals, big period clock); system font stacks only (a virtue of the zero-external-requests constraint). Phone (< 640 px) is view-only; the panel hides < 900 px.

---

## 8. Architecture & repo

```
frontrunner/
  src/
    index.html      shell + panel markup
    styles.css      UI chrome (chart + chrome colors all derive from theme vars)
    app.js          state machine, wiring, panes, snapshot export, viewer mode
    parse.js        CSV parser, shape detection, normalization, project sniffing
    engine.js       ranks, interpolation, frameState, formatting, Playback clock (pure)
    render.js       SVG painter: anchor layout engine + per-frame painting
    editors.js      validators: layout / settings / branding / theme + JSON parsing (pure)
    migrate.js      format migrations v1→…→v4 (pure)
    share.js        envelope, gzip↔base64url codec, hash handling
    store.js        localStorage: project index, custom libraries, migrations
    builtins.js     built-in layouts, default settings/branding, themes, sample
  test/             bun test — 87 tests: parser, engine math, playback clock,
                    share codec round-trips, validators, store, migrations
  build.ts          Bun: bundle + inline → dist/index.html; fails on any
                    "</script" in the bundle; output syntax-verified
  serve.ts          ten-line dev server
  dist/index.html   the product (~67 KB, zero external requests)
```

Dev: open `src/index.html` or `bun run serve`. Build: `bun run build`. Test: `bun test`. Repo `go4cas/frontrunner`, MIT. Hosting: dist published to here.now (claimed account for permanence) and/or Cloudflare Pages; releases double as downloadable GitHub assets since the product is one file.

---

## 9. Status vs v1 acceptance criteria

Everything from PRD 1.0's v1 list is implemented, plus the concept-model work. **Verified by tests:** parsing (delimiters, quotes, BOM, both shapes, long↔wide equivalence), interpolation and clamping, playback clock (speed, loop, step), share round-trips incl. NaN cells and size guards, snapshot injection safety, validators, store index, all migrations. **Pending human QA:** 60 fps feel, overtake glide, snapshot from `file://`, editor round-trips, Firefox/Safari, phone view.

---

## 10. Incidents & hardening (worth remembering)

1. **The `</script>` triple.** The snapshot exporter needs the literal closing-script string. `<\/script>` in source was normalized by the minifier to `</script>`, truncating the inlined bundle (shipped broken once). Fix `"<" + "/script>"` was **constant-folded back** by the minifier. Final: `String.fromCharCode(60, 47) + "script>"`, plus a build-time guard failing on any `</script` in the bundle, plus post-build syntax-check of the extracted inline script. The guard caught the second bug itself.
2. **`[hidden]` vs author CSS.** `.panel { display: flex }` overrode the UA's `[hidden]` rule, making the Customize toggle inert and the Export menu permanently visible. Fix: global `[hidden] { display: none !important; }`. Lesson: JS-logic-perfect, cascade-wrong is a bug class headless testing cannot catch.
3. **Trailing-zero trim vs decimals.** `1.40B` displayed as `1.4B` beside `1.41B`. Fixed decimals are now exact for scaled units (regression-tested by name).
4. **Wide-shape threshold.** ≥3 temporal headers rejected legitimate two-period wide files; revised to ≥2.

---

## 11. Known gaps (v1 debt)

All seven items from PRD 2.0's debt list are resolved (2026-07-17): re-mapping keeps project identity; inline rename in the saved-races list; label widths measured exactly via canvas (cached per entity, never per frame); the original CSV travels in the envelope so any reopened project can re-map; `axisScale: "fixed"` implemented (global maximum) with a Settings control; proactive storage warning above ~80% of quota; LICENSE (MIT), favicon, and OG/meta tags in place.

Remaining knowns: none blocking. New debt gets logged here as it's found.

---

## 12. Phasing

### v1.5 — images by reference

- **Bar images:** entity → image URL from a designated CSV column or an explicit map; rendered as circular SVG `<image>` at bar ends; broken URLs degrade silently to plain bars; share links carry URLs only.
- Natural fit with the slot model: bar images are a bar-row composition option, and richer slot options (sizes, offsets) extend Layout.

**Acceptance:** image column → images on bars after mapping confirm; broken URL → plain bar, no console spray, no layout shift; share link with image URLs round-trips; snapshot embeds nothing.

### v2 — self-containment, motion, presets

- Base64 image/logo embedding **at snapshot export only** ("embed images" checkbox); share links continue to refuse embedded pixels.
- WebM export via `captureStream()` + `MediaRecorder` (SVG mirrored to canvas).
- JSON dataset input; `timeScale: "proportional"`; `axisScale: "fixed"` implementation.
- **Templates** (the reclaimed word): bundled presets of layout + theme + settings, shareable like layouts and themes.

**Acceptance:** embedded snapshot plays fully offline incl. images; WebM of the sample plays in a stock player; JSON array-of-objects → race via the same mapping UI; applying a template swaps all three concerns in one action.

### Ops (blocking "share with the community")

`git init` + push to `go4cas/frontrunner` · LICENSE (MIT) · CI (bun test + build, which includes the script-injection guard) · publish dist to here.now / Cloudflare Pages · `frontrunner.dev` domain check (Cas) · README polish with demo GIF and example share links.

---

## 13. Risks & mitigations

| Risk | Mitigation |
|---|---|
| CORS blocks fetch-from-URL | Clear error + download-and-drop fallback; convenience, not core path |
| Share links exceed practical URL limits | 16 KB warn / 50 KB refuse with file alternatives in the same dialog |
| `CompressionStream` unavailable (old browsers) | Feature-detect; hide share button; other tiers unaffected |
| localStorage quota / private browsing | try/catch everywhere; "not saved — export to keep"; never silent loss |
| Logo/image URLs rot in shared artifacts | By-reference is the documented v1.x contract; embed-at-export lands in v2 |
| Minifier/injection interactions in self-replicating snapshot | Build-time `</script` guard + post-build syntax check (see §10) |
| Irregular period spacing looks wrong | Equidistant behavior documented; proportional mode reserved for v2 |
| Scope creep toward a charting suite | `type: "bar-race"` is the only recognized value; anything else is a new PRD |

---

## 14. Concept-model changelog

For the record, since the vocabulary is the product's spine:

- **PRD 1.0:** dataset + mapping + *template* (structure **and** behavior, combined) + theme. Formats: v1.
- **Revision 1:** template split into template (structure) + **settings** (behavior); **branding** introduced as content; borders/shadows added to theme. Format v2.
- **Revision 2 (Cas):** template redefined as a **placeholder grid** — named blocks assigned to anchors; size knobs (top-N, thickness) moved to settings; broadcast layout became expressible. Format v3.
- **Revision 3 (Cas):** the concept renamed **Layout**; "template" reserved for future bundled presets. Format v4.

The model has survived three revisions and grown simpler each time — the usual sign it's converging.
