// frontrunner — deploy.ts
// Publish dist/index.html to the claimed here.now site. Usage:
//   HERENOW_API_KEY=hn_... bun run deploy
// The key comes from your here.now account (https://here.now). Never commit it.

const SLUG = "centered-tangle-v266"; // update if you rename the site
const BASE = "https://here.now";

const key = process.env.HERENOW_API_KEY;
if (!key) {
  console.error("Set HERENOW_API_KEY (from your here.now account) and retry.");
  process.exit(1);
}

const file = Bun.file("dist/index.html");
if (!(await file.exists())) {
  console.error("dist/index.html not found — run `bun run build` first.");
  process.exit(1);
}
const bytes = new Uint8Array(await file.arrayBuffer());
const hashHex = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
  .map((b) => b.toString(16).padStart(2, "0"))
  .join("");

const headers = {
  authorization: `Bearer ${key}`,
  "x-herenow-client": "frontrunner/deploy-ts",
  "content-type": "application/json",
};

// 1. Create a new version on the existing slug
const create = await fetch(`${BASE}/api/v1/publish/${SLUG}`, {
  method: "PUT",
  headers,
  body: JSON.stringify({
    files: [{ path: "index.html", size: bytes.length, contentType: "text/html; charset=utf-8", hash: hashHex }],
    viewer: {
      title: "frontrunner — bar chart races from a CSV",
      description: "Drop in a CSV, get a bar chart race. Zero dependencies, runs entirely in your browser, shares as a link.",
    },
  }),
}).then((r) => r.json());

if (create.error) {
  console.error("create failed:", create.error, create.details ?? "");
  process.exit(1);
}

// 2. Upload changed files (unchanged hashes are skipped by the server)
for (const up of create.upload.uploads ?? []) {
  const res = await fetch(up.url, {
    method: "PUT",
    headers: { "Content-Type": up.headers?.["Content-Type"] ?? "text/html; charset=utf-8" },
    body: bytes,
  });
  if (!res.ok) {
    console.error(`upload failed for ${up.path}: HTTP ${res.status}`);
    process.exit(1);
  }
}

// 3. Finalize
const fin = await fetch(create.upload.finalizeUrl, {
  method: "POST",
  headers,
  body: JSON.stringify({ versionId: create.upload.versionId }),
}).then((r) => r.json());

if (fin.error) {
  console.error("finalize failed:", fin.error);
  process.exit(1);
}

const skipped = create.upload.skipped?.length ?? 0;
console.log(`deployed → ${create.siteUrl}${skipped ? ` (${skipped} unchanged file(s) skipped)` : ""}`);
