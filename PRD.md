# frontrunner — PRD

**Version:** 3.13 · **Date:** 2026-07-19 · **Owner:** Cas (`go4cas`)
**Status:** v1.6 closed (2026-07-17) · next phase: v2 (unscheduled)
**Live:** https://centered-tangle-v266.here.now/ · **Repo:** `go4cas/frontrunner` (MIT)
**One-liner:** A zero-dependency, single-file bar chart race builder that runs entirely in the browser. Drop in a CSV, watch the race, style it, brand it, share it as a link.

> **What this document is.** A decision record and flight plan, not a spec of current behavior. The code and its test suites (unit + DOM smoke + browser e2e) are the authority on what frontrunner *does*; this document records *why it's shaped the way it is* (concept model, decisions, incidents) and *where it's going* (roadmap with acceptance criteria for the next phase only). It's maintained at phase boundaries, not per-fix. Its primary readers are future build sessions and repo visitors.

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
- **Bar thickness lives in Theme, not Settings (v1.7.0, Cas's ruling).** It reads as a *look* decision (chunky vs slender bars), same family as radius and palette, even though it's implemented as layout math. Confirms the placement/style taxonomy from v1.5 generalizes: if a knob changes what the chart *looks like* rather than *what data it shows*, it belongs to Theme.
- **Explicit CSV color overrides category, which overrides index-cycling (v1.7.0).** Priority order matches signal strength: a person naming an exact hex color meant it specifically; a category is a grouping; bare index-cycling is the fallback nobody chose.
- **Layout slot collisions are a soft warning, not a validation error (v1.7.0).** Multiple blocks sharing an anchor and stacking is an intentional painter feature, not a bug — but a pile-up is rarely deliberate, so the Layout pane surfaces it without blocking the choice.
- **Daily/sub-year periods needed no parser changes (v1.8.0).** Detection, sorting, and normalization already handled `YYYY-MM-DD` correctly in both shapes — confirmed with 30-day fixtures, not assumed. The only real gap was cosmetic: no day-level display format. Lesson: "is X supported" is sometimes answered by writing a test against existing code, not by writing new code.
- **Palette overflow generates new colors instead of repeating (v1.8.0).** Beyond the curated palette, `entityColor()` now derives new hues via golden-angle rotation seeded from the palette's own average saturation/lightness — so extra entities look native to the theme rather than mismatched, and stay distinct from each other for a very long run (verified 20 deep with zero collisions) rather than silently duplicating a color meant for ~10 entries.
- **Background patterns are one CSS-native theme var, not an asset system (v1.8.0).** `--fr-bg-image` holds a complete CSS value (a gradient, a repeating pattern, or a `url(...)`) rather than a structured config — keeps the zero-runtime-dependency stance intact and needs no new envelope fields beyond the existing generic theme-var pass-through.
- **Raw-data trimming is a radio choice under the toggle, not a second checkbox (v1.9.1, Cas's request).** "All columns" vs "only what's mapped" is one dimension with two states, not an independent on/off — a radio group makes that structure visible and shows both size estimates side by side before choosing. Defaults to "all columns," preserving current behavior.
- **Raw-data inclusion is a user choice, not automatic (v1.9.0, Cas's ruling).** Reverses the earlier default-is-automatic stance: a person can now see exactly what riding-along data costs them and opt out, rather than the app deciding unconditionally. Defaults to on, preserving prior behavior for anyone who doesn't touch it.
- **Image embedding defaults to link-only, not embedded (v1.9.0, Cas's ruling).** Most exports are for online showcase or embedding in a site, where a URL reference is lighter and sufficient; embedding is for the person who explicitly needs full offline independence. Opt-in, not opt-out — matches the "showcase vs. truly offline" distinction Cas drew directly.
- **WebM recording reuses the live Playback engine rather than reimplementing timing (v1.9.0).** Driving the actual `Playback` object (holds, easing, pauses, chosen speed all included) and just capturing what's already rendered was less code and less risk than recomputing frame timing independently — the cost is that export takes real wall-clock time, which is an acceptable, expected trade-off for a screen-capture-style approach.
- **Vertical column race, dropped from the roadmap (2026-07-18 research).** "Vertical" conflates two unrelated ideas. (1) Column orientation (bars growing upward) — confirmed real via Flourish and the Python `bar_chart_race` library, both offer it as a toggle — but nothing found suggests real demand for it; it reads as a checkbox feature, not something driving usage anywhere. (2) A 9:16 portrait video canvas — genuinely in demand (competitors like Flowi and Alien Art market it explicitly for TikTok/Reels; one source cites 90% higher mobile engagement for vertical video, Buffer 2025) — but this is a video-export detail, not a rendering mode, and is meaningless until WebM export exists at all. Decision: drop column-orientation as a standalone item; fold the 9:16 canvas preset into WebM export's scope instead of inventing a separate feature for it.

---

## 4. Incidents & hardening (institutional memory — do not relearn)

1. **The `</script>` triple.** Snapshot export needs the closing-script string in source. `<\/script>` was minifier-normalized to a literal `</script>`, truncating the inlined bundle (shipped broken once). Fix `"<" + "/script>"` was **constant-folded back** by the minifier. Final: `String.fromCharCode(60, 47) + "script>"`, plus a build-time guard failing on any `</script` in the bundle, plus post-build syntax-check of the extracted inline script. The guard caught the second bug itself. **Never "simplify" this code.**
2. **`[hidden]` vs author CSS.** `.panel { display: flex }` silently defeated the `hidden` attribute. Global `[hidden] { display: none !important; }` now guards. Lesson: cascade bugs are invisible to headless testing — see backlog item on browser E2E.
3. **Trailing-zero trim vs decimals** — see decision log; regression test pinned by name.
4. **Wide-shape threshold** — see decision log.
5. **Stale-property painter crash (v1.5.0).** New code referenced `this.template` two renames after it became `this.layout`; the paint loop died on frame one. After any rename, grep the old name in *new* code too. Now caught by the DOM smoke layer.
6. **Lost-edit script failure.** Batch edit scripts that write only at the end silently discard everything when a middle edit aborts — `barPath` shipped called-but-undefined, and it recurred once more in v1.6.4 (settings validator/defaults silently dropped mid-script). Edit scripts write per-edit now; still recurs occasionally when a script's *first* assertion fails, so this stays a live discipline, not a solved problem.
9. **Stale closure over live state (v1.6.1→1.6.2).** `holdAtPeriod` captured a `Set` of event periods once, at race-build time; events added afterward in the Data panel got a caption but never a pause, since the caption path reads live state while the hold path read a snapshot. Lesson: any callback handed to a long-lived object (Playback) must re-read mutable state each call, never close over it once.
10. **Premature validation drop (v1.6.3).** The events editor ran the strict "period and text both required" validator on every keystroke, deleting in-progress rows the instant a date was picked before text was typed — silently, since the DOM wasn't rebuilt to reveal the loss. Validation belongs at read boundaries (export, open), never mid-edit; an object a user is actively filling in is not yet invalid, it's incomplete.
11. **Self-inflicted naming collision (v1.6.4→v1.7.0).** Adding log-scale support, I labeled it "Axis scale" — reusing wording already meaning something else (Settings→Axis→"Scale": dynamic/fixed rescaling). A third control (Layout→Axis: top/off) also used "Axis." No test catches a naming collision; it took a human UX review to surface it. Lesson: grep existing UI label strings before choosing a new one, the same discipline as grepping old code after a rename.
12. **Value/time collision on degenerate datasets (v1.7.1, caught by the e2e layer).** The long-format detector's value-scorer excluded the time/entity columns by *object identity* (`s !== time`), not by their final fallback header. A dataset with too few rows or a single entity can leave both time and entity candidate-scoring empty (`undefined`), at which point the identity check excludes nothing — the value scorer then picks whichever numeric column comes first by header order, which can be the time column itself. Fixed by excluding on the *final fallback header string*, computed once, regardless of whether real candidates resolved. First caught by an e2e test using an unintentionally-degenerate single-entity fixture; the fix generalizes past that one test case.
13. **Every saved race silently failed to reload, since the version was introduced (found and fixed v1.7.8).** `loadProjectById` required `project?.frontrunner === 1` exactly — but the real envelope version is `FORMAT_VERSION` (4), hardcoded separately in `share.js` rather than imported. Every project ever autosaved under v2+ returned "couldn't be loaded" on click, silently, with no error surfaced beyond a toast — so the only symptom was a person clicking "Try the sample" over and over to get back into a race, piling up dozens of dead entries in the saved-races list. The unit test suite never caught it because its own fixture hardcoded `frontrunner: 1`, matching the bug rather than reality — a fixture drifted from production the same way the code did. Fixed by accepting any numeric version (this function's job is presence, not compatibility — `migrateProject()` handles the actual upgrade) and by importing the named `FORMAT_VERSION` constant in `share.js` instead of a second hardcoded magic number. Lesson: a test fixture that hardcodes a "current" value needs the same drift protection as the code it tests — reference the shared constant, don't retype the number.
14. **CI Annotations panel is not a debugging tool (v1.7.0→v1.7.3).** GitHub's Annotations summary truncates Playwright error text, and getting the full text required expanding "Show more" — which several rounds of screenshots never fully captured. Two rounds of blind fixes to `landing page shows the hero...` failed to resolve it, and it blocked every deploy for the whole span (deploy is gated on e2e). Fix: `playwright.config.ts` now captures trace/video/screenshot on failure, uploaded as a CI artifact; the flaky test is `test.skip`'d with a dated TODO rather than deleted, and deploy is unblocked. Lesson: don't keep guessing against a summary UI that hides the actual error — get the raw step log or a real trace before the second attempt, not the fifth.
15. **WebM images broken via canvas cross-origin restriction (v1.9.2).** (See also incident 16 — the images fix immediately surfaced a second, deeper rendering bug in the same export.) Cross-origin images referenced inside an SVG used as a canvas image source are blocked by the browser — the same rule that prevents a canvas from being used to read pixel data across origins. They render perfectly in the live page (ordinary image loading, not subject to this rule) but fail specifically in the SVG→canvas step video capture requires. The "Embed images" checkbox didn't help because it only ever touched the HTML export's data payload, never the live in-memory dataset the video capture reads from. Fixed by unconditionally embedding images as data URIs before recording (swap in, record, swap back) — video export has no working alternative, unlike HTML export where linking is a legitimate choice. Caught late because the original WebM e2e test used an image-less dataset — a test covering the exact feature combination (video + images) would have caught it immediately.
7. **Process: `git commit -am` skips untracked files** — shipped an unbuildable main (missing `version.js`). Ritual is now `git add -A` + `git commit -m`, with `bun run build` as a local pre-commit gate.
8. **Process: the too-graceful deploy skip.** A missing secret produced green runs and a silently stale production. The skip now emits a `::warning::` annotation, deploys are gated on browser e2e, and the `generator` meta makes "what is production running" a one-line check.

---

## 5. Roadmap

### v1.5 — images by reference *(CLOSED 2026-07-17 — all acceptance criteria met and human-QA'd)*

Shipped across 1.5.0–1.5.7: image-URL column auto-detection (URL-ish columns excluded from entity candidacy), per-entity URL editor with commit-as-you-type and failed-URL retry, three **image placement modes** in the Layout bar row (inside / overlap / outside), sample dataset with flags demoing detection, **leading-edge bar rounding** with Theme edge presets (Square / Soft / Round / Pill), **version surfacing** (header chip, console, `generator` meta — deployment validation is one curl), and the **guardrail suites** (below).

Design ruling worth recording (Cas): image *placement* is a "where" → Layout; edge *style* is a "look" → Theme. The taxonomy held.

### v1.6 — storytelling *(CLOSED 2026-07-17 — all acceptance criteria met)*

Sourced from Flourish's feature set, dexplo's option set, the Bostock/Cotgreave critiques, and community variants. Shipped across 1.6.0–1.6.6:

1. **Category colors** (1.6.0) — optional category column in mapping; palette assigns per category; legend block joins the Layout grid. (The viral Goodspeed COVID race was colored by category; it's what turns a race from trivia into an argument.)
2. **Events & captions** (1.6.1–1.6.3) — per-project list of (period, text); caption block in the Layout grid (a *floating* block — never reserves space, since captions come and go); pause-on-event holds the race on arrival. Directly answers the "single point in time, entertainment not analysis" critique.
3. **Settings trio** (1.6.1, 1.6.4) — `endPeriodPause` (linger every period), race direction top-N/bottom-N (the "worst performers" inversion, reversed correctly per-period even when present-entity counts vary), log axis scale (shared `valueFraction()` helper keeps bars and ticks consistent).
4. **Follow mode** (1.6.5) — click a bar to spotlight an entity (others dim to 22%, the spotlighted bar gets a subtle outline); click again releases; persists in the envelope so shared links arrive pre-focused.
5. **Timeline sparkline** (1.6.6) — total-per-period curve rendered as an in-flow strip above the scrubber (deliberately not an absolute overlay — safer without live visual QA feedback mid-build).
6. **Ghost reference bar** (1.6.6) — a dashed vertical reference line at the median or mean, computed across *all* present entities each period (not just the visible topN, so it stays meaningful even when the reference entity is off-screen).

**Acceptance criteria — all met:**

- [x] Category colors: mapping offers an optional category column; entities color per category, stable across the race; a legend block joins the Layout grid; category data round-trips in the envelope.
- [x] Events & captions: a per-project (period, text) list renders in a caption block at its Layout anchor as the race passes each period; optional pause-on-event holds for a configured beat; events round-trip.
- [x] Settings trio: `endPeriodPause` holds each period boundary; bottom-N direction races the smallest values; log scale renders correct proportions and ticks.
- [x] Follow mode: clicking a bar spotlights that entity (others dim), click again releases; the followed entity persists in the envelope so shared links arrive pre-focused.
- [x] Sparkline & ghost bar: a leader-or-total sparkline renders in the scrubber strip; a ghost reference bar (median or mean) floats at its computed value each frame.

Design ruling worth recording (Cas, extending the v1.5 taxonomy): the caption block follows the same Layout-grid mechanics as every other block, but is the first to declare `reserves: false` — a precedent for any future block that's transient rather than structural.

### v1.8 — polish round *(CLOSED 2026-07-18)*

Three items from ongoing UX review, addressed in one round:
- Daily/sub-year period support — verified already working (parser needed no changes); added a "Mon D, YYYY" display format for day-level periods.
- Background patterns on Theme — a `--fr-bg-image` var (None / Subtle glow / Dot grid / Custom image URL) in the Theme pane.
- Bar palette overflow — `entityColor()` generates new colors via golden-angle hue rotation once the curated palette is exhausted, instead of repeating.

### v2 — self-containment, motion, presets *(in progress — 3 of 5 shipped 2026-07-18)*

- [x] **JSON dataset input** — `jsonToTable()` flattens an array of objects into the same shape CSV parsing produces, so the entire detection/normalization pipeline works unchanged.
- [x] **Raw-data inclusion is now a user choice** (Cas's ruling) — a Data-pane toggle, default on, controls whether the original CSV/JSON text rides in exports and share links. Applies uniformly to both formats via one `raw` envelope field.
- [x] **Image embedding at snapshot export** — an opt-in checkbox (only shown when the dataset has images) fetches each unique URL and inlines it as base64; failures degrade to the original URL, non-fatal, reported afterward. Default is link-only (Cas's ruling): most exports are for online showcase/embed, where URLs are lighter and sufficient — embedding is for the person who explicitly needs the file to work fully offline.
- [x] **WebM export** — canvas `captureStream()` + `MediaRecorder`, driven by the real `Playback` engine (forced non-looping) rather than reimplemented timing, so holds/easing/pauses are correct for free. Records at the live stage's current aspect ratio; a dedicated 9:16 portrait preset (the actual finding from the vertical-race research) is not yet built — worth a follow-up. Trade-off: recording takes real wall-clock time, same as screen capture would.
- [ ] `timeScale: "proportional"`
- [ ] **Templates** (bundled layout+theme+settings presets)

### Engineering (shipped with v1.5.7; proven throughout v1.6)

The two-layer guardrail is live: `test/smoke.dom.test.js` (happy-dom, executes the real painter inside `bun test`) and `e2e/smoke.spec.ts` (Chromium via Playwright in CI, including the `[hidden]`-cascade regression and an events-editor data-loss regression from 1.6.3). CI is one workflow — test-and-build and e2e in parallel, deploy gated on both. 139 tests total by v1.6.6close. Dev dependencies exist for testing only; runtime dependencies remain zero.

---

## 6. Concept-model changelog

- **PRD 1.0:** dataset + mapping + combined *template* + theme (format v1)
- **Rev 1:** template split → template + **settings**; **branding** introduced (v2)
- **Rev 2 (Cas):** template redefined as **placeholder grid**; size knobs → settings (v3)
- **Rev 3 (Cas):** concept renamed **Layout**; "template" reserved for future presets (v4)
- **PRD 3.0:** document mandate slimmed to decision record + flight plan; v1.6 storytelling phase added from market survey
- **PRD 3.1:** v1.5 closed (placement→Layout, edge→Theme ruling recorded); guardrail suites shipped; v1.6 acceptance criteria written; incidents 5–8 logged
- **PRD 3.2:** v1.6 closed (six storytelling features, all acceptance criteria met); floating-block precedent recorded; incidents 9–10 logged (stale-closure hold, premature validation drop); v2 is next, unscheduled
- **PRD 3.3 (v1.7.0):** UX review pass (Cas) — bar thickness moved Settings→Theme; CSV color-code column added (explicit > category > index priority); duplicate-slot soft warning; mapping-screen layout and inline image-URL entry; header Layout/Theme mini-labels; Value axis and label-position controls converted from mismatched select/checkbox to consistent checkboxes; naming-collision incident 11 logged; project-file import confirmed already working (discoverability fix only, not a new feature)
- **PRD 3.8:** v2 roadmap reframed — vertical column race dropped as unsupported by evidence (real feature elsewhere, no demonstrated demand); its one real insight (9:16 portrait canvas demand for social video) folded into WebM export's scope instead of standing alone

The model survived three revisions and grew simpler each time — the usual sign it converged.

Incident 16, added after PRD 3.12: **WebM text invisible — CSS doesn't travel with a serialized SVG (v1.9.3).** Fixing incident 15 immediately surfaced this: bars and image discs get their fill via inline attributes set directly by JS, so they survived serialization fine — but every text element (title, labels, axis ticks, legend, rank/value numbers) gets its color and font from CSS classes defined in the page's stylesheet, which never travels with a standalone-serialized `<svg>...</svg>` string. Text fell back to the SVG default (black fill), invisible against the dark theme — not literally missing, just unreadable. Deeper still: theme colors are CSS custom properties set as *inline styles* on `<html>` at runtime (`applyTheme()`), not literal CSS rules — so even copying the stylesheet via the CSSOM wouldn't give `var(--fr-text)` anything to resolve against. Fixed by injecting a `<style>` into a cloned SVG before each capture, containing both the collected stylesheet rules (via `document.styleSheets`, which works whether CSS is inline or external) and an explicit `:root { --fr-x: value; ... }` block built by enumerating `document.documentElement.style` directly. Lesson: serializing a live DOM subtree for rendering elsewhere loses everything that reached it via cascade rather than attribute — a class-based style and a CSS custom property are both invisible to `XMLSerializer` on their own.
