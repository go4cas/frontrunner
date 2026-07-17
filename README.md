# frontrunner

Bar chart races from a CSV. One HTML file, zero dependencies, runs entirely in your browser.

Drop in a CSV (long or wide format — it figures out which), check the column mapping, and watch the race. Lay it out, theme it, brand it, scrub it, and share the whole thing as a URL: the dataset travels compressed inside the link, no server involved.

## Use it

Open `dist/index.html`. That's the product — it works hosted or straight from `file://`.

- **Input:** drag-drop a `.csv`, paste CSV text, or fetch from a URL. Long format (`year,country,population`) and wide format (`country,1960,1970,…`) both work.
- **Playback:** play/pause (space), scrub, step with arrow keys, 0.5–4× speed, loop.
- **Settings** control how much and how fast: top-N, bar thickness, speed, easing, value/period formatting, axis scale (dynamic or fixed-at-global-max).
- **Layouts** control where things sit: a placeholder grid — assign the title, logo, period clock, running total, and source line to any corner (or off), plus the bar-row composition. Three built-ins including *Broadcast* (centered title, giant bottom-center clock).
- **Themes** control looks: colors, fonts, bar radius, borders, shadows — all CSS custom properties. Save your own layouts and themes to a personal library.
- **Brand** is what it says: title, subtitle, logo (by URL), source line, and a link that stays clickable in exports.
- **Share:** the project (data included) compresses into the URL hash via the browser's native `CompressionStream` — typical datasets are a couple of KB. Big datasets get a friendly warning and a file-export alternative.
- **Persistence:** every race autosaves to a local library (open / rename / duplicate / delete from the home screen). Export/import `.frontrunner.json` project files, or export a **standalone snapshot** — a self-contained `.race.html` that auto-plays anywhere, even from `file://`.
- **Compatibility:** the project format is versioned (currently v4) with an automatic migration chain — old share links and files keep opening.

Nothing you load ever leaves your machine. There is no server.

## Develop

Requires [Bun](https://bun.sh) for the dev server, tests, and build — the app itself has zero runtime dependencies.

```sh
bun run serve   # dev server at http://localhost:3300 (or just open src/index.html)
bun test        # parser, engine, share-codec tests
bun run build   # → dist/index.html, one file, zero external requests
```

### Layout

```
src/
  parse.js      CSV parser, shape detection, normalization
  engine.js     rank precompute, interpolation, frame state, playback clock (pure, no DOM)
  render.js     SVG painter (node recycling, attribute updates only per frame)
  share.js      project envelope, gzip → base64url share-link codec
  store.js      localStorage autosave
  builtins.js   built-in templates, themes, sample dataset
  app.js        state machine + wiring
  index.html    shell
  styles.css    UI chrome (chart visuals derive from theme vars)
```

## Roadmap

- **v1 (complete):** the race — parser, engine, playback, the five-concern editor (Data / Settings / Layout / Theme / Brand), personal libraries, project library, share links, standalone snapshot export, versioned format with migrations
- **v1.5:** entity images by URL reference
- **v2:** image embedding at export, WebM video export, JSON input, proportional time scale, and *templates* — bundled layout+theme+settings presets

See `PRD.md` for the full spec, concept model, and the incidents log.

MIT
