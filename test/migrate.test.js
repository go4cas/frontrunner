import { describe, expect, test } from "bun:test";
import { migrateProject, splitLegacyTemplate, FORMAT_VERSION } from "../src/migrate.js";
import { validateLayout, validateSettings } from "../src/editors.js";
import { encodeProject, decodeProject } from "../src/share.js";

// A realistic v1 envelope, exactly as round-1 frontrunner produced it.
const V1_PROJECT = {
  frontrunner: 1,
  name: "Legacy race",
  created: "2026-07-16T09:00:00Z",
  dataset: { periods: ["1", "2"], entities: ["a"], values: [1, 2], meta: { shape: "long" } },
  mapping: { shape: "long", mapping: { time: "t", entity: "e", value: "v" } },
  template: {
    id: "classic",
    name: "Classic race",
    type: "bar-race",
    topN: 10,
    msPerPeriod: 800,
    easing: "easeOutQuad",
    bar: { heightRatio: 0.72, labelPosition: "outside" },
    show: { rankNumbers: true, values: true, periodLabel: true, totalCounter: false, axis: true, title: true },
    valueFormat: { notation: "compact", decimals: 2, prefix: "$", suffix: "" },
    periodLabelFormat: "year",
    axisScale: "dynamic",
  },
  theme: { id: "graphite", name: "Graphite", vars: { "--fr-accent": "#4fb8ad" }, palette: ["#4fb8ad"] },
};

describe("splitLegacyTemplate", () => {
  test("behavior fields move to settings, layout stays", () => {
    const { template, settings } = splitLegacyTemplate(V1_PROJECT.template);
    expect(settings.msPerPeriod).toBe(800);
    expect(settings.easing).toBe("easeOutQuad");
    expect(settings.valueFormat.prefix).toBe("$");
    expect(settings.periodLabelFormat).toBe("year");
    expect("msPerPeriod" in template).toBe(false);
    expect("valueFormat" in template).toBe(false);
    expect(template.topN).toBe(10);
    expect(template.bar.labelPosition).toBe("outside");
  });
});

describe("migrateProject", () => {
  test("v1 chains to current version preserving every user choice", () => {
    const p = migrateProject(V1_PROJECT);
    expect(p.frontrunner).toBe(FORMAT_VERSION);
    expect(p.settings.msPerPeriod).toBe(800);
    expect(p.settings.valueFormat.decimals).toBe(2);
    expect(p.settings.topN).toBe(10);
    expect(p.settings.barThickness).toBe(0.72);
    expect(p.layout.bar.labelPosition).toBe("outside");
    expect(p.layout.bar.showRank).toBe(true);
    // v1 show flags become v3 slot anchors
    expect(p.layout.slots.title).toBe("top-left");
    expect(p.layout.slots.clock).toBe("bottom-right");
    expect(p.layout.slots.total).toBe("off");
    expect(p.layout.slots.axis).toBe("top");
    expect(p.branding).toEqual({});
    expect(validateLayout(p.layout).errors).toEqual([]);
    expect(validateSettings(p.settings).errors).toEqual([]);
  });

  test("v1 with hidden blocks maps them to off", () => {
    const v1 = structuredClone(V1_PROJECT);
    v1.template.show.periodLabel = false;
    v1.template.show.title = false;
    const p = migrateProject(v1);
    expect(p.layout.slots.clock).toBe("off");
    expect(p.layout.slots.title).toBe("off");
  });

  test("does not mutate the input", () => {
    const before = JSON.stringify(V1_PROJECT);
    migrateProject(V1_PROJECT);
    expect(JSON.stringify(V1_PROJECT)).toBe(before);
  });

  test("v2 passes through untouched", () => {
    const v2 = migrateProject(V1_PROJECT);
    expect(migrateProject(v2)).toEqual(v2);
  });

  test("future versions throw a coded error", () => {
    let err;
    try {
      migrateProject({ frontrunner: 99 });
    } catch (e) {
      err = e;
    }
    expect(err?.code).toBe("future-version");
  });
});

describe("v1 share links still open", () => {
  test("encode a v1 envelope, decode, migrate — old links survive the schema change", async () => {
    // Simulate a share link created by round-1 frontrunner: the codec itself
    // is version-agnostic, so a v1 blob decodes fine and migration lifts it.
    const { blob } = await encodeProject(V1_PROJECT);
    const decoded = await decodeProject(blob);
    expect(decoded.frontrunner).toBe(1);
    const migrated = migrateProject(decoded);
    expect(migrated.frontrunner).toBe(FORMAT_VERSION);
    expect(migrated.settings.easing).toBe("easeOutQuad");
    expect(migrated.layout).toBeDefined();
    expect("template" in migrated).toBe(false);
  });
});
