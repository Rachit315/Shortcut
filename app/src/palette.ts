import "./fonts";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/palette.css";
import { api, errorText, on } from "./api";
import { detectOs, displayParts, type Os } from "./lib/keys";
import { previewTemplate } from "./lib/preview";
import { preview, rankPrompts } from "./lib/search";
import type { FillRequest, PaletteMode, Prompt } from "./lib/types";
import { clear, h, icon } from "./ui";

const MAX_RESULTS = 50;

const P = {
  os: detectOs() as Os,
  prompts: [] as Prompt[],
  results: [] as Prompt[],
  index: 0,
  mode: "search" as PaletteMode["mode"],
  fill: null as FillRequest | null,
  values: {} as Record<string, string>,
  cameFromSearch: false,
  openedAt: 0,
  busy: false,
};

const root = document.getElementById("palette")!;
const input = h("input", {
  class: "palette-input",
  placeholder: "Search prompts…",
  "aria-label": "Search prompts",
  autocomplete: "off",
  spellcheck: false,
  role: "combobox",
  "aria-controls": "palette-results",
  "aria-expanded": "true",
});
const list = h("ul", { class: "palette-results", id: "palette-results", role: "listbox" });
const status = h("div", { class: "palette-status", "aria-live": "polite" });
const foot = h("footer", { class: "palette-foot" });
const shell = h("div", { class: "palette-shell" });
root.append(shell);

function footer(parts: [string[], string][]) {
  clear(foot);
  foot.append(...parts.map(([keys, label]) => h("span", { class: "legend" }, ...keys.map((k) => h("kbd", null, k)), h("span", null, label))));
}

const MOD = () => (P.os === "macos" ? "⌘" : "Ctrl");

// ---------------------------------------------------------------- search mode

function renderSearch() {
  P.mode = "search";
  clear(shell);
  shell.append(
    h("div", { class: "palette-search" }, icon("search", 20), input),
    list,
    status,
    foot,
  );
  footer([[["↑", "↓"], "navigate"], [["↵"], "paste"], [[MOD(), "↵"], "copy"], [["esc"], "close"]]);
  filter();
  input.focus();
  input.select();
}

function filter() {
  P.results = rankPrompts(P.prompts, input.value).slice(0, MAX_RESULTS);
  P.index = Math.min(P.index, Math.max(0, P.results.length - 1));
  paintResults();
}

function paintResults() {
  clear(list);
  if (P.results.length === 0) {
    list.append(h("li", { class: "palette-empty" }, P.prompts.length ? "No prompts match." : "No prompts yet — add one in the Clazy window."));
    return;
  }
  P.results.forEach((p, i) => {
    const li = h(
      "li",
      {
        class: `palette-item${i === P.index ? " active" : ""}`,
        role: "option",
        id: `opt-${i}`,
        "aria-selected": i === P.index ? "true" : "false",
        onmousemove: () => {
          if (P.index !== i) {
            P.index = i;
            paintActive();
          }
        },
        onclick: () => void choose(false),
      },
      h("span", { class: "palette-num", "aria-hidden": "true" }, `(${String(i + 1).padStart(3, "0")})`),
      h(
        "div",
        { class: "palette-item-main" },
        h("div", { class: "palette-item-title" }, p.favorite ? h("span", { class: "fav" }, icon("star", 12)) : null, p.title),
        h("div", { class: "palette-item-preview" }, preview(p.body, 90)),
      ),
      h(
        "div",
        { class: "palette-item-badges" },
        p.trigger ? h("span", { class: "badge badge-mono badge-soft" }, p.trigger) : null,
        p.hotkey ? h("span", { class: "badge badge-mono" }, displayParts(p.hotkey, P.os).join("+")) : null,
      ),
    );
    list.append(li);
  });
  input.setAttribute("aria-activedescendant", `opt-${P.index}`);
}

function paintActive() {
  list.querySelectorAll(".palette-item").forEach((el, i) => {
    el.classList.toggle("active", i === P.index);
    el.setAttribute("aria-selected", i === P.index ? "true" : "false");
  });
  list.querySelector(".palette-item.active")?.scrollIntoView({ block: "nearest" });
  input.setAttribute("aria-activedescendant", `opt-${P.index}`);
}

async function choose(copyOnly: boolean) {
  const p = P.results[P.index];
  if (!p || P.busy) return;
  const req = await api.getFillRequest(p.id);
  if (req.vars.length) {
    P.cameFromSearch = true;
    renderFill(req, copyOnly);
    return;
  }
  await submit(p.id, null, copyOnly);
}

async function submit(promptId: string, values: Record<string, string> | null, copyOnly: boolean) {
  P.busy = true;
  try {
    await api.palettePaste(promptId, values, copyOnly);
  } catch (e) {
    status.textContent = errorText(e);
  } finally {
    P.busy = false;
  }
}

// ---------------------------------------------------------------- fill mode

function renderFill(req: FillRequest, copyOnly = false) {
  P.mode = "fill";
  P.fill = req;
  P.values = {};
  for (const v of req.vars) {
    P.values[v.name] = req.last_values[v.name] ?? v.default ?? (v.kind === "choice" ? v.options[0] : "");
  }
  clear(shell);
  const previewEl = h("pre", { class: "fill-preview", "aria-label": "Preview" });
  const paintPreview = () => (previewEl.textContent = previewTemplate(req.prompt.body, req.vars, P.values));

  const fields = req.vars.map((v, i) => {
    const id = `var-${i}`;
    let control: HTMLInputElement | HTMLSelectElement;
    if (v.kind === "choice") {
      control = h("select", { id, class: "input" }, ...v.options.map((o) => h("option", { value: o, selected: o === P.values[v.name] }, o)));
    } else {
      control = h("input", { id, class: "input", value: P.values[v.name], placeholder: v.default ?? "", autocomplete: "off", spellcheck: false });
    }
    control.addEventListener("input", () => {
      P.values[v.name] = control.value;
      paintPreview();
    });
    control.addEventListener("change", () => {
      P.values[v.name] = control.value;
      paintPreview();
    });
    return h("label", { class: "fill-field", for: id }, h("span", { class: "label" }, v.name), control);
  });

  const go = h(
    "button",
    { class: "btn btn-primary", type: "submit" },
    copyOnly ? icon("copy", 16) : icon("arrowRight", 16),
    copyOnly ? "Copy" : "Paste",
  );
  const form = h(
    "form",
    {
      class: "fill-form",
      onsubmit: (e: Event) => {
        e.preventDefault();
        void submit(req.prompt.id, P.values, copyOnly);
      },
    },
    h("div", { class: "fill-head" }, h("span", { class: "label" }, "Fill in"), h("h1", null, req.prompt.title)),
    h("div", { class: "fill-fields" }, ...fields),
    previewEl,
    h("div", { class: "fill-actions" }, h("button", { type: "button", class: "btn btn-ghost", onclick: back }, "Back"), go),
  );
  shell.append(form, status, foot);
  footer([[["↵"], copyOnly ? "copy" : "paste"], [["tab"], "next field"], [["esc"], P.cameFromSearch ? "back" : "cancel"]]);
  paintPreview();
  setTimeout(() => (fields[0]?.querySelector("input,select") as HTMLElement | null)?.focus(), 0);
}

function back() {
  if (P.cameFromSearch) renderSearch();
  else void api.paletteDismiss(true);
}

// ---------------------------------------------------------------- lifecycle

async function open(mode: PaletteMode) {
  P.openedAt = Date.now();
  P.busy = false;
  status.textContent = "";
  try {
    P.prompts = await api.listPrompts();
    const info = await api.getAppInfo();
    P.os = info.os;
  } catch (e) {
    status.textContent = errorText(e);
  }
  if (mode.mode === "fill" && mode.prompt_id) {
    P.cameFromSearch = false;
    try {
      renderFill(await api.getFillRequest(mode.prompt_id));
    } catch (e) {
      renderSearch();
      status.textContent = errorText(e);
    }
  } else {
    input.value = "";
    P.index = 0;
    renderSearch();
  }
}

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    e.preventDefault();
    if (P.mode === "fill") back();
    else void api.paletteDismiss(true);
    return;
  }
  if (P.mode !== "search") return;
  if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) {
    e.preventDefault();
    P.index = Math.min(P.index + 1, P.results.length - 1);
    paintActive();
  } else if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) {
    e.preventDefault();
    P.index = Math.max(P.index - 1, 0);
    paintActive();
  } else if (e.key === "Enter") {
    e.preventDefault();
    void choose(e.metaKey || e.ctrlKey);
  }
});

input.addEventListener("input", () => {
  P.index = 0;
  filter();
});

// Clicking another app closes the palette (but ignore the focus shuffle right after opening).
window.addEventListener("blur", () => {
  if (Date.now() - P.openedAt > 400 && !P.busy) void api.paletteDismiss(false);
});

void on<PaletteMode>("palette-open", (mode) => void open(mode));
void api.getPaletteMode().then((m) => open(m)).catch(() => renderSearch());
