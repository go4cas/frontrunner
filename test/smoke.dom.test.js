// Painter smoke suite — runs the ACTUAL rendering path under happy-dom.
// This layer exists because four shipped incidents were invisible to pure
// unit tests: the painter only fails when it executes against a DOM.
import { describe, expect, test, beforeAll } from "bun:test";
import { Window } from "happy-dom";
import { parseCSV, detectShape, normalize } from "../src/parse.js";
import { precompute, frameState } from "../src/engine.js";
import { LAYOUTS, THEMES, DEFAULT_SETTINGS, sampleCSV } from "../src/builtins.js";
import { validateLayout } from "../src/editors.js";

let Painter, svg, ds, pre;

function makeSvg(doc) {
  const el = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  // happy-dom has no layout engine — report a realistic stage so
  // geometry-dependent behavior (disc fitting, label flips) is exercised.
  el.getBoundingClientRect = () => ({ width: 1280, height: 720, top: 0, left: 0, right: 1280, bottom: 720, x: 0, y: 0 });
  doc.body.append(el);
  return el;
}

function visibleBars(svgEl) {
  return [...svgEl.querySelectorAll("g.fr-bar")].filter((g) => g.style.display !== "none");
}

beforeAll(async () => {
  const win = new Window();
  globalThis.document = win.document;
  globalThis.getComputedStyle = win.getComputedStyle.bind(win);
  ({ Painter } = await import("../src/render.js"));
  const { headers, rows } = parseCSV(sampleCSV());
  ds = normalize(headers, rows, detectShape(headers, rows));
  pre = precompute(ds);
});

describe("painter smoke (happy-dom)", () => {
  test("paints the sample: ≥10 visible bars with real path geometry and labels", () => {
    svg = makeSvg(document);
    const p = new Painter(svg, ds, structuredClone(LAYOUTS[0]), structuredClone(DEFAULT_SETTINGS), structuredClone(THEMES[0]), {});
    p.paint(frameState(ds, pre, DEFAULT_SETTINGS, 0));
    const bars = visibleBars(svg);
    expect(bars.length).toBeGreaterThanOrEqual(10);
    for (const g of bars) {
      const d = g.querySelector(".fr-barshape")?.getAttribute("d");
      expect(d?.startsWith("M")).toBe(true);
    }
    const labels = [...svg.querySelectorAll(".fr-label")].map((n) => n.textContent);
    expect(labels).toContain("China");
  });

  test("mid-interpolation frames paint without throwing", () => {
    svg = makeSvg(document);
    const p = new Painter(svg, ds, structuredClone(LAYOUTS[0]), structuredClone(DEFAULT_SETTINGS), structuredClone(THEMES[0]), {});
    for (const t of [0, 0.25, 3.5, 5.999, 6]) {
      p.paint(frameState(ds, pre, DEFAULT_SETTINGS, t));
    }
    expect(visibleBars(svg).length).toBeGreaterThanOrEqual(10);
  });

  test("every built-in layout × theme combination paints", () => {
    svg = makeSvg(document);
    const p = new Painter(svg, ds, structuredClone(LAYOUTS[0]), structuredClone(DEFAULT_SETTINGS), structuredClone(THEMES[0]), {});
    for (const layout of LAYOUTS) {
      for (const theme of THEMES) {
        p.setLayout(structuredClone(layout));
        p.setTheme(structuredClone(theme));
        p.paint(frameState(ds, pre, DEFAULT_SETTINGS, 2.5));
      }
    }
    expect(visibleBars(svg).length).toBeGreaterThan(0);
  });

  test("all image placement modes position discs with hrefs (regression: v1.5.1 crash class)", () => {
    for (const mode of ["inside", "overlap", "outside"]) {
      svg = makeSvg(document);
      const { layout } = validateLayout({ ...structuredClone(LAYOUTS[0]), bar: { ...LAYOUTS[0].bar, imagePosition: mode } });
      const p = new Painter(svg, ds, layout, structuredClone(DEFAULT_SETTINGS), structuredClone(THEMES[0]), {});
      p.paint(frameState(ds, pre, DEFAULT_SETTINGS, 6));
      const withImages = [...svg.querySelectorAll("image.fr-img")].filter(
        (n) => n.style.display !== "none" && n.getAttribute("href")
      );
      expect(withImages.length).toBeGreaterThan(0);
      for (const n of withImages) expect(n.getAttribute("href")).toContain("flagcdn");
    }
  });

  test("settings changes (topN, thickness, fixed axis) repaint cleanly", () => {
    svg = makeSvg(document);
    const p = new Painter(svg, ds, structuredClone(LAYOUTS[0]), structuredClone(DEFAULT_SETTINGS), structuredClone(THEMES[0]), {});
    for (const overrides of [{ topN: 5 }, { topN: 14 }, { barThickness: 0.3 }, { axisScale: "fixed" }]) {
      const settings = { ...structuredClone(DEFAULT_SETTINGS), ...overrides };
      p.setSettings(settings);
      p.paint(frameState(ds, pre, settings, 3));
    }
    expect(visibleBars(svg).length).toBeGreaterThan(0);
  });

  test("branding blocks render when content exists and collapse when empty", () => {
    svg = makeSvg(document);
    const branding = { title: "The Race", subtitle: "sub", source: "Data: X", link: "https://x.test", logoUrl: "" };
    const p = new Painter(svg, ds, structuredClone(LAYOUTS[0]), structuredClone(DEFAULT_SETTINGS), structuredClone(THEMES[0]), branding);
    p.paint(frameState(ds, pre, DEFAULT_SETTINGS, 0));
    expect(svg.querySelector(".fr-title").textContent).toBe("The Race");
    expect(svg.querySelector(".fr-source-link").getAttribute("href")).toBe("https://x.test");
    p.setBranding({});
    p.paint(frameState(ds, pre, DEFAULT_SETTINGS, 0));
    expect(svg.querySelector(".fr-title").style.display).toBe("none");
  });
});
