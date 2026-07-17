import { describe, expect, test } from "bun:test";
import { makeProject, hydrateDataset, encodeProject, decodeProject, readHash, supported, REFUSE_BYTES } from "../src/share.js";
import { parseCSV, detectShape, normalize } from "../src/parse.js";
import { sampleCSV } from "../src/builtins.js";
import { LAYOUTS, THEMES, DEFAULT_SETTINGS, DEFAULT_BRANDING } from "../src/builtins.js";

function sampleProject() {
  const { headers, rows } = parseCSV(sampleCSV());
  const shapeInfo = detectShape(headers, rows);
  const dataset = normalize(headers, rows, shapeInfo);
  return makeProject({
    name: "World population",
    dataset,
    mapping: shapeInfo,
    layout: LAYOUTS[0],
    settings: DEFAULT_SETTINGS,
    theme: THEMES[0],
    branding: DEFAULT_BRANDING,
  });
}

describe("share codec", () => {
  test("environment supports CompressionStream", () => {
    expect(supported()).toBe(true);
  });

  test("round-trip preserves the project exactly, including NaN cells", async () => {
    const project = sampleProject();
    // punch a hole to verify NaN survives as null → NaN
    project.dataset.values[3] = null;
    const { blob } = await encodeProject(project);
    const back = await decodeProject(blob);
    expect(back).toEqual(project);
    const ds = hydrateDataset(back.dataset);
    expect(Number.isNaN(ds.values[3])).toBe(true);
    expect(ds.values).toBeInstanceOf(Float64Array);
  });

  test("blob is URL-safe", async () => {
    const { blob } = await encodeProject(sampleProject());
    expect(/^[A-Za-z0-9_-]+$/.test(blob)).toBe(true);
  });

  test("sample dataset compresses under 8 KB (v1 acceptance)", async () => {
    const { bytes } = await encodeProject(sampleProject());
    expect(bytes).toBeLessThan(8 * 1024);
  });

  test("oversized project is refused with code too-large", async () => {
    const project = sampleProject();
    // Incompressible payload: random entity names
    project.dataset.entities = Array.from({ length: 40000 }, () =>
      Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
    );
    let err;
    try {
      await encodeProject(project);
    } catch (e) {
      err = e;
    }
    expect(err?.code).toBe("too-large");
    expect(err.bytes).toBeGreaterThan(REFUSE_BYTES);
  });

  test("malformed blob throws, does not hang", async () => {
    await expect(decodeProject("definitely-not-gzip")).rejects.toThrow();
  });

  test("truncated blob throws", async () => {
    const { blob } = await encodeProject(sampleProject());
    await expect(decodeProject(blob.slice(0, Math.floor(blob.length / 2)))).rejects.toThrow();
  });

  test("optional raw CSV travels in the envelope and round-trips", async () => {
    const project = sampleProject();
    project.raw = { csv: "year,country,population\n1960,China,667000000" };
    const { blob } = await encodeProject(project);
    const back = await decodeProject(blob);
    expect(back.raw.csv).toBe(project.raw.csv);
  });

  test("absent raw stays absent (no undefined keys serialized)", async () => {
    const { blob } = await encodeProject(sampleProject());
    const back = await decodeProject(blob);
    expect("raw" in back).toBe(false);
  });

  test("readHash extracts the payload", () => {
    expect(readHash("#p=abc_DEF-123")).toBe("abc_DEF-123");
    expect(readHash("#other=1&p=xyz")).toBe("xyz");
    expect(readHash("#nothing")).toBe(null);
  });
});
