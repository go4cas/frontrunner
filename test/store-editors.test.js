import { describe, expect, test, beforeEach } from "bun:test";
import { validateLayout, validateSettings, validateEvents, validateBranding, validateTheme, parseUserJSON, isHexColor, toSixDigitHex } from "../src/editors.js";
import { DEFAULT_SETTINGS } from "../src/builtins.js";
import { LAYOUTS, THEMES } from "../src/builtins.js";

// localStorage shim for store tests (Bun has no DOM storage).
function makeStorageShim() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
    _map: map,
  };
}
globalThis.localStorage = makeStorageShim();

const store = await import("../src/store.js");

describe("validateLayout", () => {
  test("empty input becomes classic defaults", () => {
    const { layout, errors } = validateLayout({});
    expect(errors).toEqual([]);
    expect(layout.slots).toEqual(LAYOUTS[0].slots);
    expect(layout.bar.labelPosition).toBe(LAYOUTS[0].bar.labelPosition);
    expect(layout.type).toBe("bar-race");
  });
  test("invalid anchors fall back to classic slots", () => {
    const { layout } = validateLayout({ slots: { title: "middle-earth", clock: "bottom-center" } });
    expect(layout.slots.title).toBe(LAYOUTS[0].slots.title);
    expect(layout.slots.clock).toBe("bottom-center");
  });
  test("imagePosition validates and defaults to inside", () => {
    expect(validateLayout({}).layout.bar.imagePosition).toBe("inside");
    expect(validateLayout({ bar: { imagePosition: "overlap" } }).layout.bar.imagePosition).toBe("overlap");
    expect(validateLayout({ bar: { imagePosition: "orbiting" } }).layout.bar.imagePosition).toBe("inside");
  });
  test("showImage defaults on and survives round-trip", () => {
    expect(validateLayout({}).layout.bar.showImage).toBe(true);
    expect(validateLayout({ bar: { showImage: false } }).layout.bar.showImage).toBe(false);
  });
  test("rankDirection and valueScale validate with sane defaults", () => {
    expect(validateSettings({}).settings.rankDirection).toBe("top");
    expect(validateSettings({}).settings.valueScale).toBe("linear");
    expect(validateSettings({ rankDirection: "bottom" }).settings.rankDirection).toBe("bottom");
    expect(validateSettings({ valueScale: "log" }).settings.valueScale).toBe("log");
    expect(validateSettings({ rankDirection: "sideways" }).settings.rankDirection).toBe("top");
  });
  test("caption slot validates; settings pauses clamp", () => {
    expect(validateLayout({}).layout.slots.caption).toBe("bottom-center");
    expect(validateSettings({ endPeriodPause: 500, eventPause: 99999 }).settings.endPeriodPause).toBe(500);
    expect(validateSettings({ eventPause: 99999 }).settings.eventPause).toBe(10000);
    expect(validateSettings({}).settings.eventPause).toBe(1500);
  });
  test("validateEvents drops incomplete entries (why it must not run on every keystroke)", () => {
    // This is precisely the shape of an in-progress row: period picked,
    // text not yet typed. If an editor called validateEvents on every
    // change, this object would vanish before the person finished typing.
    expect(validateEvents([{ period: "1990", text: "" }]).events).toEqual([]);
  });
  test("validateEvents trims, caps, and drops empties", () => {
    const { events } = validateEvents([
      { period: 1990, text: "  Wall falls  " },
      { period: "", text: "orphan" },
      { period: 2000, text: "" },
      { period: 2010, text: "x".repeat(400) },
      null,
    ]);
    expect(events).toEqual([
      { period: "1990", text: "Wall falls" },
      { period: "2010", text: "x".repeat(200) },
    ]);
    expect(validateEvents(undefined).events).toEqual([]);
  });
  test("legend slot validates like the other placeholders", () => {
    expect(validateLayout({}).layout.slots.legend).toBe("top-center");
    expect(validateLayout({ slots: { legend: "bottom-left" } }).layout.slots.legend).toBe("bottom-left");
    expect(validateLayout({ slots: { legend: "everywhere" } }).layout.slots.legend).toBe("top-center");
  });
  test("axis only accepts top or off", () => {
    const { layout } = validateLayout({ slots: { axis: "bottom-left" } });
    expect(layout.slots.axis).toBe(LAYOUTS[0].slots.axis);
  });
  test("unknown type is an error but does not throw", () => {
    const { layout, errors } = validateLayout({ type: "pie-race" });
    expect(errors.length).toBe(1);
    expect(layout.type).toBe("bar-race");
  });
  test("unknown fields survive round-trip (forward compat)", () => {
    const { layout } = validateLayout({ futureFeature: { x: 1 } });
    expect(layout.futureFeature).toEqual({ x: 1 });
  });
});

describe("validateTheme", () => {
  test("missing vars fill from graphite", () => {
    const { theme } = validateTheme({ vars: { "--fr-accent": "#ff0000" }, palette: ["#111"] });
    expect(theme.vars["--fr-accent"]).toBe("#ff0000");
    expect(theme.vars["--fr-bg"]).toBe(THEMES[0].vars["--fr-bg"]);
  });
  test("empty palette errors and falls back", () => {
    const { theme, errors } = validateTheme({ palette: [] });
    expect(errors.length).toBe(1);
    expect(theme.palette).toEqual(THEMES[0].palette);
  });
  test("extra --fr- vars are preserved", () => {
    const { theme } = validateTheme({ vars: { "--fr-my-thing": "12px" }, palette: ["#123456"] });
    expect(theme.vars["--fr-my-thing"]).toBe("12px");
  });
});

describe("color helpers", () => {
  test("hex detection", () => {
    expect(isHexColor("#abc")).toBe(true);
    expect(isHexColor("#a1b2c3")).toBe(true);
    expect(isHexColor("tomato")).toBe(false);
  });
  test("3-digit expansion", () => {
    expect(toSixDigitHex("#abc")).toBe("#aabbcc");
    expect(toSixDigitHex("#a1b2c3")).toBe("#a1b2c3");
    expect(toSixDigitHex("#a1b2c3ff")).toBe("#a1b2c3");
  });
});

describe("parseUserJSON", () => {
  test("valid object", () => expect(parseUserJSON('{"a":1}').value).toEqual({ a: 1 }));
  test("arrays rejected", () => expect(parseUserJSON("[1,2]").error).toBeDefined());
  test("syntax errors reported", () => expect(parseUserJSON("{oops").error).toContain("Invalid JSON"));
});

describe("project store", () => {
  beforeEach(() => {
    globalThis.localStorage = makeStorageShim();
  });

  const project = (name) => ({ frontrunner: 1, name, dataset: { periods: [], entities: [], values: [] } });

  test("save, list, load round-trip", () => {
    const id = store.newId();
    expect(store.saveProjectAs(id, project("Race A")).ok).toBe(true);
    const list = store.listProjects();
    expect(list.length).toBe(1);
    expect(list[0].name).toBe("Race A");
    expect(store.loadProjectById(id).name).toBe("Race A");
  });

  test("saving again updates, not duplicates", () => {
    const id = store.newId();
    store.saveProjectAs(id, project("v1"));
    store.saveProjectAs(id, project("v2"));
    const list = store.listProjects();
    expect(list.length).toBe(1);
    expect(list[0].name).toBe("v2");
  });

  test("delete removes entry and index row", () => {
    const id = store.newId();
    store.saveProjectAs(id, project("bye"));
    store.deleteProject(id);
    expect(store.listProjects().length).toBe(0);
    expect(store.loadProjectById(id)).toBe(null);
  });

  test("duplicate creates an independent copy", () => {
    const id = store.newId();
    store.saveProjectAs(id, project("orig"));
    const copyId = store.duplicateProject(id);
    expect(copyId).not.toBe(id);
    expect(store.loadProjectById(copyId).name).toBe("orig copy");
    expect(store.listProjects().length).toBe(2);
  });

  test("legacy autosave migrates once", () => {
    localStorage.setItem("fr:autosave", JSON.stringify(project("old race")));
    store.migrateLegacy();
    expect(store.listProjects().length).toBe(1);
    expect(store.listProjects()[0].name).toBe("old race");
    expect(localStorage.getItem("fr:autosave")).toBe(null);
    store.migrateLegacy(); // idempotent
    expect(store.listProjects().length).toBe(1);
  });

  test("custom library save/list/delete", () => {
    store.saveCustom("themes", { id: "u-neon", name: "Neon" });
    expect(store.listCustom("themes").length).toBe(1);
    store.saveCustom("themes", { id: "u-neon", name: "Neon v2" }); // upsert
    expect(store.listCustom("themes").length).toBe(1);
    expect(store.listCustom("themes")[0].name).toBe("Neon v2");
    store.deleteCustom("themes", "u-neon");
    expect(store.listCustom("themes").length).toBe(0);
  });

  test("corrupt index degrades to empty, not a crash", () => {
    localStorage.setItem("fr:index", "{{{nope");
    expect(store.listProjects()).toEqual([]);
  });
});


describe("validateSettings", () => {
  test("defaults fill and clamp", () => {
    const { settings } = validateSettings({ msPerPeriod: 5, topN: 999, barThickness: 3, valueFormat: { decimals: "2" } });
    expect(settings.msPerPeriod).toBe(100);
    expect(settings.topN).toBe(50);
    expect(settings.barThickness).toBe(0.95);
    expect(settings.valueFormat.decimals).toBe(2);
    expect(settings.easing).toBe(DEFAULT_SETTINGS.easing);
  });
  test("unknown easing falls back", () => {
    const { settings } = validateSettings({ easing: "bounceInSpace" });
    expect(settings.easing).toBe(DEFAULT_SETTINGS.easing);
  });
});

describe("validateBranding", () => {
  test("trims and fills", () => {
    const { branding } = validateBranding({ title: "  Hello  ", bogus: "x" });
    expect(branding.title).toBe("Hello");
    expect(branding.subtitle).toBe("");
    expect("bogus" in branding).toBe(false);
  });
  test("caps runaway lengths", () => {
    const { branding } = validateBranding({ title: "x".repeat(500) });
    expect(branding.title.length).toBe(120);
  });
});
