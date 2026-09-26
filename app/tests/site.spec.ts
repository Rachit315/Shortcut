import { expect, test, type Page } from "@playwright/test";

const SITE = "http://127.0.0.1:4173/";
const LATEST = "https://github.com/Rachit315/Shortcut/releases/latest/download/";

const UA = {
  macos: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Safari/537.36",
  windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Safari/537.36",
  linux: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Safari/537.36",
};

async function open(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // Keep tests hermetic: no real network.
  await page.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ body: "", contentType: "text/css" }));
  await page.route("https://api.github.com/**", (r) => r.fulfill({ json: { tag_name: "v0.1.0", assets: [] } }));
  await page.goto(SITE);
  return errors;
}

test.describe("landing page", () => {
  for (const [os, path, label] of [
    ["macos", "/download/macos", "macOS"],
    ["windows", "/download/windows", "Windows"],
    ["linux", "/download/linux-deb", "Linux"],
  ] as const) {
    test(`${label} visitors get a one-click download`, async ({ browser }) => {
      const ctx = await browser.newContext({ userAgent: UA[os] });
      const page = await ctx.newPage();
      const errors = await open(page);
      const primary = page.locator("a[data-primary-download]").first();
      await expect(primary).toHaveText(new RegExp(`Download for ${label}`, "i"));
      await expect(primary).toHaveAttribute("href", path);
      await expect(page.locator(`.dl[data-os="${os}"]`)).toHaveClass(/detected/);
      await expect(page.locator("[data-version]")).toHaveText("LATEST V0.1.0");
      expect(errors).toEqual([]);
      await ctx.close();
    });
  }

  test("download paths redirect to stable release assets", async ({ request }) => {
    const expected: Record<string, string> = {
      "/download/macos": "Shortcut-macos-universal.dmg",
      "/download/windows": "Shortcut-windows-x64-setup.exe",
      "/download/windows-msi": "Shortcut-windows-x64.msi",
      "/download/linux-deb": "Shortcut-linux-amd64.deb",
      "/download/linux-appimage": "Shortcut-linux-amd64.AppImage",
    };
    for (const [path, asset] of Object.entries(expected)) {
      const res = await request.get(new URL(path, SITE).toString(), { maxRedirects: 0 });
      expect(res.status(), path).toBe(307);
      expect(res.headers()["location"], path).toBe(LATEST + asset);
    }
  });

  test("every platform card links to a download path", async ({ page }) => {
    await open(page);
    await expect(page.locator('[data-asset="dmg"]')).toHaveAttribute("href", "/download/macos");
    await expect(page.locator('[data-asset="exe"]')).toHaveAttribute("href", "/download/windows");
    await expect(page.locator('[data-asset="msi"]')).toHaveAttribute("href", "/download/windows-msi");
    await expect(page.locator('[data-asset="deb"]')).toHaveAttribute("href", "/download/linux-deb");
    await expect(page.locator('[data-asset="appimage"]')).toHaveAttribute("href", "/download/linux-appimage");
  });

  test("hero, sections, feature rows and FAQ work", async ({ page }) => {
    const errors = await open(page);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("keystroke away");
    for (const name of ["Features.", "Get Shortcut.", "Your questions, answered."]) {
      await expect(page.getByRole("heading", { name })).toBeAttached();
    }
    // Feature rows toggle open/closed.
    const second = page.getByRole("button", { name: "Show example: Text triggers" });
    await expect(second).toHaveAttribute("aria-expanded", "false");
    await second.click();
    await expect(second).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(".row.open")).toHaveCount(2);
    await page.getByText("Does it work in the terminal?").click();
    await expect(page.getByText("set the paste keystroke to")).toBeVisible();
    expect(errors).toEqual([]);
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
