// frontrunner — share.js
// Project envelope + share-link codec: JSON → gzip (CompressionStream) → base64url.
// Works in browsers, Bun, and Node 22+ (all expose CompressionStream + btoa/atob... almost).

export const WARN_BYTES = 16 * 1024;
export const REFUSE_BYTES = 50 * 1024;

export function supported() {
  return typeof CompressionStream !== "undefined" && typeof DecompressionStream !== "undefined";
}

/** Build a self-contained project envelope (format v4). Dataset values serialize as a plain array. */
export function makeProject({ name, dataset, mapping, layout, settings, theme, branding, raw }) {
  return {
    frontrunner: 4,
    name,
    created: new Date().toISOString(),
    dataset: {
      periods: dataset.periods,
      entities: dataset.entities,
      values: Array.from(dataset.values, (v) => (Number.isNaN(v) ? null : v)),
      ...(dataset.images && Object.keys(dataset.images).length ? { images: dataset.images } : {}),
      ...(dataset.categories && Object.keys(dataset.categories).length ? { categories: dataset.categories } : {}),
      meta: dataset.meta,
    },
    mapping,
    layout,
    settings,
    theme,
    branding,
    raw, // optional { csv } — original text, enables re-mapping after reopen
  };
}

/** Rehydrate a project envelope into a runtime dataset (Float64Array, NaN for null). */
export function hydrateDataset(projDataset) {
  const values = new Float64Array(projDataset.values.length);
  for (let i = 0; i < values.length; i++) {
    const v = projDataset.values[i];
    values[i] = v == null ? NaN : v;
  }
  return {
    periods: projDataset.periods,
    entities: projDataset.entities,
    values,
    images: projDataset.images ?? {},
    categories: projDataset.categories ?? {},
    meta: projDataset.meta ?? {},
  };
}

async function streamBytes(bytes, stream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

function toBase64Url(bytes) {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s) {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * Encode a project for the URL hash.
 * Returns { blob, bytes } or throws { code: "too-large", bytes } past REFUSE_BYTES.
 */
export async function encodeProject(project) {
  const json = JSON.stringify(project);
  const gz = await streamBytes(new TextEncoder().encode(json), new CompressionStream("gzip"));
  if (gz.length > REFUSE_BYTES) {
    const err = new Error("Project too large for a share link.");
    err.code = "too-large";
    err.bytes = gz.length;
    throw err;
  }
  return { blob: toBase64Url(gz), bytes: gz.length };
}

/** Decode a URL-hash blob back into a project envelope. Throws on malformed input. */
export async function decodeProject(blob) {
  const gz = fromBase64Url(blob);
  const bytes = await streamBytes(gz, new DecompressionStream("gzip"));
  const project = JSON.parse(new TextDecoder().decode(bytes));
  if (!project || typeof project.frontrunner !== "number") {
    throw new Error("Not a frontrunner project.");
  }
  return project; // version migration happens in migrate.js, not here
}

export function shareUrl(blob, base) {
  const b = base ?? (typeof location !== "undefined" ? location.origin + location.pathname : "");
  return `${b}#p=${blob}`;
}

export function readHash(hash) {
  const m = /[#&]p=([A-Za-z0-9_-]+)/.exec(hash ?? (typeof location !== "undefined" ? location.hash : ""));
  return m ? m[1] : null;
}
