import { api, errorText, on } from "./api";
import type { AppCtx } from "./main";
import { displayParts } from "./lib/keys";
import { h, icon, kbd, toast } from "./ui";

/** First-run walkthrough: welcome → (macOS) permission → try it → finish. */
export function runOnboarding(ctx: AppCtx, reload: () => Promise<void>): Promise<void> {
  return new Promise((resolve) => {
    const steps: ("welcome" | "permission" | "try" | "finish")[] =
      ctx.os === "macos" ? ["welcome", "permission", "try", "finish"] : ["welcome", "try", "finish"];
    let index = 0;
    let launchAtLogin = true;
    let practiced = false;
    let permTimer: ReturnType<typeof setInterval> | undefined;
    let unlisten: (() => void) | undefined;

    const body = h("div", { class: "onb-body" });
    const dots = h("div", { class: "onb-dots", "aria-hidden": "true" });
    const modal = h("div", { class: "modal card onboarding", role: "dialog", "aria-modal": "true", "aria-label": "Welcome to Shortcut" }, dots, body);
    const backdrop = h("div", { class: "modal-backdrop onb-backdrop" }, modal);
    document.body.append(backdrop);

    const next = () => {
      index = Math.min(index + 1, steps.length - 1);
      paint();
    };

    async function finish() {
      try {
        ctx.settings = await api.saveSettings({ ...ctx.settings, onboarding_complete: true, launch_at_login: launchAtLogin });
      } catch (e) {
        // Launch-at-login can fail on some systems; don't block onboarding on it.
        toast(errorText(e), "error");
        ctx.settings = await api.saveSettings({ ...ctx.settings, onboarding_complete: true, launch_at_login: false }).catch(() => ctx.settings);
      }
      clearInterval(permTimer);
      unlisten?.();
      backdrop.remove();
      await reload();
      toast(`Shortcut is running in the ${ctx.os === "macos" ? "menu bar" : "tray"}. Press ${displayParts(ctx.settings.palette_hotkey, ctx.os).join("+")} anytime.`, "success", 6000);
      await api.hideMain();
      resolve();
    }

    function paint() {
      clearInterval(permTimer);
      dots.replaceChildren(...steps.map((_, i) => h("span", { class: i === index ? "on" : i < index ? "done" : "" })));
      const step = steps[index];
      const palette = displayParts(ctx.settings.palette_hotkey, ctx.os);

      if (step === "welcome") {
        body.replaceChildren(
          h("div", { class: "onb-hero" }, h("img", { src: "/icon.svg", alt: "", width: 64, height: 64 })),
          h("span", { class: "label" }, "Welcome"),
          h("h2", { class: "onb-title" }, "Your best prompts, one keystroke away."),
          h("ul", { class: "onb-list" },
            h("li", null, icon("keyboard"), h("span", null, h("strong", null, "Hotkeys. "), "Press ", kbd(["Ctrl", ctx.os === "macos" ? "Option" : "Alt", "1"]), " to paste a prompt into any app.")),
            h("li", null, icon("zap"), h("span", null, h("strong", null, "Text triggers. "), "Type ", h("code", null, ";push"), " and it expands into the full prompt.")),
            h("li", null, icon("search"), h("span", null, h("strong", null, "Quick palette. "), "Press ", kbd(palette), " to search every prompt.")),
          ),
          h("p", { class: "help" }, "We added 5 starter prompts you can edit or delete. Everything stays on this computer."),
          h("div", { class: "modal-actions" }, h("button", { class: "btn btn-primary", onclick: next }, "Get started", icon("arrowRight", 16))),
        );
      }

      if (step === "permission") {
        const statusLine = h("p", { class: "perm-status" });
        const refresh = async () => {
          const st = await api.getStatus();
          const ok = st.accessibility !== false;
          statusLine.replaceChildren(ok ? icon("check") : icon("alert"), ok ? " Permission granted" : " Not granted yet");
          statusLine.className = `perm-status ${ok ? "ok" : "missing"}`;
          cont.textContent = ok ? "Continue" : "I'll do this later";
        };
        const cont = h("button", { class: "btn btn-primary", onclick: next }, "Continue");
        body.replaceChildren(
          h("span", { class: "label" }, "Step 2 · Permission"),
          h("h2", { class: "onb-title" }, "Allow Shortcut to paste for you"),
          h("p", null, "macOS asks you to approve apps that type or paste on your behalf. Open System Settings → Privacy & Security → Accessibility and switch on Shortcut. If you use text triggers, allow Input Monitoring too."),
          statusLine,
          h("div", { class: "modal-actions" }, h("button", { class: "btn btn-secondary", onclick: () => void api.openAccessibilitySettings() }, "Open System Settings"), cont),
        );
        void refresh();
        permTimer = setInterval(() => void refresh(), 1500);
      }

      if (step === "try") {
        const area = h("textarea", {
          class: "input practice",
          placeholder: `Click here, then type ;push — or press ${palette.join("+")} and pick a prompt.`,
          "aria-label": "Practice area",
        });
        const result = h("p", { class: "practice-result", "aria-live": "polite" });
        const cont = h("button", { class: "btn btn-primary", onclick: next }, "Skip for now");
        const check = () => {
          if (!practiced && area.value.trim().length > 30) {
            practiced = true;
            result.replaceChildren(icon("check"), " It works. That's the whole trick.");
            result.classList.add("ok");
            cont.textContent = "Continue";
          }
        };
        area.addEventListener("input", check);
        void on("prompt-used", () => setTimeout(check, 400)).then((u) => (unlisten = u));
        body.replaceChildren(
          h("span", { class: "label" }, `Step ${steps.indexOf("try") + 1} · Try it`),
          h("h2", { class: "onb-title" }, "Paste your first prompt"),
          h("p", null, "Click in the box and type ", h("code", null, ";push"), ". Or press ", kbd(palette), ", type “review” and press Enter."),
          area,
          result,
          h("div", { class: "modal-actions" }, cont),
        );
        setTimeout(() => area.focus(), 50);
      }

      if (step === "finish") {
        const input = h("input", { type: "checkbox", id: "onb-login", class: "switch-input", checked: launchAtLogin, onchange: () => (launchAtLogin = input.checked) });
        body.replaceChildren(
          h("span", { class: "label" }, "All set"),
          h("h2", { class: "onb-title" }, "Shortcut lives in your " + (ctx.os === "macos" ? "menu bar" : "system tray")),
          h("p", null, "Closing the window keeps it running. Open the library from the tray icon to add your own prompts."),
          h("div", { class: "setting-row" },
            h("label", { for: "onb-login", class: "setting-label" }, "Launch Shortcut when I log in"),
            h("label", { class: "switch", for: "onb-login" }, input, h("span", { class: "switch-track", "aria-hidden": "true" })),
          ),
          h("div", { class: "modal-actions" }, h("button", { class: "btn btn-primary", onclick: () => void finish() }, "Start using Shortcut")),
        );
      }
    }
    paint();
  });
}
