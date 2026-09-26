import { animate } from "motion";
import { api, errorText, on } from "./api";
import type { AppCtx } from "./main";
import { displayParts } from "./lib/keys";
import { h, icon, kbd, toast } from "./ui";

/**
 * First-run product tour: a short, plain-language walkthrough (Next → Next → Finish).
 *
 * The left side is a small stage with one shape that morphs from step to step (a dot becomes
 * a prompt card, a text box, the quick palette…) so each idea gets a picture. The right side
 * explains it in everyday words. Setup steps (macOS permission, a practice paste, launch at
 * login) come at the end. `replay` reopens the tour from Settings without the setup steps.
 */

type StepId = "welcome" | "save" | "hotkey" | "trigger" | "palette" | "blanks" | "permission" | "try" | "finish";

interface Shape {
  w: number;
  h: number;
  r: number;
  bg: string;
  border: string;
}

const SURFACE = "var(--color-surface)";
const RAISED = "var(--color-surface-raised)";
const CREAM = "var(--color-primary)";
const ACCENT = "var(--color-accent)";
const LINE = "var(--color-border-strong)";

const SHAPES: Record<StepId, Shape> = {
  welcome: { w: 132, h: 132, r: 66, bg: RAISED, border: LINE },
  save: { w: 292, h: 168, r: 16, bg: SURFACE, border: LINE },
  hotkey: { w: 292, h: 72, r: 16, bg: SURFACE, border: LINE },
  trigger: { w: 292, h: 132, r: 16, bg: SURFACE, border: LINE },
  palette: { w: 300, h: 196, r: 20, bg: SURFACE, border: LINE },
  blanks: { w: 292, h: 150, r: 16, bg: SURFACE, border: LINE },
  permission: { w: 120, h: 120, r: 60, bg: RAISED, border: LINE },
  try: { w: 200, h: 56, r: 999, bg: CREAM, border: CREAM },
  finish: { w: 120, h: 120, r: 60, bg: ACCENT, border: ACCENT },
};

/** The Clazy mark without the app-icon tile: a relaxed "C" with the red keystroke dot. */
const LOGO_MARK =
  '<svg viewBox="200 200 624 624" width="84" height="84"><g transform="rotate(-14 512 512)">' +
  '<path d="M688.8 688.8 A250 250 0 1 1 688.8 335.2" fill="none" stroke="#F2F0EB" stroke-width="124" stroke-linecap="round"/>' +
  '<circle cx="700" cy="512" r="58" fill="#FF4D2E"/></g></svg>';

const reduceMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

export function runOnboarding(ctx: AppCtx, reload: () => Promise<void>, opts: { replay?: boolean } = {}): Promise<void> {
  return new Promise((resolve) => {
    const replay = !!opts.replay;
    const steps: StepId[] = ["welcome", "save", "hotkey", "trigger", "palette", "blanks"];
    if (!replay) {
      if (ctx.os === "macos") steps.push("permission");
      steps.push("try");
    }
    steps.push("finish");
    const firstSetup = steps.findIndex((s) => s === "permission" || s === "try" || s === "finish");

    let index = 0;
    let launchAtLogin = true;
    let practiced = false;
    let permTimer: ReturnType<typeof setInterval> | undefined;
    let unlisten: (() => void) | undefined;
    // Everything a scene schedules is cancelled when the step changes.
    let cleanups: (() => void)[] = [];
    const later = (ms: number, fn: () => void) => {
      const t = setTimeout(fn, reduceMotion() ? 0 : ms);
      cleanups.push(() => clearTimeout(t));
    };
    const anim = (...args: Parameters<typeof animate>) => {
      const c = animate(...args);
      cleanups.push(() => c.stop());
      return c;
    };

    const alt = ctx.os === "macos" ? "Option" : "Alt";
    const palette = displayParts(ctx.settings.palette_hotkey, ctx.os);

    // ---------- layout ----------
    const morph = h("div", { class: "tour-morph" });
    const stage = h("div", { class: "tour-stage", "aria-hidden": "true" }, morph);
    const counter = h("span", { class: "tour-count mono" });
    const bar = h("div", { class: "tour-bar" }, h("span"));
    const body = h("div", { class: "tour-text", "aria-live": "polite" });
    const back = h("button", { class: "btn btn-ghost", type: "button", onclick: () => go(index - 1) }, "Back");
    const skip = h("button", { class: "btn btn-ghost tour-skip", type: "button", onclick: () => go(firstSetup) }, "Skip tour");
    const nextBtn = h("button", { class: "btn btn-primary", type: "button" });
    const actions = h("div", { class: "tour-actions" }, back, h("div", { class: "grow" }), skip, nextBtn);
    const modal = h(
      "div",
      { class: "modal card onboarding tour", role: "dialog", "aria-modal": "true", "aria-label": "Welcome to Clazy" },
      stage,
      h("div", { class: "tour-side" }, h("div", { class: "tour-top" }, counter, bar), body, actions),
    );
    const backdrop = h("div", { class: "modal-backdrop onb-backdrop" }, modal);
    document.body.append(backdrop);

    modal.addEventListener("keydown", (e) => {
      if ((e.target as HTMLElement).closest("textarea, input")) return;
      if (e.key === "ArrowRight" && steps[index] !== "finish" && steps[index] !== "try") go(index + 1);
      if (e.key === "ArrowLeft" && index > 0) go(index - 1);
    });

    function go(i: number) {
      index = Math.max(0, Math.min(i, steps.length - 1));
      paint();
    }

    async function finish() {
      cleanup();
      if (!replay) {
        try {
          ctx.settings = await api.saveSettings({ ...ctx.settings, onboarding_complete: true, launch_at_login: launchAtLogin });
        } catch (e) {
          // Launch-at-login can fail on some systems; don't block onboarding on it.
          toast(errorText(e), "error");
          ctx.settings = await api.saveSettings({ ...ctx.settings, onboarding_complete: true, launch_at_login: false }).catch(() => ctx.settings);
        }
      }
      unlisten?.();
      backdrop.remove();
      await reload();
      if (!replay) {
        toast(`Clazy is running in the ${ctx.os === "macos" ? "menu bar" : "tray"}. Press ${palette.join("+")} anytime.`, "success", 6000);
        await api.hideMain();
      }
      resolve();
    }

    function cleanup() {
      clearInterval(permTimer);
      cleanups.forEach((f) => f());
      cleanups = [];
    }

    // ---------- the morphing stage ----------
    function morphTo(step: StepId, content: HTMLElement) {
      const s = SHAPES[step];
      const fast = reduceMotion();
      morph.replaceChildren(content);
      anim(
        morph,
        { width: `${s.w}px`, height: `${s.h}px`, borderRadius: `${Math.min(s.r, s.h / 2)}px`, backgroundColor: s.bg, borderColor: s.border },
        fast ? { duration: 0 } : { type: "spring", bounce: 0.22, duration: 0.7 },
      );
      if (!fast) anim(content, { opacity: [0, 1], transform: ["translateY(6px)", "translateY(0)"] }, { duration: 0.35, delay: 0.25 });
    }

    function typeInto(el: HTMLElement, text: string, startMs: number, perChar = 38) {
      el.textContent = "";
      if (reduceMotion()) {
        el.textContent = text;
        return;
      }
      [...text].forEach((_, i) => later(startMs + i * perChar, () => (el.textContent = text.slice(0, i + 1))));
    }

    const caret = () => h("span", { class: "tour-caret" });

    const scenes: Record<StepId, () => HTMLElement> = {
      welcome: () => {
        const logo = h("div", { class: "tour-logo" });
        logo.innerHTML = LOGO_MARK;
        later(500, () => anim(logo, { rotate: [0, -8, 0] }, { duration: 0.9, ease: "easeInOut" }));
        return h("div", { class: "scene scene-center" }, logo);
      },
      save: () => {
        const text = h("div", { class: "scene-code" });
        typeInto(text, "Review the following code for bugs, edge cases and readability…", 500, 28);
        return h(
          "div",
          { class: "scene scene-card" },
          h("div", { class: "scene-row" }, h("span", { class: "mono scene-num" }, "(001)"), h("strong", null, "Code review"), h("span", { class: "scene-chip mono" }, `Ctrl+${alt}+1`)),
          h("div", { class: "scene-code-wrap" }, text, caret()),
        );
      },
      hotkey: () => {
        const keys = ["Ctrl", alt, "1"].map((k) => h("kbd", null, k));
        const field = h("div", { class: "scene-code scene-field" }, h("span", { class: "muted" }, "Message ChatGPT…"));
        keys.forEach((k, i) => later(350 + i * 220, () => anim(k, { y: [0, 4, 0], backgroundColor: [SURFACE, "#2a2a2a", SURFACE] }, { duration: 0.35 })));
        later(1150, () => {
          const t = h("span");
          field.replaceChildren(t, caret());
          typeInto(t, "Review the following code for bugs…", 0, 12);
        });
        return h("div", { class: "scene scene-hotkey" }, h("div", { class: "kbd-group scene-keys" }, ...keys), field);
      },
      trigger: () => {
        const typed = h("span", { class: "scene-typed" });
        const out = h("div", { class: "scene-code" }, typed, caret());
        typeInto(typed, ";push", 400, 140);
        later(1400, () => {
          typed.classList.add("expanded");
          typeInto(typed, "Look at my staged and unstaged changes, write a clear commit message, then push the branch.", 0, 10);
        });
        return h("div", { class: "scene scene-card" }, h("div", { class: "label" }, "Any text box"), out);
      },
      palette: () => {
        const q = h("span");
        typeInto(q, "rev", 500, 160);
        const rows = [
          ["001", "Code review"],
          ["002", "Commit & push"],
          ["003", "Write tests"],
        ].map(([n, t], i) => h("div", { class: `scene-prow${i === 0 ? " on" : ""}` }, h("span", { class: "mono" }, `(${n})`), h("span", null, t)));
        later(1100, () => {
          rows.slice(1).forEach((r) => anim(r, { opacity: 0.25 }, { duration: 0.3 }));
        });
        return h(
          "div",
          { class: "scene scene-palette" },
          h("div", { class: "scene-search" }, icon("search", 14), q, caret()),
          ...rows,
        );
      },
      blanks: () => {
        const clip = h("span", { class: "scene-var" }, "{{clipboard}}");
        const lang = h("span", { class: "scene-var" }, "{{language}}");
        later(900, () => {
          clip.textContent = "def add(a, b): …";
          clip.classList.add("filled");
          anim(clip, { scale: [0.85, 1] }, { type: "spring", bounce: 0.5, duration: 0.5 });
        });
        later(1500, () => {
          lang.textContent = "Python";
          lang.classList.add("filled");
          anim(lang, { scale: [0.85, 1] }, { type: "spring", bounce: 0.5, duration: 0.5 });
        });
        return h("div", { class: "scene scene-card" }, h("div", { class: "scene-code" }, "Explain this ", lang, " code in plain words:", h("br"), clip));
      },
      permission: () => h("div", { class: "scene scene-center" }, icon("shield", 44)),
      try: () => h("div", { class: "scene scene-center scene-try mono" }, ";push"),
      finish: () => {
        const c = h("div", { class: "scene scene-center scene-done" }, icon("check", 48));
        later(250, () => anim(c, { scale: [0.6, 1] }, { type: "spring", bounce: 0.55, duration: 0.6 }));
        return c;
      },
    };

    // ---------- text for each step ----------
    function paint() {
      cleanup();
      const step = steps[index];
      const n = index + 1;
      counter.textContent = `${String(n).padStart(2, "0")} / ${String(steps.length).padStart(2, "0")}`;
      (bar.firstElementChild as HTMLElement).style.width = `${(n / steps.length) * 100}%`;
      back.hidden = index === 0;
      skip.hidden = index >= firstSetup;
      morphTo(step, scenes[step]());
      nextBtn.replaceChildren("Next", icon("arrowRight", 16));
      nextBtn.onclick = () => go(index + 1);

      const para = (...c: (string | Node)[]) => h("p", null, ...c);
      const title = (t: string) => h("h2", { class: "onb-title" }, t);
      const tag = (t: string) => h("span", { class: "label" }, t);

      switch (step) {
        case "welcome":
          body.replaceChildren(
            tag("Welcome"),
            title("Hi, I'm Clazy."),
            para("Do you type the same things into ChatGPT, Claude or Cursor again and again? Save them in Clazy once, and it types them for you, in any app."),
            para("This quick tour takes about a minute."),
          );
          nextBtn.replaceChildren("Show me how", icon("arrowRight", 16));
          break;
        case "save":
          body.replaceChildren(
            tag("Step 1 · Save"),
            title("Save a prompt once"),
            para("A prompt is just the text you send to an AI. Write it in Clazy one time and give it a name, like “Code review”."),
            para("We added 5 example prompts so you can try things straight away. Change them or delete them whenever you like."),
          );
          break;
        case "hotkey":
          body.replaceChildren(
            tag("Step 2 · Key combo"),
            title("Press keys, get your prompt"),
            para("Give a prompt a key combo such as ", kbd(["Ctrl", alt, "1"]), ". Click into any text box, in any app, and press it."),
            para("The whole prompt appears right where you're typing, as if you had pasted it."),
          );
          break;
        case "trigger":
          body.replaceChildren(
            tag("Step 3 · Short code"),
            title("Or type a short code"),
            para("Prefer typing? Give a prompt a short code like ", h("code", null, ";push"), "."),
            para("Whenever you type ", h("code", null, ";push"), " anywhere, Clazy swaps it for the full prompt. The semicolon means you'll never trigger it by accident."),
          );
          break;
        case "palette":
          body.replaceChildren(
            tag("Step 4 · Search"),
            title("Forgot which one? Search."),
            para("Press ", kbd(palette), " from anywhere. A small search box pops up."),
            para("Type a word or two, press Enter, and the prompt lands in the app you were using."),
          );
          break;
        case "blanks":
          body.replaceChildren(
            tag("Step 5 · Blanks"),
            title("Blanks that fill themselves"),
            para("Put ", h("code", null, "{{clipboard}}"), " in a prompt and Clazy drops in whatever you copied last."),
            para("Put a word of your own, like ", h("code", null, "{{language}}"), ", and Clazy asks you what to fill in before it pastes."),
          );
          break;
        case "permission": {
          const statusLine = h("p", { class: "perm-status" });
          const refresh = async () => {
            const st = await api.getStatus();
            const ok = st.accessibility !== false;
            statusLine.replaceChildren(ok ? icon("check") : icon("alert"), ok ? " Permission granted" : " Not granted yet");
            statusLine.className = `perm-status ${ok ? "ok" : "missing"}`;
            nextBtn.textContent = ok ? "Continue" : "I'll do this later";
          };
          body.replaceChildren(
            tag("Setup · Permission"),
            title("Let Clazy type for you"),
            para("Your Mac asks before any app types or pastes on your behalf. Click the button below, then switch on Clazy under Accessibility. For short codes, switch it on under Input Monitoring too."),
            statusLine,
            h("div", null, h("button", { class: "btn btn-secondary", type: "button", onclick: () => void api.openAccessibilitySettings() }, "Open System Settings")),
          );
          nextBtn.textContent = "Continue";
          void refresh();
          permTimer = setInterval(() => void refresh(), 1500);
          break;
        }
        case "try": {
          const area = h("textarea", {
            class: "input practice",
            placeholder: `Click here, then type ;push, or press ${palette.join("+")} and pick a prompt.`,
            "aria-label": "Practice area",
          });
          const result = h("p", { class: "practice-result", "aria-live": "polite" });
          const check = () => {
            if (!practiced && area.value.trim().length > 30) {
              practiced = true;
              result.replaceChildren(icon("check"), " It works. That's the whole trick.");
              result.classList.add("ok");
              nextBtn.textContent = "Continue";
            }
          };
          area.addEventListener("input", check);
          void on("prompt-used", () => setTimeout(check, 400)).then((u) => {
            unlisten?.();
            unlisten = u;
          });
          body.replaceChildren(
            tag("Setup · Try it"),
            title("Paste your first prompt"),
            para("Click in the box and type ", h("code", null, ";push"), ". Or press ", kbd(palette), ", type “review” and press Enter."),
            area,
            result,
          );
          nextBtn.textContent = practiced ? "Continue" : "Skip for now";
          later(50, () => area.focus());
          break;
        }
        case "finish": {
          const children: (HTMLElement | null)[] = [
            tag("All set"),
            title(replay ? "That's the tour" : "You're ready"),
            para(
              `Clazy waits quietly in your ${ctx.os === "macos" ? "menu bar" : "system tray"}. Closing the window doesn't stop it. `,
              "Open it from there any time to add your own prompts.",
            ),
          ];
          if (!replay) {
            const input = h("input", { type: "checkbox", id: "onb-login", class: "switch-input", checked: launchAtLogin, onchange: () => (launchAtLogin = input.checked) });
            children.push(
              h("div", { class: "setting-row" },
                h("label", { for: "onb-login", class: "setting-label" }, "Start Clazy when I turn on my computer"),
                h("label", { class: "switch", for: "onb-login" }, input, h("span", { class: "switch-track", "aria-hidden": "true" })),
              ),
            );
          }
          body.replaceChildren(...children.filter((c): c is HTMLElement => !!c));
          nextBtn.textContent = replay ? "Finish" : "Start using Clazy";
          nextBtn.onclick = () => void finish();
          break;
        }
      }
      later(0, () => nextBtn.focus());
    }

    // Start from a dot so the first step also morphs in.
    Object.assign(morph.style, { width: "16px", height: "16px", borderRadius: "8px", backgroundColor: "var(--color-accent)" });
    paint();
  });
}
