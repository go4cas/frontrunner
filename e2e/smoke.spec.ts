// Real-browser smoke: the layer that catches what no DOM shim can —
// CSS cascade bugs (the [hidden] incident), click wiring, actual rendering.
import { test, expect } from "@playwright/test";
import { VERSION } from "../src/version.js";

const DIST = new URL("../dist/index.html", import.meta.url).href;

test("sample race renders, panel toggles, version chip matches build", async ({ page }) => {
  await page.goto(DIST);

  // Version chip = the build we think we're testing
  await expect(page.locator("#app-version")).toHaveText("v" + VERSION);

  // Sample → mapping (image column auto-detected) → race
  await page.getByText("Try the sample").click();
  await expect(page.locator("#screen-mapping")).toBeVisible();
  await page.getByRole("button", { name: "Build race" }).click();

  // ≥10 bars actually painted with path geometry
  await expect
    .poll(async () =>
      page.evaluate(() =>
        [...document.querySelectorAll("g.fr-bar")].filter(
          (g) => (g as HTMLElement).style.display !== "none" && g.querySelector(".fr-barshape")?.getAttribute("d")?.startsWith("M")
        ).length
      )
    )
    .toBeGreaterThanOrEqual(10);

  // The [hidden]-vs-cascade regression: panel must genuinely toggle
  const panel = page.locator("#panel");
  await expect(panel).toBeHidden();
  await page.getByRole("button", { name: "Customize" }).click();
  await expect(panel).toBeVisible();
  await page.getByRole("button", { name: "Customize" }).click();
  await expect(panel).toBeHidden();

  // Transport is alive: play then pause without error
  await page.locator("#btn-play").click();
  await page.waitForTimeout(300);
  await page.locator("#btn-play").click();
});

test("export menu opens and offers both artifact types", async ({ page }) => {
  await page.goto(DIST);
  await page.getByText("Try the sample").click();
  await page.getByRole("button", { name: "Build race" }).click();
  await page.getByRole("button", { name: "Export" }).click();
  await expect(page.getByRole("button", { name: /Project file/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Standalone race/ })).toBeVisible();
});
