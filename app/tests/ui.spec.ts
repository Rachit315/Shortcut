import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";

const MOCK = fileURLToPath(new URL("./mock-ipc.js", import.meta.url));

async function boot(page: Page, opts: Record<string, unknown> = {}, path = "/") {
  await page.addInitScript((o) => ((window as unknown as { __MOCK_OPTS: unknown }).__MOCK_OPTS = o), opts);
  await page.addInitScript({ path: MOCK });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(path);
  return errors;
}

const calls = (page: Page, cmd: string) =>
  page.evaluate((c) => (window as unknown as { __calls: { cmd: string; args: Record<string, unknown> }[] }).__calls.filter((x) => x.cmd === c), cmd);

test.describe("main window", () => {
  test("first run shows onboarding and finishes to the tray", async ({ page }) => {
    const errors = await boot(page, { onboarded: false });
    const dialog = page.getByRole("dialog", { name: "Welcome to Shortcut" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Your best prompts, one keystroke away.")).toBeVisible();
    await dialog.getByRole("button", { name: "Get started" }).click();
    await expect(dialog.getByText("Paste your first prompt")).toBeVisible();
    // Simulate the trigger expansion landing in the practice box.
    await dialog.getByLabel("Practice area").fill("Look at my staged and unstaged changes, then push the current branch.");
    await expect(dialog.getByText("It works.")).toBeVisible();
    await dialog.getByRole("button", { name: "Continue" }).click();
    await dialog.getByRole("button", { name: "Start using Shortcut" }).click();
    await expect(dialog).toBeHidden();
    const saved = await calls(page, "save_settings");
    expect(saved.at(-1)!.args.settings).toMatchObject({ onboarding_complete: true, launch_at_login: true });
    expect(await calls(page, "hide_main")).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  test("library lists starter prompts and search filters them", async ({ page }) => {
    const errors = await boot(page);
    const list = page.getByRole("listbox", { name: "Prompts" });
    await expect(list.getByRole("option")).toHaveCount(5);
    // Favourites first.
    await expect(list.getByRole("option").first()).toContainText("Code review");
    await page.getByLabel("Search prompts").fill("midj");
    await expect(list.getByRole("option")).toHaveCount(0);
    await page.getByLabel("Search prompts").fill("cinematic");
    await expect(list.getByRole("option")).toHaveCount(1);
    await expect(list.getByRole("option")).toContainText("Image style");
    await page.getByLabel("Search prompts").fill(";push");
    await expect(list.getByRole("option").first()).toContainText("Commit & push");
    expect(errors).toEqual([]);
  });

  test("create a prompt with a recorded hotkey and a trigger", async ({ page }) => {
    const errors = await boot(page);
    await page.getByRole("button", { name: "New prompt" }).first().click();
    await page.getByLabel("Title").fill("Summarise ticket");
    await page.getByLabel("Prompt body").fill("Summarise this support ticket in 3 bullets for {{audience=engineering}}:\n{{clipboard}}");
    await expect(page.locator(".vars .chip")).toContainText("audience");

    await page.getByRole("button", { name: "Global hotkey" }).click();
    await page.keyboard.press("Control+Alt+KeyK");
    await expect(page.locator(".recorder kbd")).toHaveText(["Ctrl", "Alt", "K"]);

    await page.getByLabel("Text trigger").fill(";sum");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Saved")).toBeVisible();

    const item = page.getByRole("option", { name: /Summarise ticket/ });
    await expect(item).toContainText("Ctrl + Alt + K");
    await expect(item).toContainText(";sum");
    const saved = (await calls(page, "save_prompt")).at(-1)!.args.input as Record<string, unknown>;
    expect(saved).toMatchObject({ title: "Summarise ticket", hotkey: "Ctrl+Alt+K", trigger: ";sum" });
    await expect(page.locator(".status-pill")).toContainText(["Hotkey active", "Trigger active"]);
    expect(errors).toEqual([]);
  });

  test("duplicate hotkeys and triggers are rejected inline", async ({ page }) => {
    await boot(page);
    await page.getByRole("button", { name: "New prompt" }).first().click();
    await page.getByRole("button", { name: "Global hotkey" }).click();
    await page.keyboard.press("Control+Alt+Digit1");
    await expect(page.locator(".recorder-field .field-message")).toContainText("already used by 'Code review'");
    await expect(page.locator(".recorder kbd")).toHaveCount(0);

    await page.getByLabel("Text trigger").fill(";push");
    await expect(page.getByText(";push is already used by 'Commit & push'.")).toBeVisible();

    await page.getByRole("button", { name: "Global hotkey" }).click();
    await page.keyboard.press("Control+Digit5");
    await expect(page.locator(".recorder-field .field-message")).toContainText("switches browser and editor tabs");
    await expect(page.locator(".recorder kbd")).toHaveText(["Ctrl", "5"]);
  });

  test("unsaved changes are guarded and prompts can be deleted", async ({ page }) => {
    await boot(page);
    await page.getByRole("option", { name: /Write tests/ }).click();
    await page.getByLabel("Title").fill("Write better tests");
    await page.getByRole("option", { name: /Explain simply/ }).click();
    const confirm = page.getByRole("dialog", { name: "Discard unsaved changes?" });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "Keep editing" }).click();
    await expect(page.getByLabel("Title")).toHaveValue("Write better tests");

    await page.getByRole("button", { name: "Delete" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete prompt" }).click();
    await expect(page.getByRole("listbox", { name: "Prompts" }).getByRole("option")).toHaveCount(4);
    expect(await calls(page, "delete_prompt")).toHaveLength(1);
  });

  test("folders can be created and filter the list", async ({ page }) => {
    await boot(page);
    await page.getByRole("button", { name: "New folder" }).click();
    await page.getByLabel("New folder name").fill("Support");
    await page.getByLabel("New folder name").press("Enter");
    await expect(page.getByRole("heading", { name: "Support" })).toBeVisible();
    await expect(page.getByText("No prompts here yet.")).toBeVisible();
    await page.getByRole("button", { name: /Images/ }).click();
    await expect(page.getByRole("listbox", { name: "Prompts" }).getByRole("option")).toHaveCount(1);
  });

  test("settings save immediately and export works", async ({ page }) => {
    const errors = await boot(page);
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await page.getByRole("radio", { name: "Type it out" }).click();
    await expect.poll(async () => ((await calls(page, "save_settings")).at(-1)?.args.settings as { paste_method?: string })?.paste_method).toBe("type");
    await page.getByRole("radio", { name: "Ctrl+Shift+V" }).click();
    await expect.poll(async () => ((await calls(page, "save_settings")).at(-1)?.args.settings as { paste_keystroke?: string })?.paste_keystroke).toBe("ctrl_shift_v");
    await page.getByRole("button", { name: "Export JSON" }).click();
    await expect(page.getByText("Exported 5 prompts")).toBeVisible();
    expect((await calls(page, "export_data"))[0].args).toEqual({ path: "/tmp/shortcut-prompts.json", format: "json" });
    await page.getByRole("button", { name: "Import…" }).click();
    await expect(page.getByText("Imported: 1 new, 0 updated")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("pause from the sidebar", async ({ page }) => {
    await boot(page);
    await page.getByRole("button", { name: "Pause" }).click();
    await expect(page.getByText("Shortcuts paused").first()).toBeVisible();
    expect((await calls(page, "set_paused"))[0].args).toEqual({ paused: true });
    await page.getByRole("button", { name: "Resume" }).click();
    await expect(page.getByText("Quick palette")).toBeVisible();
  });

  test("macOS shows the Accessibility banner when permission is missing", async ({ page }) => {
    await boot(page, { os: "macos", accessibility: false });
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page.getByText("Accessibility permission needed.")).toBeVisible();
    await page.getByRole("button", { name: "Open System Settings" }).click();
    expect(await calls(page, "open_accessibility_settings")).toHaveLength(1);
    await expect(page.getByText("Paste keystroke")).toHaveCount(0);
  });
});

test.describe("quick palette", () => {
  test("search and paste with Enter", async ({ page }) => {
    const errors = await boot(page, {}, "/palette.html");
    const input = page.getByRole("combobox", { name: "Search prompts" });
    await expect(input).toBeFocused();
    await expect(page.getByRole("option")).toHaveCount(5);
    await input.fill("push");
    await expect(page.getByRole("option").first()).toContainText("Commit & push");
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await calls(page, "palette_paste")).length).toBe(1);
    expect((await calls(page, "palette_paste"))[0].args).toMatchObject({ promptId: "p-push", copyOnly: false });
    expect(errors).toEqual([]);
  });

  test("arrow keys move the selection and Ctrl+Enter copies", async ({ page }) => {
    await boot(page, {}, "/palette.html");
    await page.getByRole("combobox").fill("e");
    await page.keyboard.press("ArrowDown");
    const second = await page.getByRole("option").nth(1).getAttribute("aria-selected");
    expect(second).toBe("true");
    await page.getByRole("combobox").fill("explain");
    await page.keyboard.press("Control+Enter");
    await expect.poll(async () => (await calls(page, "palette_paste")).at(-1)?.args).toMatchObject({ promptId: "p-eli5", copyOnly: true });
  });

  test("prompts with fill-ins ask for values first", async ({ page }) => {
    await boot(page, {}, "/palette.html");
    await page.getByRole("combobox").fill("cinematic");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Image style: cinematic" })).toBeVisible();
    await expect(page.getByLabel("subject")).toBeFocused();
    await page.getByLabel("subject").fill("a lighthouse at dusk");
    await page.getByLabel("aspect").selectOption("9:16");
    await expect(page.getByLabel("Preview")).toContainText("a lighthouse at dusk, cinematic lighting, muted teal and orange palette --ar 9:16");
    await page.getByLabel("subject").press("Enter");
    await expect.poll(async () => (await calls(page, "palette_paste")).at(-1)?.args).toMatchObject({
      promptId: "p-img",
      values: { subject: "a lighthouse at dusk", palette: "teal and orange", aspect: "9:16" },
    });
  });

  test("opened by a hotkey in fill mode; Esc cancels", async ({ page }) => {
    await boot(page, { paletteMode: { mode: "fill", prompt_id: "p-tests" } }, "/palette.html");
    await expect(page.getByRole("heading", { name: "Write tests" })).toBeVisible();
    await expect(page.getByLabel("framework")).toHaveValue("the project's existing test framework");
    await page.keyboard.press("Escape");
    expect((await calls(page, "palette_dismiss")).at(-1)?.args).toEqual({ restore: true });
  });
});
