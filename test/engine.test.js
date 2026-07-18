import { describe, expect, test } from "bun:test";
import { precompute, frameState, niceTicks, formatValue, formatPeriod, Playback, EASINGS } from "../src/engine.js";

function ds(periods, entities, grid) {
  // grid: rows = periods, cols = entities; null = absent
  const values = new Float64Array(periods.length * entities.length);
  grid.flat().forEach((v, i) => (values[i] = v == null ? NaN : v));
  return { periods, entities, values, meta: {} };
}

const SET = { topN: 2, easing: "linear", valueFormat: { notation: "compact", decimals: 1 } };

describe("precompute", () => {
  test("ranks by value desc, absent last", () => {
    const d = ds(["1", "2"], ["a", "b", "c"], [[5, 10, null], [10, 5, 20]]);
    const { ranks, maxima } = precompute(d);
    // period 0: b(10)=0, a(5)=1, c(absent)=2
    expect([ranks[0], ranks[1], ranks[2]]).toEqual([1, 0, 2]);
    // period 1: c(20)=0, a(10)=1, b(5)=2
    expect([ranks[3], ranks[4], ranks[5]]).toEqual([1, 2, 0]);
    expect(Array.from(maxima)).toEqual([10, 20]);
  });
  test("ties break by entity order, stable", () => {
    const d = ds(["1"], ["a", "b"], [[5, 5]]);
    const { ranks } = precompute(d);
    expect([ranks[0], ranks[1]]).toEqual([0, 1]);
  });
});

describe("frameState", () => {
  const d = ds(["1", "2"], ["a", "b", "c"], [[100, 50, 10], [50, 100, 10]]);
  const pre = precompute(d);

  test("at integer t, values and ranks are exact", () => {
    const s = frameState(d, pre, SET, 0);
    const a = s.bars.find((b) => b.entity === "a");
    expect(a.value).toBe(100);
    expect(a.rank).toBe(0);
    expect(s.axisMax).toBe(100);
    expect(s.periodLabel).toBe("1");
  });

  test("at t=0.5, values and ranks interpolate halfway (linear easing)", () => {
    const s = frameState(d, pre, SET, 0.5);
    const a = s.bars.find((b) => b.entity === "a");
    const b = s.bars.find((b) => b.entity === "b");
    expect(a.value).toBe(75);
    expect(a.rank).toBe(0.5);
    expect(b.rank).toBe(0.5); // crossing exactly at the midpoint
  });

  test("entities outside topN clamp to the offscreen slot with zero opacity", () => {
    const s = frameState(d, pre, SET, 0);
    expect(s.bars.find((b) => b.entity === "c")).toBeUndefined(); // rank 2 = slot topN, opacity 0
  });

  test("entering entity fades in", () => {
    const d2 = ds(["1", "2"], ["a", "b", "c"], [[100, 50, null], [100, 50, 200]]);
    const pre2 = precompute(d2);
    // c enters from offscreen slot (rank 2) toward rank 0. At t=0.25 its
    // fractional rank is 1.5 → opacity 0.5, still mid-fade.
    const s = frameState(d2, pre2, SET, 0.25);
    const c = s.bars.find((b) => b.entity === "c");
    expect(c).toBeDefined();
    expect(c.opacity).toBeCloseTo(0.5);
    expect(c.value).toBe(50); // lerp 0 → 200 at 0.25
  });

  test("t clamps to bounds", () => {
    expect(frameState(d, pre, SET, -5).periodLabel).toBe("1");
    expect(frameState(d, pre, SET, 99).periodLabel).toBe("2");
  });

  test("total sums all entities", () => {
    const s = frameState(d, pre, SET, 0);
    expect(s.total).toBe(160);
  });
});

describe("axis scale modes", () => {
  const d = ds(["1", "2"], ["a", "b"], [[100, 50], [400, 50]]);
  const pre = precompute(d);
  test("dynamic axis lerps between period maxima", () => {
    const set = { ...SET, axisScale: "dynamic" };
    expect(frameState(d, pre, set, 0).axisMax).toBe(100);
    expect(frameState(d, pre, set, 0.5).axisMax).toBe(250);
    expect(frameState(d, pre, set, 1).axisMax).toBe(400);
  });
  test("fixed axis holds the global maximum at every t", () => {
    const set = { ...SET, axisScale: "fixed" };
    expect(pre.globalMax).toBe(400);
    for (const t of [0, 0.3, 0.7, 1]) expect(frameState(d, pre, set, t).axisMax).toBe(400);
  });
});

describe("niceTicks", () => {
  test("1/2/5 ladder", () => {
    expect(niceTicks(10, 5)).toEqual([0, 2, 4, 6, 8, 10]);
    expect(niceTicks(97, 5)).toEqual([0, 20, 40, 60, 80]);
  });
  test("zero max is empty", () => expect(niceTicks(0)).toEqual([]));
});

describe("formatValue", () => {
  test("compact keeps fixed decimals on scaled units", () => {
    expect(formatValue(1_411_000_000, { notation: "compact", decimals: 1 })).toBe("1.4B");
    expect(formatValue(45_000_000, { notation: "compact", decimals: 1 })).toBe("45.0M");
    expect(formatValue(2_500, { notation: "compact", decimals: 1 })).toBe("2.5K");
  });
  test("equal decimals means equal precision (the 1.40B vs 1.41B regression)", () => {
    expect(formatValue(1_396_000_000, { notation: "compact", decimals: 2 })).toBe("1.40B");
    expect(formatValue(1_411_000_000, { notation: "compact", decimals: 2 })).toBe("1.41B");
  });
  test("unitless values trim trailing zeros", () => {
    expect(formatValue(950, { notation: "compact", decimals: 1 })).toBe("950");
    expect(formatValue(950.5, { notation: "compact", decimals: 1 })).toBe("950.5");
  });
  test("full", () => {
    expect(formatValue(1_411_000_000, { notation: "full" })).toBe("1,411,000,000");
  });
  test("prefix/suffix", () => {
    expect(formatValue(3_200_000, { notation: "compact", decimals: 1, prefix: "R", suffix: " pa" })).toBe("R3.2M pa");
  });
});

describe("formatPeriod", () => {
  test("year extraction", () => expect(formatPeriod("1987-06", "year")).toBe("1987"));
  test("month-year", () => expect(formatPeriod("2020-03", "month-year")).toBe("Mar 2020"));
  test("raw passthrough", () => expect(formatPeriod("Q1 FY24", "raw")).toBe("Q1 FY24"));
});

describe("Playback clock", () => {
  function fakeClock() {
    let t = 0;
    const queue = [];
    return {
      now: () => t,
      raf: (cb) => queue.push(cb),
      tick(ms) {
        t += ms;
        const cbs = queue.splice(0);
        for (const cb of cbs) cb();
      },
    };
  }

  test("advances t by dt/msPerPeriod and stops at the end", () => {
    const clock = fakeClock();
    const frames = [];
    const pb = new Playback({
      length: 3,
      msPerPeriod: 100,
      onFrame: (t) => frames.push(t),
      raf: clock.raf,
      now: clock.now,
    });
    pb.play();
    clock.tick(50); // t = 0.5
    expect(frames.at(-1)).toBeCloseTo(0.5);
    clock.tick(100); // t = 1.5
    expect(frames.at(-1)).toBeCloseTo(1.5);
    clock.tick(500); // past the end → clamp, stop
    expect(frames.at(-1)).toBe(2);
    expect(pb.playing).toBe(false);
  });

  test("loop wraps to start", () => {
    const clock = fakeClock();
    const pb = new Playback({ length: 2, msPerPeriod: 100, onFrame: () => {}, raf: clock.raf, now: clock.now });
    pb.loop = true;
    pb.play();
    clock.tick(150);
    expect(pb.t).toBe(0);
    expect(pb.playing).toBe(true);
  });

  test("speed multiplier", () => {
    const clock = fakeClock();
    const pb = new Playback({ length: 5, msPerPeriod: 100, onFrame: () => {}, raf: clock.raf, now: clock.now });
    pb.speed = 2;
    pb.play();
    clock.tick(100);
    expect(pb.t).toBeCloseTo(2);
  });

  test("seek clamps and step pauses", () => {
    const clock = fakeClock();
    const pb = new Playback({ length: 4, msPerPeriod: 100, onFrame: () => {}, raf: clock.raf, now: clock.now });
    pb.seek(99);
    expect(pb.t).toBe(3);
    pb.seek(2);
    pb.play();
    pb.step(-1);
    expect(pb.playing).toBe(false);
    expect(pb.t).toBe(1);
  });
});

describe("easings", () => {
  test("all map 0→0 and 1→1", () => {
    for (const fn of Object.values(EASINGS)) {
      expect(fn(0)).toBeCloseTo(0);
      expect(fn(1)).toBeCloseTo(1);
    }
  });
});


describe("playback holds", () => {
  function fakeClock() {
    let t = 0;
    const queue = [];
    return {
      now: () => t,
      raf: (cb) => queue.push(cb),
      step(ms) {
        t += ms;
        const cbs = queue.splice(0);
        for (const cb of cbs) cb();
      },
    };
  }

  test("holdAtPeriod lands exactly on the period and lingers", () => {
    const clock = fakeClock();
    const frames = [];
    const pb = new Playback({
      length: 4,
      msPerPeriod: 100,
      onFrame: (t) => frames.push(t),
      holdAtPeriod: (p) => (p === 1 ? 500 : 0),
      raf: clock.raf,
      now: clock.now,
    });
    pb.play();
    clock.step(130); // crosses into period 1 → snaps to 1.0, holds
    expect(pb.t).toBe(1);
    clock.step(200); // inside the hold: no advance
    expect(pb.t).toBe(1);
    clock.step(400); // hold expires (500ms total elapsed since snap)
    clock.step(50);
    expect(pb.t).toBeGreaterThan(1);
  });

  test("no hold configured → playback flows straight through", () => {
    const clock = fakeClock();
    const pb = new Playback({ length: 4, msPerPeriod: 100, onFrame: () => {}, raf: clock.raf, now: clock.now });
    pb.play();
    clock.step(150);
    expect(pb.t).toBeCloseTo(1.5, 5);
  });

  test("holdAtPeriod reads live state, not a snapshot from construction time (regression)", () => {
    const clock = fakeClock();
    // Mimics app.js: events live on a mutable object the callback reads each call.
    const liveEvents = [];
    const pb = new Playback({
      length: 4,
      msPerPeriod: 100,
      onFrame: () => {},
      holdAtPeriod: (p) => (liveEvents.some((e) => e.period === p) ? 500 : 0),
      raf: clock.raf,
      now: clock.now,
    });
    // Event added AFTER the Playback was constructed — the real-world bug case.
    liveEvents.push({ period: 1 });
    pb.play();
    clock.step(130);
    expect(pb.t).toBe(1); // held, because holdAtPeriod re-reads liveEvents live
  });

  test("seek resets hold tracking", () => {
    const clock = fakeClock();
    const pb = new Playback({
      length: 5,
      msPerPeriod: 100,
      onFrame: () => {},
      holdAtPeriod: () => 1000,
      raf: clock.raf,
      now: clock.now,
    });
    pb.play();
    clock.step(120);
    expect(pb.t).toBe(1); // holding
    pb.seek(3.5);
    expect(pb.t).toBe(3.5);
    clock.step(30);
    expect(pb.t).toBeGreaterThan(3.5); // hold cleared by seek
  });
});
