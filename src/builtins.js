// frontrunner — builtins.js
// Built-in templates (layout), default settings (behavior), themes (style),
// default branding (content), and the sample dataset.

// Layouts are placeholder grids: named blocks and the anchor each sits on.
// Anchors: top-left | top-center | top-right | bottom-left | bottom-center |
// bottom-right | off. Axis is special: top | off. The bar row composes via
// `bar`: label side, and whether rank numbers / values render on each bar.
export const ANCHORS = ["top-left", "top-center", "top-right", "bottom-left", "bottom-center", "bottom-right", "off"];

export const LAYOUTS = [
  {
    id: "classic",
    name: "Classic race",
    type: "bar-race",
    bar: { labelPosition: "outside", showRank: true, showValue: true, showImage: true, imagePosition: "inside" },
    slots: { title: "top-left", logo: "top-right", clock: "bottom-right", total: "off", source: "bottom-left", axis: "top" },
  },
  {
    id: "dense",
    name: "Dense field",
    type: "bar-race",
    bar: { labelPosition: "inside", showRank: true, showValue: true, showImage: true, imagePosition: "inside" },
    slots: { title: "top-left", logo: "top-right", clock: "bottom-right", total: "bottom-right", source: "bottom-left", axis: "off" },
  },
  {
    id: "broadcast",
    name: "Broadcast",
    type: "bar-race",
    bar: { labelPosition: "outside", showRank: false, showValue: true, showImage: true, imagePosition: "inside" },
    slots: { title: "top-center", logo: "off", clock: "bottom-center", total: "off", source: "bottom-left", axis: "off" },
  },
];

// Settings are configuration and behavior: field size, motion, readout.
// Per-project, not a library.
export const DEFAULT_SETTINGS = {
  topN: 10,
  barThickness: 0.72,
  msPerPeriod: 1400,
  easing: "easeInOutCubic",
  valueFormat: { notation: "compact", decimals: 1, prefix: "", suffix: "" },
  periodLabelFormat: "raw",
  axisScale: "dynamic",
};

// Branding is content: rendered by the painter where the template allows.
export const DEFAULT_BRANDING = {
  title: "",
  subtitle: "",
  source: "",
  link: "",
  logoUrl: "",
};

const FONT_DISPLAY = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const FONT_MONO = "ui-monospace, 'SF Mono', 'Cascadia Mono', 'Roboto Mono', Menlo, monospace";

export const THEMES = [
  {
    id: "graphite",
    name: "Graphite",
    vars: {
      "--fr-bg": "#141518",
      "--fr-surface": "#1c1d21",
      "--fr-surface-2": "#232428",
      "--fr-border": "#2b2c31",
      "--fr-text": "#ececee",
      "--fr-text-muted": "#8f9096",
      "--fr-accent": "#4fb8ad",
      "--fr-axis": "#2b2c31",
      "--fr-bar-label": "#ececee",
      "--fr-bar-label-inside": "#101114",
      "--fr-bar-stroke": "none",
      "--fr-bar-stroke-width": "0",
      "--fr-bar-shadow": "none",
      "--fr-font-display": FONT_DISPLAY,
      "--fr-font-mono": FONT_MONO,
      "--fr-bar-radius": "pill",
      "--fr-period-label-size": "72",
    },
    palette: ["#4fb8ad", "#e8836f", "#c9b458", "#7d8ca3", "#a37d9c", "#6fae8f", "#d98cb3", "#8f7ee6", "#5e9ec7", "#c78f5e"],
  },
  {
    id: "paper",
    name: "Paper",
    vars: {
      "--fr-bg": "#f7f6f3",
      "--fr-surface": "#ffffff",
      "--fr-surface-2": "#efede8",
      "--fr-border": "#e0ddd6",
      "--fr-text": "#26251f",
      "--fr-text-muted": "#7a786f",
      "--fr-accent": "#2e7f76",
      "--fr-axis": "#e0ddd6",
      "--fr-bar-label": "#26251f",
      "--fr-bar-label-inside": "#faf9f7",
      "--fr-bar-stroke": "none",
      "--fr-bar-stroke-width": "0",
      "--fr-bar-shadow": "drop-shadow(0 1px 2px rgba(38, 37, 31, 0.12))",
      "--fr-font-display": FONT_DISPLAY,
      "--fr-font-mono": FONT_MONO,
      "--fr-bar-radius": "pill",
      "--fr-period-label-size": "72",
    },
    palette: ["#2e7f76", "#c65a41", "#a98d2c", "#5a6b85", "#8a5f80", "#4d8a68", "#b8628f", "#6a5bbf", "#3f7ea6", "#a06e3b"],
  },
  {
    id: "signal",
    name: "Signal",
    vars: {
      "--fr-bg": "#0d0e12",
      "--fr-surface": "#15161c",
      "--fr-surface-2": "#1c1e26",
      "--fr-border": "#262833",
      "--fr-text": "#f2f3f7",
      "--fr-text-muted": "#7e8291",
      "--fr-accent": "#31d0c2",
      "--fr-axis": "#262833",
      "--fr-bar-label": "#f2f3f7",
      "--fr-bar-label-inside": "#0d0e12",
      "--fr-bar-stroke": "none",
      "--fr-bar-stroke-width": "0",
      "--fr-bar-shadow": "none",
      "--fr-font-display": FONT_DISPLAY,
      "--fr-font-mono": FONT_MONO,
      "--fr-bar-radius": "0",
      "--fr-period-label-size": "84",
    },
    palette: ["#31d0c2", "#ff7a59", "#ffd23f", "#7aa2ff", "#e07aff", "#5ee08a", "#ff86b3", "#a68bff", "#59c2ff", "#ffab59"],
  },
];

// Sample: world population by country, 1960–2020 by decade (approximate, millions × 1e6).
// Flag URLs demo the image-column auto-detection; offline they degrade silently.
const FLAGS = {
  China: "cn", India: "in", "United States": "us", Indonesia: "id", Pakistan: "pk",
  Brazil: "br", Nigeria: "ng", Bangladesh: "bd", Russia: "ru", Japan: "jp",
  Mexico: "mx", Germany: "de", Philippines: "ph", Ethiopia: "et",
};

const SAMPLE = {
  periods: [1960, 1970, 1980, 1990, 2000, 2010, 2020],
  rows: {
    China: [667, 818, 981, 1135, 1263, 1338, 1411],
    India: [451, 555, 697, 873, 1057, 1234, 1396],
    "United States": [181, 205, 227, 250, 282, 309, 332],
    Indonesia: [88, 115, 147, 181, 214, 242, 272],
    Pakistan: [45, 59, 79, 108, 142, 179, 221],
    Brazil: [72, 95, 121, 149, 175, 196, 213],
    Nigeria: [45, 56, 74, 95, 122, 158, 206],
    Bangladesh: [48, 64, 80, 103, 128, 148, 165],
    Russia: [120, 130, 139, 148, 147, 143, 144],
    Japan: [93, 104, 117, 124, 127, 128, 126],
    Mexico: [38, 51, 68, 84, 99, 114, 126],
    Germany: [73, 78, 78, 79, 82, 81, 83],
    Philippines: [26, 36, 48, 62, 78, 94, 110],
    Ethiopia: [22, 28, 35, 48, 66, 89, 117],
  },
};

export function sampleCSV() {
  const lines = ["year,country,population,flag"];
  for (const [country, vals] of Object.entries(SAMPLE.rows)) {
    const flag = `https://flagcdn.com/w160/${FLAGS[country]}.png`;
    SAMPLE.periods.forEach((year, i) => {
      const name = country.includes(",") ? `"${country}"` : country;
      lines.push(`${year},${name},${vals[i] * 1_000_000},${flag}`);
    });
  }
  return lines.join("\n");
}

export const SAMPLE_NAME = "World population, 1960–2020";
