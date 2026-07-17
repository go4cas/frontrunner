// frontrunner — render.js
// SVG painter. Consumes engine.frameState() output. Creates nodes lazily per
// entity, updates attributes per frame, never churns the DOM during playback.
//
// Placeholder layout: the layout assigns each block (title, logo, clock,
// total, source, axis) an anchor — top/bottom × left/center/right — and the
// painter stacks blocks sharing an anchor. Top anchors and the source footer
// RESERVE space (the plot shrinks); the clock and total FLOAT over the plot,
// as is traditional for the big year readout.

import { niceTicks, formatValue, formatPeriod, entityColor } from "./engine.js";

const NS = "http://www.w3.org/2000/svg";

function el(name, attrs = {}) {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

const MARGIN = { top: 16, right: 24, bottom: 14, left: 16 };
const RANK_W = 34;
const OUTSIDE_LABEL_W = 200;
const TITLE_H = 28;
const SUBTITLE_H = 20;
const LOGO_H = 36;
const LOGO_W = 160;
const TOTAL_H = 24;
const SOURCE_H = 18;
const AXIS_H = 24;

export class Painter {
  constructor(svg, dataset, layout, settings, theme, branding) {
    this.svg = svg;
    this.dataset = dataset;
    this.layout = layout;
    this.settings = settings;
    this.theme = theme;
    this.branding = branding ?? {};
    this.nodes = new Map();
    this.tickNodes = [];
    this.failedImages = new Set(); // URLs that errored — degrade silently, retry only if URL changes
    this.width = 0;
    this.height = 0;

    this._initMeasure();
    // Category order of first appearance drives palette-by-category.
    this.catList = [...new Set(dataset.entities.map((e) => dataset.categories?.[e]).filter(Boolean))];

    svg.textContent = "";
    this.gAxis = el("g", { class: "fr-axis" });
    this.gBars = el("g", { class: "fr-bars" });
    this.gBlocks = el("g", { class: "fr-blocks" });
    svg.append(this.gAxis, this.gBars, this.gBlocks);

    this.titleText = el("text", { class: "fr-title" });
    this.subtitleText = el("text", { class: "fr-subtitle" });
    this.logoImage = el("image", { class: "fr-logo" });
    this.periodText = el("text", { class: "fr-period" });
    this.totalText = el("text", { class: "fr-total" });
    this.sourceLink = el("a", { class: "fr-source-link", target: "_blank", rel: "noopener" });
    this.sourceText = el("text", { class: "fr-source" });
    this.sourceLink.append(this.sourceText);
    this.gLegend = el("g", { class: "fr-legend" });
    this.gBlocks.append(this.titleText, this.subtitleText, this.logoImage, this.periodText, this.totalText, this.sourceLink, this.gLegend);

    this.resize();
  }

  setLayout(layout) {
    this.layout = layout;
    this.reflow();
  }

  setSettings(settings) {
    this.settings = settings;
    this.reflow();
  }

  /** Forget a failed URL so the next paint retries it (called on URL edits). */
  retryImage(url) {
    if (url) this.failedImages.delete(url);
  }

  setBranding(branding) {
    this.branding = branding ?? {};
    this.reflow();
  }

  /** Entity color: by category when categories exist, else by entity order. */
  _colorFor(index) {
    if (this.catList.length) {
      const cat = this.dataset.categories?.[this.dataset.entities[index]];
      const ci = this.catList.indexOf(cat);
      if (ci >= 0) return entityColor(ci, this.theme.palette);
    }
    return entityColor(index, this.theme.palette);
  }

  setTheme(theme) {
    this.theme = theme;
    this._initMeasure(); // font stack may have changed; re-measure labels
    for (const [index, n] of this.nodes) {
      n.rect.setAttribute("fill", this._colorFor(index));
      n.disc.setAttribute("fill", this._colorFor(index));
    }
    this.reflow();
  }

  /** Canvas-based label measurement: exact widths, computed once per entity,
   * never per frame. Replaces the old chars×7.2px estimate that collided
   * values with long names in inside-label mode. */
  _initMeasure() {
    // 2D canvas may be absent (DOM shims, exotic embeds) — fall back to an
    // estimate rather than crashing the painter.
    this._measureCtx ??= document.createElement("canvas").getContext?.("2d") ?? null;
    if (this._measureCtx) {
      const fam =
        (this.theme?.vars?.["--fr-font-display"] ??
          getComputedStyle(document.documentElement).getPropertyValue("--fr-font-display")) || "system-ui";
      this._measureCtx.font = "600 14px " + String(fam).trim();
    }
    this._labelW = new Map();
  }

  _textW(s) {
    let w = this._labelW.get(s);
    if (w === undefined) {
      w = this._measureCtx ? this._measureCtx.measureText(s).width : s.length * 7.2;
      this._labelW.set(s, w);
    }
    return w;
  }

  resize() {
    const rect = this.svg.getBoundingClientRect();
    this.width = Math.max(320, rect.width);
    this.height = Math.max(240, rect.height);
    this.svg.setAttribute("viewBox", `0 0 ${this.width} ${this.height}`);
    this.reflow();
  }

  /** Which blocks are actually live: slotted somewhere AND having content. */
  _blocks() {
    const { slots } = this.layout;
    const b = this.branding;
    const clockSize = Number(this.theme.vars["--fr-period-label-size"]) || 72;
    const out = [];
    if (slots.title !== "off" && (b.title || b.subtitle)) {
      out.push({ id: "title", anchor: slots.title, h: (b.title ? TITLE_H : 0) + (b.subtitle ? SUBTITLE_H : 0), reserves: true });
    }
    if (slots.logo !== "off" && b.logoUrl) {
      out.push({ id: "logo", anchor: slots.logo, h: LOGO_H + 6, reserves: slots.logo.startsWith("top") });
    }
    if (slots.clock !== "off") {
      out.push({ id: "clock", anchor: slots.clock, h: clockSize * 0.82, reserves: false });
    }
    if (slots.total !== "off") {
      out.push({ id: "total", anchor: slots.total, h: TOTAL_H, reserves: false });
    }
    if (slots.source !== "off" && (b.source || b.link)) {
      out.push({ id: "source", anchor: slots.source, h: SOURCE_H, reserves: true });
    }
    if (slots.legend !== "off" && this.catList.length) {
      out.push({ id: "legend", anchor: slots.legend, h: 24, reserves: true });
    }
    return out;
  }

  reflow() {
    const tpl = this.layout;
    const set = this.settings;
    const blocks = this._blocks();

    // Reserved bands: max reserving-stack height per top row; source-height for bottom.
    let topReserve = 0;
    let bottomReserve = 0;
    for (const side of ["left", "center", "right"]) {
      const topStack = blocks.filter((b) => b.reserves && b.anchor === `top-${side}`);
      topReserve = Math.max(topReserve, topStack.reduce((a, b) => a + b.h, 0));
      const botStack = blocks.filter((b) => b.reserves && b.anchor === `bottom-${side}`);
      bottomReserve = Math.max(bottomReserve, botStack.reduce((a, b) => a + b.h, 0));
    }
    const axisOn = tpl.slots.axis === "top";
    const outside = tpl.bar.labelPosition === "outside";

    this.plot = {
      x: MARGIN.left + (tpl.bar.showRank ? RANK_W : 0),
      y: MARGIN.top + topReserve + (axisOn ? AXIS_H : 0),
      w: this.width - MARGIN.left - MARGIN.right - (tpl.bar.showRank ? RANK_W : 0) - (outside ? OUTSIDE_LABEL_W : 90),
      h: this.height - MARGIN.top - topReserve - (axisOn ? AXIS_H : 0) - MARGIN.bottom - bottomReserve,
    };
    this.slotH = this.plot.h / set.topN;
    this.barH = this.slotH * set.barThickness;
    const rawRadius = String(this.theme.vars["--fr-bar-radius"] ?? "0").trim();
    this.barRadius = rawRadius === "pill" ? this.barH / 2 : Number(rawRadius) || 0;

    this._placeBlocks(blocks, bottomReserve);
  }

  _anchorX(anchor) {
    const side = anchor.split("-")[1];
    if (side === "left") return { x: MARGIN.left, ta: "start" };
    if (side === "center") return { x: this.width / 2, ta: "middle" };
    return { x: this.width - MARGIN.right, ta: "end" };
  }

  _placeBlocks(blocks, bottomReserve) {
    const b = this.branding;
    const clockSize = Number(this.theme.vars["--fr-period-label-size"]) || 72;

    // Hide everything, then place live blocks.
    for (const node of [this.titleText, this.subtitleText, this.logoImage, this.periodText, this.totalText, this.sourceText]) {
      node.style.display = "none";
    }
    this.gLegend.textContent = ""; // rebuilt only if the legend block is live

    // Stack cursors per anchor. Top stacks grow downward from the margin;
    // bottom stacks grow upward from above the reserved footer.
    const cursors = {};
    const topCursor = (a) => (cursors[a] ??= MARGIN.top);
    const bottomCursor = (a) => (cursors[a] ??= this.height - MARGIN.bottom);

    // Deterministic placement order: reserving blocks first, floats last,
    // so floats stack above/below reserved content at a shared anchor.
    const ordered = [...blocks].sort((x, y) => Number(y.reserves) - Number(x.reserves));

    for (const block of ordered) {
      const { x, ta } = this._anchorX(block.anchor);
      const top = block.anchor.startsWith("top");
      let y;
      if (top) {
        y = topCursor(block.anchor);
        cursors[block.anchor] += block.h;
      } else {
        cursors[block.anchor] = bottomCursor(block.anchor) - block.h;
        y = cursors[block.anchor];
      }

      if (block.id === "title") {
        if (b.title) {
          this.titleText.style.display = "";
          this.titleText.setAttribute("x", x);
          this.titleText.setAttribute("y", y + 20);
          this.titleText.setAttribute("text-anchor", ta);
          this.titleText.textContent = b.title;
        }
        if (b.subtitle) {
          this.subtitleText.style.display = "";
          this.subtitleText.setAttribute("x", x);
          this.subtitleText.setAttribute("y", y + (b.title ? TITLE_H : 0) + 14);
          this.subtitleText.setAttribute("text-anchor", ta);
          this.subtitleText.textContent = b.subtitle;
        }
      } else if (block.id === "logo") {
        this.logoImage.style.display = "";
        const lx = ta === "start" ? x : ta === "middle" ? x - LOGO_W / 2 : x - LOGO_W;
        this.logoImage.setAttribute("href", b.logoUrl);
        this.logoImage.setAttribute("x", lx);
        this.logoImage.setAttribute("y", y + 3);
        this.logoImage.setAttribute("width", LOGO_W);
        this.logoImage.setAttribute("height", LOGO_H);
        this.logoImage.setAttribute(
          "preserveAspectRatio",
          ta === "start" ? "xMinYMin meet" : ta === "middle" ? "xMidYMin meet" : "xMaxYMin meet"
        );
      } else if (block.id === "clock") {
        this.periodText.style.display = "";
        this.periodText.setAttribute("x", x);
        this.periodText.setAttribute("y", y + block.h - clockSize * 0.12);
        this.periodText.setAttribute("text-anchor", ta);
        this.periodText.setAttribute("font-size", clockSize);
      } else if (block.id === "total") {
        this.totalText.style.display = "";
        this.totalText.setAttribute("x", x);
        this.totalText.setAttribute("y", y + TOTAL_H - 6);
        this.totalText.setAttribute("text-anchor", ta);
      } else if (block.id === "legend") {
        this.gLegend.textContent = "";
        const SW = 11; // swatch size
        const GAP_ITEM = 18;
        const GAP_SWATCH = 6;
        const widths = this.catList.map((c) => SW + GAP_SWATCH + this._textW(c) * 0.86 + GAP_ITEM);
        const total = widths.reduce((a, w) => a + w, -GAP_ITEM);
        let lx = ta === "start" ? x : ta === "middle" ? x - total / 2 : x - total;
        this.catList.forEach((cat, ci) => {
          const sw = el("rect", { x: lx, y: y + 6, width: SW, height: SW, rx: 3, fill: entityColor(ci, this.theme.palette) });
          const label = el("text", { class: "fr-legend-label", x: lx + SW + GAP_SWATCH, y: y + 15 });
          label.textContent = cat;
          this.gLegend.append(sw, label);
          lx += widths[ci];
        });
      } else if (block.id === "source") {
        this.sourceText.style.display = "";
        this.sourceText.setAttribute("x", x);
        this.sourceText.setAttribute("y", y + SOURCE_H - 5);
        this.sourceText.setAttribute("text-anchor", ta);
        this.sourceText.textContent = [b.source, b.link].filter(Boolean).join("  ·  ");
        if (b.link) this.sourceLink.setAttribute("href", b.link);
        else this.sourceLink.removeAttribute("href");
      }
    }
    void bottomReserve; // reserved band already carved from plot height
  }

  _bundle(index, entity) {
    let n = this.nodes.get(index);
    if (n) return n;
    const g = el("g", { class: "fr-bar" });
    // Path, not rect: bars round only their leading (right) end — flat at the
    // axis, rounded where the race happens. Radius from --fr-bar-radius.
    const rect = el("path", {
      class: "fr-barshape",
      fill: this._colorFor(index),
    });
    const rank = el("text", { class: "fr-rank", "text-anchor": "end" });
    const label = el("text", { class: "fr-label" });
    const value = el("text", { class: "fr-value" });
    label.textContent = entity;

    // Circular image at the bar end: clipPath + backing disc + <image>.
    // Created for every bundle, shown only when a URL exists and loads.
    const clipId = `fr-clip-${index}`;
    const clip = el("clipPath", { id: clipId });
    const clipCircle = el("circle");
    clip.append(clipCircle);
    const disc = el("circle", { class: "fr-img-disc", fill: this._colorFor(index) });
    const image = el("image", {
      class: "fr-img",
      "clip-path": `url(#${clipId})`,
      preserveAspectRatio: "xMidYMid slice",
    });
    image.addEventListener("error", () => {
      const url = image.getAttribute("href");
      if (url && !this.failedImages.has(url)) {
        this.failedImages.add(url);
        console.info(`frontrunner: image failed to load, showing plain bar — ${url}`);
      }
      image.style.display = "none";
      disc.style.display = "none";
    });

    g.append(rect, clip, disc, image, rank, label, value);
    this.gBars.append(g);
    n = { g, rect, rank, label, value, image, disc, clipCircle, currentUrl: null };
    this.nodes.set(index, n);
    return n;
  }

  /** Position (or hide) the circular image for a bar. Returns the label offset.
   * The disc is INSCRIBED in the bar end — nested inside the pill tip with a
   * rim of bar color, never protruding past the nose. Bars too short to
   * contain the disc hide it. */
  _paintImage(n, entity, barStartX, barEndX, midY) {
    const url = this.layout.bar.showImage ? this.dataset.images?.[entity] : null;
    const mode = this.layout.bar.imagePosition ?? "inside";
    const inset = 3;
    const r = mode === "inside" ? Math.min(this.barH / 2 - inset, 23) : Math.min(this.barH / 2 + 3, 26);
    // Only "inside" needs the bar to contain the disc; the other modes always fit.
    const fits = mode !== "inside" || (barEndX - barStartX >= 2 * (r + inset) && r >= 7);
    if (!url || this.failedImages.has(url) || !fits) {
      n.image.style.display = "none";
      n.disc.style.display = "none";
      n.currentUrl = url ?? null;
      return 10;
    }
    if (n.currentUrl !== url) {
      n.image.removeAttribute("href"); // reset so a retried URL re-fires the load
      n.image.setAttribute("href", url);
      n.currentUrl = url;
    }
    const cx =
      mode === "inside" ? barEndX - r - inset // inscribed in the cap
      : mode === "overlap" ? barEndX          // straddling the nose
      : barEndX + r + 6;                      // fully past the nose
    n.image.style.display = "";
    n.disc.style.display = "";
    n.clipCircle.setAttribute("cx", cx);
    n.clipCircle.setAttribute("cy", midY);
    n.clipCircle.setAttribute("r", r);
    n.disc.setAttribute("cx", cx);
    n.disc.setAttribute("cy", midY);
    n.disc.setAttribute("r", r + 1); // hairline rim behind the image
    n.image.setAttribute("x", cx - r);
    n.image.setAttribute("y", midY - r);
    n.image.setAttribute("width", r * 2);
    n.image.setAttribute("height", r * 2);
    // Label offset: clear whatever the disc occupies beyond the bar end.
    return mode === "inside" ? 10 : mode === "overlap" ? r + 12 : 2 * r + 16;
  }

  /** Paint one frame. state = engine.frameState() output. */
  paint(state) {
    const tpl = this.layout;
    const fmt = this.settings.valueFormat;
    const { x, y, w } = this.plot;
    const outside = tpl.bar.labelPosition === "outside";
    const seen = new Set();

    for (const bar of state.bars) {
      seen.add(bar.index);
      const n = this._bundle(bar.index, bar.entity);
      const by = y + bar.rank * this.slotH + (this.slotH - this.barH) / 2;
      const bw = Math.max(0, (bar.value / state.axisMax) * w);
      n.g.setAttribute("opacity", bar.opacity.toFixed(3));
      n.g.style.display = "";
      n.rect.setAttribute("d", barPath(x, by, bw, this.barH, this.barRadius));

      const midY = by + this.barH / 2;
      const labelOffset = this._paintImage(n, bar.entity, x, x + bw, midY);
      if (tpl.bar.showRank) {
        n.rank.style.display = "";
        n.rank.setAttribute("x", x - 10);
        n.rank.setAttribute("y", midY);
        n.rank.textContent = String(Math.round(bar.rank) + 1);
      } else {
        n.rank.style.display = "none";
      }

      const valueText = tpl.bar.showValue ? formatValue(bar.value, fmt) : "";
      if (outside) {
        n.label.setAttribute("x", x + bw + labelOffset);
        n.label.setAttribute("y", midY - (tpl.bar.showValue ? 7 : 0));
        n.label.setAttribute("text-anchor", "start");
        n.label.classList.remove("fr-label--inside");
        n.value.setAttribute("x", x + bw + labelOffset);
        n.value.setAttribute("y", midY + 11);
        n.value.setAttribute("text-anchor", "start");
      } else {
        const labelW = this._textW(bar.entity);
        const inside = bw > labelW + 28 + labelOffset; // label fits inside, clear of the disc
        n.label.setAttribute("x", inside ? x + bw - labelOffset : x + bw + labelOffset);
        n.label.setAttribute("y", midY);
        n.label.setAttribute("text-anchor", inside ? "end" : "start");
        n.label.classList.toggle("fr-label--inside", inside);
        n.value.setAttribute("x", x + bw + (inside ? labelOffset : labelOffset + 6 + labelW));
        n.value.setAttribute("y", midY);
        n.value.setAttribute("text-anchor", "start");
      }
      n.value.textContent = valueText;
    }

    for (const [index, n] of this.nodes) {
      if (!seen.has(index)) n.g.style.display = "none";
    }

    this._paintAxis(state);

    if (this.layout.slots.clock !== "off") {
      this.periodText.textContent = formatPeriod(state.periodLabel, this.settings.periodLabelFormat);
    }
    if (this.layout.slots.total !== "off") {
      this.totalText.textContent = "Σ " + formatValue(state.total, fmt);
    }
  }

  _paintAxis(state) {
    if (this.layout.slots.axis !== "top") {
      this.gAxis.style.display = "none";
      return;
    }
    this.gAxis.style.display = "";
    const { x, y, w, h } = this.plot;
    const ticks = niceTicks(state.axisMax, 5);
    while (this.tickNodes.length < ticks.length) {
      const g = el("g", { class: "fr-tick" });
      const line = el("line");
      const text = el("text", { "text-anchor": "middle" });
      g.append(line, text);
      this.gAxis.append(g);
      this.tickNodes.push({ g, line, text });
    }
    this.tickNodes.forEach((n, idx) => {
      if (idx >= ticks.length) {
        n.g.style.display = "none";
        return;
      }
      const v = ticks[idx];
      const tx = x + (v / state.axisMax) * w;
      n.g.style.display = "";
      n.line.setAttribute("x1", tx);
      n.line.setAttribute("x2", tx);
      n.line.setAttribute("y1", y - 6);
      n.line.setAttribute("y2", y + h);
      n.text.setAttribute("x", tx);
      n.text.setAttribute("y", y - 12);
      n.text.textContent = formatValue(v, { ...this.settings.valueFormat, decimals: 0 });
    });
  }
}


/** Bar outline: flat left edge, leading (right) corners rounded by r. */
function barPath(x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, h / 2, w));
  if (rr === 0 || w <= 0) return `M${x},${y}h${w}v${h}h${-w}Z`;
  return `M${x},${y}h${w - rr}q${rr},0 ${rr},${rr}v${h - 2 * rr}q0,${rr} ${-rr},${rr}h${-(w - rr)}Z`;
}
