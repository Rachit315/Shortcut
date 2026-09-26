import { api, errorText } from "./api";
import { displayParts, recordKey, type Os } from "./lib/keys";
import type { Check } from "./lib/types";
import { clear, h, icon, kbd } from "./ui";

export interface RecorderOptions {
  os: Os;
  value: string | null;
  promptId: string | null;
  forPalette?: boolean;
  allowClear?: boolean;
  label: string;
  onChange: (accel: string | null, check: Check | null) => void;
}

export interface Recorder {
  el: HTMLElement;
  setValue(v: string | null): void;
  isRecording(): boolean;
}

/** "Click to record" hotkey field with live modifier display, validation and conflict warnings. */
export function createRecorder(opts: RecorderOptions): Recorder {
  let value = opts.value;
  let recording = false;

  const display = h("span", { class: "recorder-display" });
  const button = h(
    "button",
    { type: "button", class: "recorder", "aria-label": opts.label, onclick: () => (recording ? stop() : start()) },
    icon("keyboard"),
    display,
  );
  const clearBtn = h(
    "button",
    {
      type: "button",
      class: "btn btn-icon btn-ghost",
      title: "Remove hotkey",
      "aria-label": "Remove hotkey",
      onclick: () => set(null, null),
    },
    icon("x"),
  );
  const suggestBtn = h(
    "button",
    {
      type: "button",
      class: "btn btn-small btn-ghost",
      onclick: async () => {
        const s = await api.suggestHotkey();
        if (s) await validateAndSet(s);
      },
    },
    "Suggest",
  );
  const message = h("div", { class: "field-message", "aria-live": "polite" });
  const row = h("div", { class: "recorder-row" }, button, opts.allowClear !== false ? clearBtn : null, opts.forPalette ? null : suggestBtn);
  const el = h("div", { class: "recorder-field" }, row, message);

  function paint(partial?: string[]) {
    clear(display);
    button.classList.toggle("recording", recording);
    if (recording) {
      display.append(
        partial && partial.length
          ? kbd([...displayParts(partial.join("+"), opts.os), "…"])
          : h("span", { class: "muted" }, "Press keys… (Esc to cancel)"),
      );
    } else if (value) {
      display.append(kbd(displayParts(value, opts.os)));
    } else {
      display.append(h("span", { class: "muted" }, "Click to record"));
    }
    clearBtn.hidden = !value || recording;
  }

  function showCheck(c: Check | null, error?: string) {
    clear(message);
    message.className = "field-message";
    if (error) {
      message.classList.add("is-error");
      message.append(icon("alert", 14), " ", error);
      return;
    }
    if (!c) return;
    if (c.error) {
      message.classList.add("is-error");
      message.append(icon("alert", 14), " ", c.error);
    } else if (c.warnings.length) {
      message.classList.add("is-warning");
      message.append(...c.warnings.map((w) => h("div", null, w)));
    }
  }

  function set(v: string | null, c: Check | null) {
    value = v;
    paint();
    showCheck(c);
    opts.onChange(value, c);
  }

  async function validateAndSet(accel: string) {
    try {
      const c = await api.checkHotkey(accel, opts.promptId, !!opts.forPalette);
      if (c.error || !c.normalized) {
        paint();
        showCheck(c);
        return;
      }
      set(c.normalized, c);
    } catch (e) {
      showCheck(null, errorText(e));
    }
  }

  const onKeyDown = (e: KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const r = recordKey(e);
    switch (r.kind) {
      case "partial":
        paint(r.modifiers);
        return;
      case "cancel":
        stop();
        return;
      case "clear":
        stop();
        if (opts.allowClear !== false) set(null, null);
        return;
      case "unsupported":
        showCheck(null, `${r.code} can't be used in a hotkey.`);
        return;
      case "combo":
        stop();
        void validateAndSet(r.accelerator);
    }
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if (!recording) return;
    e.preventDefault();
    e.stopPropagation();
    paint([
      ...(e.ctrlKey ? ["Ctrl"] : []),
      ...(e.altKey ? ["Alt"] : []),
      ...(e.shiftKey ? ["Shift"] : []),
      ...(e.metaKey ? ["Super"] : []),
    ]);
  };

  function start() {
    recording = true;
    showCheck(null);
    paint();
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    button.focus();
  }

  function stop() {
    recording = false;
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("keyup", onKeyUp, true);
    paint();
  }

  button.addEventListener("blur", () => recording && stop());
  paint();

  return {
    el,
    setValue(v) {
      value = v;
      paint();
      showCheck(null);
    },
    isRecording: () => recording,
  };
}
