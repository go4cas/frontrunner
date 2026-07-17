# frontrunner — PRD

**Version:** 3.0 · **Date:** 2026-07-17 · **Owner:** Cas (`go4cas`)
**Live:** https://centered-tangle-v266.here.now/ · **Repo:** `go4cas/frontrunner` (MIT)
**One-liner:** A zero-dependency, single-file bar chart race builder that runs entirely in the browser. Drop in a CSV, watch the race, style it, brand it, share it as a link.

> **What this document is.** A decision record and flight plan, not a spec of current behavior. The code and its 91 tests are the authority on what frontrunner *does*; this document records *why it's shaped the way it is* (concept model, decisions, incidents) and *where it's going* (roadmap with acceptance criteria for the next phase only). It's maintained at phase boundaries, not per-fix. Its primary readers are future build sessions and repo visitors.

---

## 1. Positioning & principles

Bar chart race tooling is either SaaS with accounts and watermarks (Flourish) or code-first (D3, Python). frontrunner is the third way: **open a web page, drop a CSV, get a race.** No account, no server, no build step, no dependencies.

1. **The file is the app.** One `index.html` is the entire product; works hosted and from `file://`.
2. **Zero runtime dependencies.** Native browser APIs only (SVG, rAF, `CompressionStream`, `localStorage`).
3. **Data stays with the user.** Nothing uploads anywhere; sharing is peer-to-peer via URL or file.
4. **Composable artifacts.** Layouts and themes are library objects; settings and branding are per-project; a project composes all of them with a dataset, self-contained.
5. **Restrained by default.** Linear/Vercel register; race-timing-tower vernacular; playfulness is opt-in via themes.

**Structural moat** (confirmed by the 2026-07-17 market survey): nobody else does whole-project-in-a-URL share links or single-file self-replicating snapshots.

**Standing non-goals:** no server component ever; no accounts; no collaborative editing; no chart types beyond `bar-race` without a new PRD (`type` field reserves the space).

---

## 2. The concept model

Five concerns, kept strictly apart. This is the product's spine; changes here are format-version events.

| Concept | Question it answers | Scope |
|---|---|---|
| **Data** | *What is the race about?* — dataset + column mapping (+ original CSV for re-mapping) | per-project |
| **Settings** | *How much, how fast, how formatted?* — top-N, thickness, speed, easing, formats, axis scale | per-project |
| **Layout** | *Where does everything sit?* — placeholder grid: blocks (title, logo, clock, total, source, axis) assigned to anchors or off; bar-row composition | **library** |
| **Theme** | *How does it look?* — CSS custom properties + palette (colors, fonts, radius, borders, shadows) | **library** |
| **Brand** | *What does it say about its maker?* — title, subtitle, logo URL, source, link | per-project |

Painter rules worth remembering: blocks sharing an anchor stack (reserving first); title/logo/source **reserve** plot space; clock/total **float** over the plot; content-empty blocks collapse. The **broadcast** built-in exists as proof the slot abstraction earns its keep — it was inexpressible under the old show/hide flags.

The word **template** is reserved for a future bundled preset (layout + theme + settings in one click).

**Format:** envelope `frontrunner: 4`. Migration chain v1→v2→v3→v4 lifts any older artifact in one call; future versions fail with a coded error. History: v1 combined "template"; v2 split template/settings/branding; v3 template → placeholder grid; v4 rename template → layout. Full shapes: see `src/builtins.js`, `src/editors.js`, `src/migrate.js` and their tests.

---

## 3. Decisions with rationale (abridged decision log)

- **SVG + rAF, one `render(t)` for everything** — play/pause/scrub/step all derive from a continuous timeline position; engine math is pure and DOM-free, hence fully unit-testable.
- **Equidistant periods in v1** — simpler engine; matches most published races; `timeScale: "proportional"` reserved.
- **Wide-shape detection at ≥2 temporal headers** — ≥3 rejected legitimate two-period files; two 4-digit-year headers essentially never occur in long format.
- **Fixed decimals on scaled units** — `1.40B` stays `1.40B`; precision and width stability beat prettiness (regression-tested).
- **Raw CSV rides in the envelope** — re-mapping after reopen beats payload purity; gzip makes it nearly free; size guard covers pathology.
- **Images/logos by URL reference in v1.x** — keeps share links tiny; embedding is an export-time concern (v2).
- **Anonymous → claimed here.now flow** — ship first on a 24 h URL, claim for permanence; deploys via `scripts/deploy.ts` with `HERENOW_API_KEY`.

---

## 4. Incidents & hardening (institutional memory — do not relearn)

1. **The `</script>` triple.** Snapshot export needs the closing-script string in source. `<\/script>` was minifier-normalized to a literal `</script>`, truncating the inlined bundle (shipped broken once). Fix `"<" + "/script>"` was **constant-folded back** by the minifier. Final: `String.fromCharCode(60, 47) + "script>"`, plus a build-time guard failing on any `</script` in the bundle, plus post-build syntax-check of the extracted inline script. The guard caught the second bug itself. **Never "simplify" this code.**
2. **`[hidden]` vs author CSS.** `.panel { display: flex }` silently defeated the `hidden` attribute. Global `[hidden] { display: none !important; }` now guards. Lesson: cascade bugs are invisible to headless testing — see backlog item on browser E2E.
3. **Trailing-zero trim vs decimals** — see decision log; regression test pinned by name.
4. **Wide-shape threshold** — see decision log.

---

## 5. Roadmap

### v1.5 — images by reference *(implemented 2026-07-17, pending human QA)*

Entity → image URL: auto-detected URL column in mapping (URL-ish columns are excluded from entity candidacy — a detector bug the tests caught), or per-entity URLs in the Data pane; circular SVG `<image>` on a color disc at bar ends; a Layout bar-row toggle; broken URLs degrade silently to plain bars (failed URLs cached, retried only when changed); share links carry URLs, never pixels.

**Acceptance:**
- [x] CSV with an image-URL column shows images on bars after mapping confirmation *(logic tested; visual QA pending)*
- [x] A broken image URL renders a plain bar — no console spray, no layout shift *(error handler hides disc+image; visual QA pending)*
- [x] Share link with image URLs round-trips; snapshot export embeds nothing *(round-trip test green)*

### v1.6 — storytelling (from the 2026-07-17 market survey)

Sourced from Flourish's feature set, dexplo's option set, the Bostock/Cotgreave critiques, and community variants. Ordered by value-per-effort:

1. **Category colors** — optional category column in mapping; palette assigns per category; legend block joins the Layout grid. (The viral Goodspeed COVID race was colored by category; it's what turns a race from trivia into an argument.)
2. **Events & captions** — per-project list of (period, text); caption block in the Layout grid; optional pause-on-event. Directly answers the "single point in time, entertainment not analysis" critique.
3. **Small proven settings** — `endPeriodPause` (linger per period), race direction top-N/bottom-N (the "worst performers" inversion), log scale.
4. **Follow mode** — click a bar to spotlight an entity (others dim); persists in the envelope so shared links arrive pre-focused.
5. **Timeline sparkline** — leader/total line strip fused to the scrubber (our answer to Flourish's line-timeline, in the timing-strip aesthetic).
6. **Ghost reference bar** — a floating median/mean bar the field visibly pulls away from (dexplo's `perpendicular_bar_func`, nicely renamed).

Acceptance criteria to be written when the phase starts (this document's mandate: next phase only — currently v1.5).

### v2 — self-containment, motion, presets

Base64 image/logo embedding at snapshot export only · WebM export via `captureStream()` + `MediaRecorder` · JSON dataset input · `timeScale: "proportional"` · **Templates** (bundled layout+theme+settings presets) · candidate: vertical column race variant.

### Engineering candidates (unscheduled)

- **Browser E2E smoke suite** (Playwright or similar, in CI): loads dist, drops the sample, asserts a playing race and panel toggles. Exists to catch the cascade-class bugs unit tests cannot (see incident 2).

---

## 6. Concept-model changelog

- **PRD 1.0:** dataset + mapping + combined *template* + theme (format v1)
- **Rev 1:** template split → template + **settings**; **branding** introduced (v2)
- **Rev 2 (Cas):** template redefined as **placeholder grid**; size knobs → settings (v3)
- **Rev 3 (Cas):** concept renamed **Layout**; "template" reserved for future presets (v4)
- **PRD 3.0:** document mandate slimmed to decision record + flight plan; v1.6 storytelling phase added from market survey

The model survived three revisions and grew simpler each time — the usual sign it converged.
