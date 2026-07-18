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

test("adding a second event does not lose the first (regression: premature validation drop)", async ({ page }) => {
  await page.goto(DIST);
  await page.getByText("Try the sample").click();
  await page.getByRole("button", { name: "Build race" }).click();
  await page.getByRole("button", { name: "Customize" }).click();

  await page.getByRole("button", { name: "+ Add event" }).click();
  const rows = page.locator(".panel__row--event");
  await rows.nth(0).locator("select").selectOption({ index: 1 });
  await rows.nth(0).locator("input").fill("First event");
  await rows.nth(0).locator("input").blur();

  await page.getByRole("button", { name: "+ Add event" }).click();
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0).locator("input")).toHaveValue("First event");
});

test("layout pane warns when two blocks share an anchor, clears when separated", async ({ page }) => {
  await page.goto(DIST);
  await page.getByText("Try the sample").click();
  await page.getByRole("button", { name: "Build race" }).click();
  await page.getByRole("button", { name: "Customize" }).click();
  await page.getByRole("tab", { name: "Layout" }).click();

  const warn = page.locator(".panel__warn");
  await expect(warn).toHaveCount(0);

  // Force Logo onto the same anchor as Title (top-left by default on Classic race).
  const selects = page.locator("#panel-layout select");
  await selects.nth(1).selectOption("top-left"); // Logo select, second row after Title
  await expect(warn).toBeVisible();
  await expect(warn).toContainText("stack");

  await selects.nth(1).selectOption("top-right");
  await expect(page.locator(".panel__warn")).toHaveCount(0);
});

test("mapping screen offers image URL entry when no image column exists, and it lands on the built race", async ({ page }) => {
  await page.goto(DIST);
  await page.getByRole("button", { name: "Paste CSV instead" }).click();
  await page.locator("#paste-input").fill("year,country,pop\n1990,Testland,10\n2000,Testland,20");
  await page.locator("#paste-input").press("Control+Enter");

  const imgSection = page.locator("#mapping-images");
  await expect(imgSection).toBeVisible();
  await imgSection.locator("input").first().fill("https://flagcdn.com/w160/xx.png");
  await imgSection.locator("input").first().blur();

  await page.getByRole("button", { name: "Build race" }).click();
  await page.getByRole("button", { name: "Customize" }).click();
  await page.getByRole("tab", { name: "Data" }).click();
  await page.getByText("Add image URLs per entity").click();
  await expect(page.locator("#panel-data input[value='https://flagcdn.com/w160/xx.png']")).toBeVisible();
});

test("landing page shows the hero, and a saved race opens on click (regression: perceived-dead list)", async ({ page }) => {
  await page.goto(DIST);
  await expect(page.locator(".hero__title")).toHaveText("frontrunner");
  await expect(page.locator(".hero__tagline")).toBeVisible();

  // Build and save a race so a "Continue a race" entry exists.
  await page.getByText("Try the sample").click();
  await page.getByRole("button", { name: "Build race" }).click();
  await expect(page.locator("#save-state")).toContainText("saved", { timeout: 3000 }); // autosave is debounced
  await page.getByRole("button", { name: "New" }).click();

  await expect(page.locator(".projects__title")).toHaveText("Continue a race");
  const firstRace = page.locator(".projects__open").first();
  await expect(firstRace).toBeVisible();
  await firstRace.click();
  await expect(page.locator("#screen-stage")).toHaveClass(/screen--active/);
});
