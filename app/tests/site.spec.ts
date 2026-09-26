import { expect, test, type Page } from "@playwright/test";

const SITE = "http://127.0.0.1:4173/";
const release = {
  tag_name: "v0.1.0",
  assets: [
    { name: "Shortcut_0.1.0_universal.dmg", size: 9_000_000, browser_download_url: "https://dl.test/Shortcut_0.1.0_universal.dmg" },
    { name: "Shortcut_0.1.0_x64-setup.exe", size: 4_000_000, browser_download_url: "https://dl.test/Shortcut_0.1.0_x64-setup.exe" },
    { name: "Shortcut_0.1.0_x64_en-US.msi", size: 5_000_000, browser_download_url: "https://dl.test/Shortcut_0.1.0_x64_en-US.msi" },
    { name: "Shortcut_0.1.0_amd64.deb", size: 4_000_000, browser_download_url: "https://dl.test/Shortcut_0.1.0_amd64.deb" },
    { name: "Shortcut_0.1.0_amd64.AppImage", size: 80_000_000, browser_download_url: "https://dl.test/Shortcut_0.1.0_amd64.AppImage" },
  ],
};

const UA = {
  macos: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Safari/537.36",
  windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Safari/537.36",
  linux: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Safari/537.36",
};

async function open(page: Page, api: "ok" | "fail" = "ok") {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // Keep tests hermetic: no real network.
  await page.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ body: "", contentType: "text/css" }));
  await page.route("https://api.github.com/**", (r) => (api === "ok" ? r.fulfill({ json: release }) : r.fulfill({ status: 404, json: { message: "Not Found" } })));
  await page.goto(SITE);
  return errors;
}

test.describe("landing page", () => {
  for (const [os, ext, label] of [["macos", "dmg", "macOS"], ["windows", "setup.exe", "Windows"], ["linux", "deb", "Linux"]] as const) {
    test(`${label} visitors get a direct ${ext} download`, async ({ browser }) => {
      const ctx = await browser.newContext({ userAgent: UA[os] });
      const page = await ctx.newPage();
      const errors = await open(page);
      const primary = page.locator("a[data-primary-download]").first();
      await expect(primary).toHaveText(new RegExp(`Download for ${label}`));
      await expect(primary).toHaveAttribute("href", new RegExp(`${ext.replace(".", "\\.")}$`));
      await expect(page.locator(`.dl[data-os="${os}"]`)).toHaveClass(/detected/);
      await expect(page.locator("[data-version]")).toHaveText("· v0.1.0");
      expect(errors).toEqual([]);
      await ctx.close();
    });
  }

  test("every platform card links to its asset", async ({ page }) => {
    await open(page);
    await expect(page.locator('[data-asset="dmg"]')).toHaveAttribute("href", /universal\.dmg$/);
    await expect(page.locator('[data-asset="exe"]')).toHaveAttribute("href", /setup\.exe$/);
    await expect(page.locator('[data-asset="msi"]')).toHaveAttribute("href", /\.msi$/);
    await expect(page.locator('[data-asset="deb"]')).toHaveAttribute("href", /\.deb$/);
    await expect(page.locator('[data-asset="appimage"]')).toHaveAttribute("href", /\.AppImage$/);
  });

  test("falls back to the releases page when there is no release yet", async ({ page }) => {
    const errors = await open(page, "fail");
    await expect(page.locator('[data-asset="dmg"]')).toHaveAttribute("href", "https://github.com/Rachit315/Shortcut/releases/latest");
    await expect(page.locator("a[data-primary-download]").first()).toHaveAttribute("href", "#download");
    expect(errors).toEqual([]);
  });

  test("hero, sections and FAQ render", async ({ page }) => {
    await open(page);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("one keystroke away.");
    for (const name of ["Pick the one your hands already know.", "Set it up once. Use it all day.", "Your prompts never leave your computer.", "Free for Windows, macOS and Linux.", "Questions, answered."]) {
      await expect(page.getByRole("heading", { name })).toBeAttached();
    }
    await page.getByText("Does it work in the terminal?").click();
    await expect(page.getByText("set the paste keystroke to")).toBeVisible();
    await expect(page.locator("canvas.dither").first()).toBeAttached();
  });

  test("no horizontal scrolling on a phone", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148" });
    const page = await ctx.newPage();
    await open(page);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await expect(page.locator("a[data-primary-download]").first()).toHaveText(/Get it for your computer/);
    await ctx.close();
  });
});
