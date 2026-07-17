// frontrunner — migrate.js
// Project format migrations. v1 → v2: the old combined "template" splits into
// template (layout) + settings (behavior), and branding is introduced.
// Old share links, saved projects, and custom library items must all keep working.

export const FORMAT_VERSION = 4;

const BEHAVIOR_FIELDS = ["msPerPeriod", "easing", "valueFormat", "periodLabelFormat", "axisScale"];

/** Split a v1 combined template object into { template, settings } parts. */
export function splitLegacyTemplate(legacy) {
  const t = legacy && typeof legacy === "object" ? structuredClone(legacy) : {};
  const settings = {};
  for (const f of BEHAVIOR_FIELDS) {
    if (f in t) {
      settings[f] = t[f];
      delete t[f];
    }
  }
  return { template: t, settings };
}

/**
 * Migrate a project envelope of any known version to the current format.
 * Returns a new object; input is not mutated. Throws only on unrecognized
 * future versions.
 */
export function migrateProject(input) {
  const p = structuredClone(input);
  if (p.frontrunner === FORMAT_VERSION) return p;

  if (p.frontrunner === 1) {
    const { template, settings } = splitLegacyTemplate(p.template);
    p.template = template;
    p.settings = settings;
    p.branding = p.branding ?? {};
    p.frontrunner = 2;
    return migrateProject(p);
  }

  if (p.frontrunner === 2) {
    // v2 → v3: the combined template becomes a placeholder grid. Size knobs move to
    // settings; show.* flags become slot anchors matching v2's fixed positions.
    const t = p.template && typeof p.template === "object" ? p.template : {};
    const show = t.show ?? {};
    const bar = t.bar ?? {};
    p.settings = {
      ...(p.settings ?? {}),
      topN: t.topN,
      barThickness: bar.heightRatio,
    };
    p.template = {
      id: t.id,
      name: t.name,
      type: "bar-race",
      bar: {
        labelPosition: bar.labelPosition,
        showRank: show.rankNumbers ?? true,
        showValue: show.values ?? true,
      },
      slots: {
        title: (show.title ?? true) ? "top-left" : "off",
        logo: "top-right",
        clock: (show.periodLabel ?? true) ? "bottom-right" : "off",
        total: (show.totalCounter ?? false) ? "bottom-right" : "off",
        source: "bottom-left",
        axis: (show.axis ?? true) ? "top" : "off",
      },
    };
    p.frontrunner = 3;
    return migrateProject(p);
  }

  if (p.frontrunner === 3) {
    // v3 → v4: the concept formerly called "template" is renamed "layout".
    // Pure field rename; the shape is identical.
    p.layout = p.template;
    delete p.template;
    p.frontrunner = 4;
    return p;
  }

  const err = new Error(`Unknown project format version ${p.frontrunner} — this file may be from a newer frontrunner.`);
  err.code = "future-version";
  throw err;
}
