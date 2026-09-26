import { open, save } from "@tauri-apps/plugin-dialog";
import { api, errorText } from "./api";
import type { AppCtx } from "./main";
import type { PasteKeystroke, PasteMethod, Settings } from "./lib/types";
import { createRecorder } from "./recorder";
import { runOnboarding } from "./onboarding";
import { clear, h, icon, toast } from "./ui";

function toggle(label: string, checked: boolean, onChange: (v: boolean) => void, help?: string): HTMLElement {
  const id = `t-${label.replace(/\W+/g, "-").toLowerCase()}`;
  const input = h("input", { type: "checkbox", id, class: "switch-input", checked, onchange: () => onChange(input.checked) });
  return h(
    "div",
    { class: "setting-row" },
    h("div", null, h("label", { for: id, class: "setting-label" }, label), help ? h("p", { class: "help" }, help) : null),
    h("label", { class: "switch", for: id }, input, h("span", { class: "switch-track", "aria-hidden": "true" })),
  );
}

function segmented<T extends string>(name: string, value: T, options: [T, string][], onChange: (v: T) => void): HTMLElement {
  return h(
    "div",
    { class: "segmented", role: "radiogroup", "aria-label": name },
    ...options.map(([v, label]) =>
      h("button", {
        type: "button",
        role: "radio",
        "aria-checked": v === value ? "true" : "false",
        class: v === value ? "active" : "",
        onclick: () => onChange(v),
      }, label),
    ),
  );
}

export function renderSettings(col: HTMLElement, ctx: AppCtx, reload: () => Promise<void>): void {
  const s = ctx.settings;
  const { os, info, status } = ctx;

  async function update(patch: Partial<Settings>, message = "Settings saved") {
    try {
      ctx.settings = await api.saveSettings({ ...ctx.settings, ...patch });
      toast(message, "success", 1800);
    } catch (e) {
      toast(errorText(e), "error");
    }
    await reload();
    renderSettings(col, ctx, reload);
  }

  const recorder = createRecorder({
    os,
    value: s.palette_hotkey,
    promptId: null,
    forPalette: true,
    allowClear: false,
    label: "Quick palette hotkey",
    onChange: (accel) => {
      if (accel && accel !== ctx.settings.palette_hotkey) void update({ palette_hotkey: accel }, "Palette hotkey updated");
    },
  });

  const delay = h("input", {
    type: "number",
    class: "input input-number",
    min: 50,
    max: 2000,
    step: 50,
    value: String(s.restore_delay_ms),
    "aria-label": "Clipboard restore delay in milliseconds",
    disabled: !s.restore_clipboard,
    onchange: () => void update({ restore_delay_ms: Number(delay.value) || 300 }),
  });

  async function doExport(format: "json" | "markdown") {
    const ext = format === "json" ? "json" : "md";
    const path = await save({
      title: "Export prompts",
      defaultPath: `clazy-prompts.${ext}`,
      filters: [{ name: format === "json" ? "JSON" : "Markdown", extensions: [ext] }],
    });
    if (!path) return;
    try {
      const n = await api.exportData(path, format);
      toast(`Exported ${n} prompt${n === 1 ? "" : "s"}`, "success");
    } catch (e) {
      toast(errorText(e), "error");
    }
  }

  async function doImport() {
    const path = await open({
      title: "Import prompts",
      multiple: false,
      directory: false,
      filters: [{ name: "Clazy export", extensions: ["json", "md", "markdown"] }],
    });
    if (!path || Array.isArray(path)) return;
    try {
      const r = await api.importData(path);
      toast(`Imported: ${r.prompts_added} new, ${r.prompts_updated} updated${r.folders_added ? `, ${r.folders_added} folders` : ""}`, "success");
      for (const w of r.warnings.slice(0, 5)) toast(w, "info", 6000);
      await reload();
    } catch (e) {
      toast(errorText(e), "error");
    }
  }

  clear(col);
  col.append(
    h(
      "div",
      { class: "settings" },
      h("header", { class: "settings-head" }, h("span", { class: "label" }, "Preferences"), h("h1", null, "Settings")),

      info.session === "wayland"
        ? h("div", { class: "banner banner-warning" }, icon("alert"), h("p", null, "You're on a Wayland session. Global hotkeys and pasting only work in apps running under XWayland. For full support, log in with an X11 session (\"Ubuntu on Xorg\")."))
        : null,

      status.accessibility === false
        ? h(
            "div",
            { class: "banner banner-error" },
            icon("shield"),
            h("div", null,
              h("p", null, h("strong", null, "Accessibility permission needed. "), "macOS blocks Clazy from pasting and from reading text triggers until you allow it."),
              h("button", { class: "btn btn-small btn-primary", onclick: () => void api.openAccessibilitySettings() }, "Open System Settings")),
          )
        : null,

      h(
        "section",
        { class: "card settings-card" },
        h("h2", null, "Quick palette"),
        h("p", { class: "help" }, "Opens a searchable list of every prompt from any app. Enter pastes, Ctrl/Cmd+Enter copies."),
        recorder.el,
        status.hotkey_errors["palette"] ? h("div", { class: "field-message is-error" }, status.hotkey_errors["palette"]) : null,
      ),

      h(
        "section",
        { class: "card settings-card" },
        h("h2", null, "Pasting"),
        h("div", { class: "setting-row" },
          h("div", null, h("span", { class: "setting-label" }, "Paste method"), h("p", { class: "help" }, "“Type it out” works in apps that block synthetic paste (some remote desktops, VMs). Newlines are typed as Shift+Enter.")),
          segmented<PasteMethod>("Paste method", s.paste_method, [["clipboard", "Clipboard paste"], ["type", "Type it out"]], (v) => void update({ paste_method: v })),
        ),
        os !== "macos"
          ? h("div", { class: "setting-row" },
              h("div", null, h("span", { class: "setting-label" }, "Paste keystroke"), h("p", { class: "help" }, "Linux terminals usually need Ctrl+Shift+V.")),
              segmented<PasteKeystroke>("Paste keystroke", s.paste_keystroke, [["ctrl_v", "Ctrl+V"], ["ctrl_shift_v", "Ctrl+Shift+V"], ["shift_insert", "Shift+Insert"]], (v) => void update({ paste_keystroke: v })),
            )
          : null,
        toggle("Restore my clipboard after pasting", s.restore_clipboard, (v) => void update({ restore_clipboard: v }), "Clazy borrows the clipboard for a moment, then puts back what you had copied."),
        h("div", { class: "setting-row" },
          h("div", null, h("span", { class: "setting-label" }, "Restore delay"), h("p", { class: "help" }, "Increase this if an app pastes your old clipboard instead of the prompt.")),
          h("div", { class: "inline" }, delay, h("span", { class: "label muted" }, "ms")),
        ),
      ),

      h(
        "section",
        { class: "card settings-card" },
        h("h2", null, "Text triggers"),
        toggle("Expand text triggers", s.triggers_enabled, (v) => void update({ triggers_enabled: v }), "Typing a trigger such as ;push anywhere replaces it with the prompt. Clazy keeps only the last 64 typed characters in memory and never stores or sends them."),
        status.listener_error ? h("div", { class: "field-message is-error" }, status.listener_error) : null,
      ),

      h(
        "section",
        { class: "card settings-card" },
        h("h2", null, "General"),
        toggle("Launch Clazy at login", s.launch_at_login, (v) => void update({ launch_at_login: v }), "Starts quietly in the tray / menu bar."),
        toggle("Pause all shortcuts", s.paused, (v) => void update({ paused: v }, v ? "Shortcuts paused" : "Shortcuts resumed"), "Handy while gaming or screen-sharing."),
      ),

      h(
        "section",
        { class: "card settings-card" },
        h("h2", null, "Import & export"),
        h("p", { class: "help" }, "JSON keeps everything (folders, tags, hotkeys, triggers). Markdown is easy to read and share."),
        h("div", { class: "button-row" },
          h("button", { class: "btn btn-secondary", onclick: () => void doImport() }, icon("upload", 16), "Import…"),
          h("button", { class: "btn btn-secondary", onclick: () => void doExport("json") }, icon("download", 16), "Export JSON"),
          h("button", { class: "btn btn-secondary", onclick: () => void doExport("markdown") }, icon("download", 16), "Export Markdown"),
        ),
      ),

      h(
        "section",
        { class: "card settings-card about" },
        h("h2", null, "About"),
        h("dl", { class: "about-list" },
          h("dt", { class: "label" }, "Version"), h("dd", null, info.version),
          h("dt", { class: "label" }, "Data folder"), h("dd", { class: "mono" }, info.data_dir),
          h("dt", { class: "label" }, "Privacy"), h("dd", null, "Everything stays on this device. Clazy makes no network requests and has no telemetry."),
        ),
        h("div", { class: "button-row" },
          h("button", { class: "btn btn-secondary btn-small", onclick: () => void runOnboarding(ctx, reload, { replay: true }) }, "Replay the product tour"),
          h("button", { class: "btn btn-ghost btn-small", onclick: () => void api.hideMain() }, "Hide window to tray"),
        ),
      ),
    ),
  );
}
