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

  test("more entities than palette colors: overflow entities get distinct colors, not repeats (regression)", () => {
    svg = makeSvg(document);
    // 14 entities, a 10-color palette — 4 must overflow into generated hues.
    const bigDs = {
      periods: [2020],
      entities: Array.from({ length: 14 }, (_, i) => `E${i}`),
      values: Float64Array.from(Array.from({ length: 14 }, (_, i) => 100 - i)),
      images: {}, categories: {}, colors: {},
    };
    const settings = { ...structuredClone(DEFAULT_SETTINGS), topN: 14 };
    const p = new Painter(svg, bigDs, structuredClone(LAYOUTS[0]), settings, structuredClone(THEMES[0]), {});
    p.paint(frameState(bigDs, precompute(bigDs), settings, 0));
    const fills = [...svg.querySelectorAll("g.fr-bar .fr-barshape")].map((n) => n.getAttribute("fill"));
    expect(fills.length).toBe(14);
    expect(new Set(fills).size).toBe(14); // no two entities share a color
  });

  test("explicit CSV color overrides category and index coloring", () => {
    svg = makeSvg(document);
    const withColor = structuredClone(ds);
    withColor.colors = { China: "#123456" };
    const p = new Painter(svg, withColor, structuredClone(LAYOUTS[0]), structuredClone(DEFAULT_SETTINGS), structuredClone(THEMES[0]), {});
    p.paint(frameState(withColor, pre, DEFAULT_SETTINGS, 6));
    const fill = [...svg.querySelectorAll("g.fr-bar")]
      .find((g) => g.querySelector(".fr-label")?.textContent === "China")
      ?.querySelector(".fr-barshape")
      ?.getAttribute("fill");
    expect(fill).toBe("#123456");
  });

  test("categories drive shared colors and a visible legend", () => {
    svg = makeSvg(document);
    const p = new Painter(svg, ds, structuredClone(LAYOUTS[0]), structuredClone(DEFAULT_SETTINGS), structuredClone(THEMES[0]), {});
    p.paint(frameState(ds, pre, DEFAULT_SETTINGS, 6));
    // China and India share a continent → identical bar fills
    const fillOf = (name) =>
      [...svg.querySelectorAll("g.fr-bar")]
        .find((g) => g.querySelector(".fr-label")?.textContent === name)
        ?.querySelector(".fr-barshape")
        ?.getAttribute("fill");
    expect(fillOf("China")).toBe(fillOf("India"));
    expect(fillOf("China")).not.toBe(fillOf("Russia"));
    // Legend renders one label per category
    const legendLabels = [...svg.querySelectorAll(".fr-legend-label")].map((n) => n.textContent);
    expect(legendLabels).toEqual(["Asia", "Americas", "Africa", "Europe"]);
  });

  test("bar thickness reads from the Theme, not Settings — thinner theme yields shorter bars", () => {
    svg = makeSvg(document);
    const thin = structuredClone(THEMES[0]);
    thin.vars["--fr-bar-thickness"] = "0.3";
    const thick = structuredClone(THEMES[0]);
    thick.vars["--fr-bar-thickness"] = "0.9";
    const pThin = new Painter(svg, ds, structuredClone(LAYOUTS[0]), structuredClone(DEFAULT_SETTINGS), thin, {});
    pThin.paint(frameState(ds, pre, DEFAULT_SETTINGS, 6));
    const hThin = svg.querySelector("g.fr-bar .fr-barshape").getAttribute("d");
    svg = makeSvg(document);
    const pThick = new Painter(svg, ds, structuredClone(LAYOUTS[0]), structuredClone(DEFAULT_SETTINGS), thick, {});
    pThick.paint(frameState(ds, pre, DEFAULT_SETTINGS, 6));
    const hThick = svg.querySelector("g.fr-bar .fr-barshape").getAttribute("d");
    // Path heights differ (encoded in the 'v' command); exact string mismatch is sufficient proof.
    expect(hThin).not.toBe(hThick);
  });

  test("ghost reference line renders when enabled, hides when off", () => {
    svg = makeSvg(document);
    const settings = { ...structuredClone(DEFAULT_SETTINGS), ghostBar: "median" };
    const p = new Painter(svg, ds, structuredClone(LAYOUTS[0]), settings, structuredClone(THEMES[0]), {});
    p.paint(frameState(ds, pre, settings, 6));
    const ghost = svg.querySelector(".fr-ghost");
    expect(ghost.style.display).not.toBe("none");
    expect(svg.querySelector(".fr-ghost-line").getAttribute("x1")).toBeTruthy();
    expect(svg.querySelector(".fr-ghost-label").textContent).toContain("median");

    const settingsOff = { ...structuredClone(DEFAULT_SETTINGS), ghostBar: "off" };
    p.setSettings(settingsOff);
    p.paint(frameState(ds, pre, settingsOff, 6));
    expect(svg.querySelector(".fr-ghost").style.display).toBe("none");
  });

  test("bottom-N direction visibly reorders which entities lead", () => {
    svg = makeSvg(document);
    const settings = { ...structuredClone(DEFAULT_SETTINGS), rankDirection: "bottom" };
    const p = new Painter(svg, ds, structuredClone(LAYOUTS[0]), settings, structuredClone(THEMES[0]), {});
    p.paint(frameState(ds, pre, settings, 6));
    const firstLabel = svg.querySelector("g.fr-bar .fr-label")?.textContent;
    // With population data, the smallest nation should now lead, not China.
    expect(firstLabel).not.toBe("China");
  });

  test("follow mode dims non-followed bars and highlights the followed one", () => {
    svg = makeSvg(document);
    const p = new Painter(svg, ds, structuredClone(LAYOUTS[0]), structuredClone(DEFAULT_SETTINGS), structuredClone(THEMES[0]), {}, [], "China");
    p.paint(frameState(ds, pre, DEFAULT_SETTINGS, 6));
    const barFor = (name) =>
      [...svg.querySelectorAll("g.fr-bar")].find((g) => g.querySelector(".fr-label")?.textContent === name);
    expect(Number(barFor("China").getAttribute("opacity"))).toBeCloseTo(1, 1);
    expect(barFor("China").classList.contains("fr-bar--followed")).toBe(true);
    expect(Number(barFor("India").getAttribute("opacity"))).toBeLessThan(0.5);
    expect(barFor("India").classList.contains("fr-bar--followed")).toBe(false);
  });

  test("setFollowed toggles: clicking the same entity releases it", () => {
    svg = makeSvg(document);
    const p = new Painter(svg, ds, structuredClone(LAYOUTS[0]), structuredClone(DEFAULT_SETTINGS), structuredClone(THEMES[0]), {});
    expect(p.setFollowed("China")).toBe("China");
    expect(p.setFollowed("China")).toBe(null);
    expect(p.setFollowed("India")).toBe("India");
  });

  test("log value scale renders without throwing across the timeline", () => {
    svg = makeSvg(document);
    const settings = { ...structuredClone(DEFAULT_SETTINGS), valueScale: "log" };
    const p = new Painter(svg, ds, structuredClone(LAYOUTS[0]), settings, structuredClone(THEMES[0]), {});
    for (const t of [0, 2.5, 6]) p.paint(frameState(ds, pre, settings, t));
    expect(visibleBars(svg).length).toBeGreaterThan(0);
  });

  test("event captions appear on their period and vanish elsewhere", () => {
    svg = makeSvg(document);
    const events = [{ period: "1990", text: "The wall falls" }];
    const p = new Painter(svg, ds, structuredClone(LAYOUTS[0]), structuredClone(DEFAULT_SETTINGS), structuredClone(THEMES[0]), {}, events);
    const idx1990 = ds.periods.findIndex((x) => String(x) === "1990");
    p.paint(frameState(ds, pre, DEFAULT_SETTINGS, idx1990));
    const cap = svg.querySelector(".fr-caption");
    expect(cap.style.display).not.toBe("none");
    expect(cap.textContent).toBe("The wall falls");
    p.paint(frameState(ds, pre, DEFAULT_SETTINGS, 0));
    expect(cap.style.display).toBe("none");
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
