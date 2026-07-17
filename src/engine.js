// frontrunner — engine.js
// Pure race math: rank precompute, interpolation, per-frame bar state, formatting.
// No DOM. The painter consumes frameState() output.

export const EASINGS = {
  linear: (p) => p,
  easeOutQuad: (p) => 1 - (1 - p) * (1 - p),
  easeInOutCubic: (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2),
};

/**
 * Precompute per-period ranks and maxima.
 * ranks[p*E+e] = 0-based rank of entity e in period p (absent entities rank last).
 */
export function precompute(dataset) {
  const { periods, entities, values } = dataset;
  const P = periods.length;
  const E = entities.length;
  const ranks = new Int32Array(P * E);
  const maxima = new Float64Array(P);
  let globalMax = 0;
  const order = new Int32Array(E);
  for (let p = 0; p < P; p++) {
    for (let e = 0; e < E; e++) order[e] = e;
    const base = p * E;
    // sort by value desc; NaN (absent) last; ties by entity index for stability
    const arr = Array.from(order).sort((a, b) => {
      const va = values[base + a];
      const vb = values[base + b];
      const aa = Number.isNaN(va) ? -Infinity : va;
      const bb = Number.isNaN(vb) ? -Infinity : vb;
      return bb - aa || a - b;
    });
    let max = 0;
    for (let r = 0; r < E; r++) {
      ranks[base + arr[r]] = r;
      const v = values[base + arr[r]];
      if (!Number.isNaN(v) && v > max) max = v;
    }
    maxima[p] = max;
    if (max > globalMax) globalMax = max;
  }
  return { ranks, maxima, globalMax };
}

const lerp = (a, b, t) => a + (b - a) * t;

/**
 * Compute the visual state of every visible bar at continuous timeline position t.
 * t ∈ [0, P-1]. Field size and motion come from settings (topN, easing);
 * template is not consulted here — placeholder layout is the painter's job.
 * Returns { bars, axisMax, periodLabel, total, t }.
 * Each bar: { entity, index, value, rank (fractional), opacity }.
 */
export function frameState(dataset, pre, settings, t) {
  const { periods, entities, values } = dataset;
  const { ranks, maxima } = pre;
  const P = periods.length;
  const E = entities.length;
  const topN = Math.min(settings.topN, E);
  const ease = EASINGS[settings.easing] ?? EASINGS.easeInOutCubic;

  const tc = Math.max(0, Math.min(P - 1, t));
  const i = P > 1 ? Math.min(Math.floor(tc), P - 2) : 0;
  const j = P > 1 ? i + 1 : 0;
  const q = P > 1 ? ease(tc - i) : 0;

  const bi = i * E;
  const bj = j * E;
  const clampR = (r) => Math.min(r, topN); // slot topN = just offscreen

  const bars = [];
  let total = 0;
  for (let e = 0; e < E; e++) {
    const v0 = Number.isNaN(values[bi + e]) ? 0 : values[bi + e];
    const v1 = Number.isNaN(values[bj + e]) ? 0 : values[bj + e];
    const v = lerp(v0, v1, q);
    total += v;
    const r = lerp(clampR(ranks[bi + e]), clampR(ranks[bj + e]), q);
    const opacity = Math.max(0, Math.min(1, topN - r));
    if (opacity <= 0) continue;
    bars.push({ entity: entities[e], index: e, value: v, rank: r, opacity });
  }

  const axisMax =
    settings.axisScale === "fixed"
      ? Math.max(1e-9, pre.globalMax)
      : Math.max(1e-9, lerp(maxima[i], maxima[j], q));
  const periodLabel = periods[Math.round(tc)];
  return { bars, axisMax, periodLabel, total, t: tc };
}

/** Nice tick step from a 1/2/5 ladder for a given max and target count. */
export function niceTicks(max, target = 5) {
  if (!(max > 0)) return [];
  const raw = max / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const ticks = [];
  for (let v = 0; v <= max + 1e-9; v += step) ticks.push(v);
  return ticks;
}

/** Format a value per settings.valueFormat. */
export function formatValue(v, fmt = {}) {
  const { notation = "compact", decimals = 1, prefix = "", suffix = "" } = fmt;
  let body;
  if (notation === "compact") {
    const abs = Math.abs(v);
    const unit =
      abs >= 1e12 ? [1e12, "T"] : abs >= 1e9 ? [1e9, "B"] : abs >= 1e6 ? [1e6, "M"] : abs >= 1e3 ? [1e3, "K"] : [1, ""];
    // Scaled units keep exactly `decimals` places so tabular values don't
    // jitter in width or precision (1.40B stays 1.40B, not 1.4B). Unitless
    // values trim: whole numbers read as "950", not "950.0".
    const scaled = (v / unit[0]).toFixed(decimals);
    body = (unit[1] ? scaled : trimZeros(scaled)) + unit[1];
  } else {
    body = Math.round(v).toLocaleString("en-US");
  }
  return prefix + body + suffix;
}

function trimZeros(s) {
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
}

/** Format the big period label. */
export function formatPeriod(p, mode = "raw") {
  if (mode === "year") {
    const m = String(p).match(/\d{4}/);
    return m ? m[0] : String(p);
  }
  if (mode === "month-year") {
    const m = String(p).match(/^(\d{4})-(\d{2})/);
    if (m) {
      const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      return `${months[Number(m[2]) - 1]} ${m[1]}`;
    }
  }
  return String(p);
}

/** Stable palette color per entity: first-appearance order, cycling. */
export function entityColor(index, palette) {
  return palette[index % palette.length];
}

/**
 * Playback clock. Owns rAF; calls onFrame(t) each frame.
 * Keeps t continuous in [0, P-1]; supports speed multiplier and loop.
 */
export class Playback {
  constructor({ length, msPerPeriod, onFrame, onStateChange, holdAtPeriod, raf, now }) {
    this.length = length; // number of periods
    this.msPerPeriod = msPerPeriod;
    this.onFrame = onFrame;
    this.onStateChange = onStateChange ?? (() => {});
    // holdAtPeriod(periodIndex) → ms to linger when playback crosses INTO
    // that period (endPeriodPause, event pauses). 0/undefined = no hold.
    this.holdAtPeriod = holdAtPeriod ?? null;
    this.raf = raf ?? ((cb) => requestAnimationFrame(cb));
    this.now = now ?? (() => performance.now());
    this.t = 0;
    this.speed = 1;
    this.loop = false;
    this.playing = false;
    this._last = 0;
    this._holdUntil = 0;
    this._lastFloor = 0;
    this._tick = this._tick.bind(this);
  }
  play() {
    if (this.playing || this.length < 2) return;
    if (this.t >= this.length - 1) this.t = 0; // replay from start
    this.playing = true;
    this._last = this.now();
    this._holdUntil = 0;
    this._lastFloor = Math.floor(this.t);
    this.onStateChange();
    this.raf(this._tick);
  }
  pause() {
    if (!this.playing) return;
    this.playing = false;
    this.onStateChange();
  }
  toggle() {
    this.playing ? this.pause() : this.play();
  }
  seek(t) {
    this.t = Math.max(0, Math.min(this.length - 1, t));
    this._holdUntil = 0;
    this._lastFloor = Math.floor(this.t);
    this.onFrame(this.t);
  }
  step(dir) {
    this.pause();
    this.seek(Math.round(this.t) + dir);
  }
  _tick() {
    if (!this.playing) return;
    const now = this.now();
    const dt = now - this._last;
    this._last = now;
    if (this._holdUntil) {
      if (now < this._holdUntil) {
        this.onFrame(this.t);
        this.raf(this._tick);
        return;
      }
      this._holdUntil = 0;
    }
    this.t += (dt / this.msPerPeriod) * this.speed;
    const f = Math.floor(this.t);
    if (f > this._lastFloor && f < this.length - 1) {
      this._lastFloor = f;
      const holdMs = this.holdAtPeriod?.(f) ?? 0;
      if (holdMs > 0) {
        this.t = f; // land exactly on the period, then linger
        this._holdUntil = now + holdMs;
        this.onFrame(this.t);
        if (this.playing) this.raf(this._tick);
        return;
      }
    } else if (f > this._lastFloor) {
      this._lastFloor = f;
    }
    if (this.t >= this.length - 1) {
      if (this.loop) {
        this.t = 0;
      } else {
        this.t = this.length - 1;
        this.playing = false;
        this.onStateChange();
      }
    }
    this.onFrame(this.t);
    if (this.playing) this.raf(this._tick);
  }
}
