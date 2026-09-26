import "./fonts";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/app.css";
import { api, errorText, on } from "./api";
import { detectOs, displayParts, type Os } from "./lib/keys";
import { preview, rankPrompts } from "./lib/search";
import type { AppInfo, Check, Folder, Prompt, PromptInput, Settings, Status, VarSpec } from "./lib/types";
import { createRecorder } from "./recorder";
import { renderSettings } from "./settings";
import { runOnboarding } from "./onboarding";
import { clear, confirmDialog, debounce, h, icon, kbd, toast } from "./ui";

type View =
  | { kind: "all" }
  | { kind: "favorites" }
  | { kind: "unfiled" }
  | { kind: "folder"; id: string }
  | { kind: "settings" };

interface Draft extends PromptInput {
  hotkeyCheck: Check | null;
  triggerCheck: Check | null;
}

export interface AppCtx {
  os: Os;
  info: AppInfo;
  prompts: Prompt[];
  folders: Folder[];
  settings: Settings;
  status: Status;
}

const S = {
  ctx: null as unknown as AppCtx,
  view: { kind: "all" } as View,
  query: "",
  selectedId: null as string | null,
  draft: null as Draft | null,
  dirty: false,
  creatingFolder: false,
  renamingFolder: null as string | null,
};

const root = document.getElementById("app")!;
const sidebar = h("aside", { class: "sidebar", "aria-label": "Library navigation" });
const listCol = h("section", { class: "list-col", "aria-label": "Prompts" });
const editorCol = h("section", { class: "editor-col", "aria-label": "Editor" });
const settingsCol = h("section", { class: "settings-col", "aria-label": "Settings", hidden: true });
root.append(h("div", { class: "layout" }, sidebar, listCol, editorCol, settingsCol));

// ---------------------------------------------------------------- data

async function load(): Promise<void> {
  const [prompts, folders, settings, status] = await Promise.all([
    api.listPrompts(),
    api.listFolders(),
    api.getSettings(),
    api.getStatus(),
  ]);
  Object.assign(S.ctx, { prompts, folders, settings, status });
}

async function refresh(opts: { editor?: boolean } = {}): Promise<void> {
  await load();
  renderSidebar();
  if (S.view.kind === "settings") {
    renderSettingsView();
    return;
  }
  renderList();
  // Don't clobber unsaved edits.
  if (opts.editor || (!S.dirty && S.selectedId && !S.ctx.prompts.some((p) => p.id === S.selectedId))) {
    const exists = S.ctx.prompts.find((p) => p.id === S.selectedId);
    if (!exists && S.selectedId) S.selectedId = null;
    openEditor(S.selectedId);
  } else {
    renderEditorStatus();
  }
}

function visiblePrompts(): Prompt[] {
  const v = S.view;
  const inView = S.ctx.prompts.filter((p) =>
    v.kind === "favorites" ? p.favorite : v.kind === "unfiled" ? !p.folder_id : v.kind === "folder" ? p.folder_id === v.id : true,
  );
  return rankPrompts(inView, S.query);
}

async function guardDirty(): Promise<boolean> {
  if (!S.dirty) return true;
  const discard = await confirmDialog({
    title: "Discard unsaved changes?",
    body: "You have edits to this prompt that haven't been saved.",
    confirm: "Discard changes",
    danger: true,
    cancel: "Keep editing",
  });
  if (discard) S.dirty = false;
  return discard;
}

// ---------------------------------------------------------------- sidebar

function navItem(label: string, view: View, ic: Parameters<typeof icon>[0], count: number | null): HTMLElement {
  const active =
    S.view.kind === view.kind && (view.kind !== "folder" || (S.view.kind === "folder" && S.view.id === view.id));
  return h(
    "button",
    {
      class: `nav-item${active ? " active" : ""}`,
      "aria-current": active ? "page" : undefined,
      onclick: async () => {
        if (!(await guardDirty())) return;
        setView(view);
      },
    },
    icon(ic),
    h("span", { class: "nav-label" }, label),
    count === null ? null : h("span", { class: "nav-count" }, String(count)),
  );
}

function setView(view: View) {
  S.view = view;
  const settings = view.kind === "settings";
  listCol.hidden = settings;
  editorCol.hidden = settings;
  settingsCol.hidden = !settings;
  renderSidebar();
  if (settings) {
    renderSettingsView();
  } else {
    renderList();
    const first = visiblePrompts()[0];
    if (!S.selectedId || !visiblePrompts().some((p) => p.id === S.selectedId)) openEditor(first?.id ?? null);
    renderListItems();
  }
}

function folderRow(f: Folder): HTMLElement {
  const count = S.ctx.prompts.filter((p) => p.folder_id === f.id).length;
  if (S.renamingFolder === f.id) {
    const input = h("input", { class: "input input-small", value: f.name, "aria-label": "Folder name", maxLength: 60 });
    const finish = async (save: boolean) => {
      S.renamingFolder = null;
      if (save && input.value.trim() && input.value.trim() !== f.name) {
        try {
          await api.saveFolder(f.id, input.value);
        } catch (e) {
          toast(errorText(e), "error");
        }
      }
      await refresh();
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") void finish(true);
      if (e.key === "Escape") void finish(false);
    });
    input.addEventListener("blur", () => void finish(true));
    queueMicrotask(() => input.select());
    return h("div", { class: "nav-edit" }, input);
  }
  const item = navItem(f.name, { kind: "folder", id: f.id }, "folder", count);
  const actions = h(
    "span",
    { class: "nav-actions" },
    h("button", {
      class: "btn btn-icon btn-ghost btn-tiny", title: "Rename folder", "aria-label": `Rename ${f.name}`,
      onclick: (e: Event) => { e.stopPropagation(); S.renamingFolder = f.id; renderSidebar(); },
    }, icon("edit", 13)),
    h("button", {
      class: "btn btn-icon btn-ghost btn-tiny", title: "Delete folder", "aria-label": `Delete ${f.name}`,
      onclick: async (e: Event) => {
        e.stopPropagation();
        const ok = await confirmDialog({
          title: `Delete “${f.name}”?`,
          body: count ? `Its ${count} prompt${count === 1 ? "" : "s"} will move to Unfiled. No prompts are deleted.` : "This folder is empty.",
          confirm: "Delete folder",
          danger: true,
        });
        if (!ok) return;
        await api.deleteFolder(f.id);
        if (S.view.kind === "folder" && S.view.id === f.id) S.view = { kind: "all" };
        await refresh();
        setView(S.view);
      },
    }, icon("trash", 13)),
  );
  return h("div", { class: "nav-row" }, item, actions);
}

function renderSidebar() {
  clear(sidebar);
  const { prompts, folders, settings, status, os, info } = S.ctx;
  const newFolder = S.creatingFolder
    ? (() => {
        const input = h("input", { class: "input input-small", placeholder: "Folder name", "aria-label": "New folder name", maxLength: 60 });
        const finish = async (save: boolean) => {
          S.creatingFolder = false;
          if (save && input.value.trim()) {
            try {
              const f = await api.saveFolder(null, input.value);
              S.view = { kind: "folder", id: f.id };
            } catch (e) {
              toast(errorText(e), "error");
            }
          }
          await refresh();
          setView(S.view);
        };
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") void finish(true);
          if (e.key === "Escape") void finish(false);
        });
        input.addEventListener("blur", () => void finish(!!input.value.trim()));
        queueMicrotask(() => input.focus());
        return h("div", { class: "nav-edit" }, input);
      })()
    : null;

  const paused = settings.paused;
  sidebar.append(
    h(
      "div",
      { class: "brand" },
      h("img", { src: "/icon.svg", alt: "", width: 32, height: 32 }),
      h("div", null, h("div", { class: "brand-name" }, "Shortcut"), h("div", { class: "label" }, `v${info.version}`)),
    ),
    h(
      "nav",
      { class: "nav" },
      navItem("All prompts", { kind: "all" }, "layers", prompts.length),
      navItem("Favourites", { kind: "favorites" }, "star", prompts.filter((p) => p.favorite).length),
      h(
        "div",
        { class: "nav-section" },
        h("span", { class: "label" }, "Folders"),
        h("button", {
          class: "btn btn-icon btn-ghost btn-tiny", title: "New folder", "aria-label": "New folder",
          onclick: () => { S.creatingFolder = true; renderSidebar(); },
        }, icon("plus", 14)),
      ),
      ...folders.map(folderRow),
      newFolder,
      navItem("Unfiled", { kind: "unfiled" }, "inbox", prompts.filter((p) => !p.folder_id).length),
    ),
    h("div", { class: "sidebar-spacer" }),
    h(
      "div",
      { class: `status-card card${paused ? " is-paused" : ""}` },
      h("div", { class: "label" }, paused ? "Shortcuts paused" : "Quick palette"),
      paused
        ? h("p", { class: "status-text" }, "Hotkeys and triggers are off.")
        : h("div", { class: "status-kbd" }, kbd(displayParts(settings.palette_hotkey, os))),
      status.hotkey_errors["palette"] && !paused
        ? h("p", { class: "status-text is-error" }, status.hotkey_errors["palette"])
        : null,
      h(
        "button",
        {
          class: `btn btn-small ${paused ? "btn-primary" : "btn-secondary"}`,
          onclick: async () => {
            await api.setPaused(!paused);
            await refresh();
            toast(paused ? "Shortcuts resumed" : "Shortcuts paused");
          },
        },
        icon(paused ? "play" : "pause", 14),
        paused ? "Resume" : "Pause",
      ),
    ),
    navItem("Settings", { kind: "settings" }, "settings", null),
  );
}

// ---------------------------------------------------------------- list

let searchInput: HTMLInputElement;

function renderList() {
  if (!searchInput) {
    searchInput = h("input", {
      class: "input search-input",
      type: "search",
      placeholder: "Search prompts",
      "aria-label": "Search prompts",
      oninput: () => {
        S.query = searchInput.value;
        renderListItems();
      },
    });
  }
  clear(listCol);
  const title =
    S.view.kind === "favorites" ? "Favourites"
      : S.view.kind === "unfiled" ? "Unfiled"
      : S.view.kind === "folder" ? S.ctx.folders.find((f) => f.id === (S.view as { id: string }).id)?.name ?? "Folder"
      : "All prompts";
  listCol.append(
    h(
      "header",
      { class: "list-header" },
      h("h1", { class: "list-title" }, title),
      h("button", { class: "btn btn-primary btn-small", onclick: () => void newPrompt(), title: "New prompt (Ctrl/Cmd+N)" }, icon("plus", 14), "New prompt"),
    ),
    h("div", { class: "search-wrap" }, icon("search", 16), searchInput),
    h("ul", { class: "prompt-list", id: "prompt-list", role: "listbox", "aria-label": "Prompts" }),
  );
  renderListItems();
}

function renderListItems() {
  const ul = listCol.querySelector("#prompt-list");
  if (!ul) return;
  clear(ul);
  const items = visiblePrompts();
  if (items.length === 0) {
    ul.append(
      h(
        "li",
        { class: "empty" },
        h("p", null, S.query ? `No prompts match “${S.query}”.` : "No prompts here yet."),
        S.query ? null : h("button", { class: "btn btn-secondary btn-small", onclick: () => void newPrompt() }, "Create a prompt"),
      ),
    );
    return;
  }
  for (const p of items) {
    const selected = p.id === S.selectedId;
    const err = S.ctx.status.hotkey_errors[p.id];
    ul.append(
      h(
        "li",
        {
          class: `prompt-item${selected ? " selected" : ""}`,
          role: "option",
          "aria-selected": selected ? "true" : "false",
          tabIndex: 0,
          dataset: { id: p.id },
          onclick: () => void selectPrompt(p.id),
          onkeydown: (e: KeyboardEvent) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              void selectPrompt(p.id);
            }
          },
        },
        h(
          "div",
          { class: "prompt-item-top" },
          h("span", { class: "prompt-item-title" }, p.title),
          p.favorite ? h("span", { class: "fav", "aria-label": "Favourite" }, icon("star", 13)) : null,
        ),
        h("p", { class: "prompt-item-preview" }, preview(p.body, 110)),
        p.hotkey || p.trigger
          ? h(
              "div",
              { class: "prompt-item-badges" },
              p.hotkey ? h("span", { class: `badge badge-mono${err ? " badge-error" : ""}`, title: err ?? "Global hotkey" }, displayParts(p.hotkey, S.ctx.os).join(" + ")) : null,
              p.trigger ? h("span", { class: "badge badge-mono badge-soft", title: "Text trigger" }, p.trigger) : null,
            )
          : null,
      ),
    );
  }
}

async function selectPrompt(id: string | null) {
  if (id === S.selectedId && S.draft) return;
  if (!(await guardDirty())) return;
  openEditor(id);
  renderListItems();
}

async function newPrompt() {
  if (!(await guardDirty())) return;
  if (S.view.kind === "settings" || S.view.kind === "favorites") setView({ kind: "all" });
  S.selectedId = null;
  openEditor(null, true);
  renderListItems();
}

// ---------------------------------------------------------------- editor

let editorStatusEl: HTMLElement | null = null;
let varsEl: HTMLElement | null = null;
let saveBtn: HTMLButtonElement | null = null;

function draftFrom(p: Prompt | null): Draft {
  const folder = S.view.kind === "folder" ? S.view.id : null;
  return {
    id: p?.id ?? null,
    title: p?.title ?? "",
    body: p?.body ?? "",
    folder_id: p ? p.folder_id : folder,
    tags: p ? [...p.tags] : [],
    favorite: p?.favorite ?? false,
    hotkey: p?.hotkey ?? null,
    trigger: p?.trigger ?? null,
    hotkeyCheck: null,
    triggerCheck: null,
  };
}

function markDirty() {
  S.dirty = true;
  if (saveBtn) saveBtn.disabled = false;
  editorCol.querySelector(".dirty-dot")?.removeAttribute("hidden");
}

function openEditor(id: string | null, isNew = false) {
  S.selectedId = id;
  S.dirty = false;
  clear(editorCol);
  editorStatusEl = null;
  const prompt = id ? S.ctx.prompts.find((p) => p.id === id) ?? null : null;
  if (!prompt && !isNew) {
    S.draft = null;
    editorCol.append(
      h(
        "div",
        { class: "editor-empty" },
        h("div", { class: "editor-empty-icon" }, icon("command", 28)),
        h("h2", null, "Pick a prompt, or create one"),
        h("p", null, "Every prompt can have a global hotkey, a text trigger, or both. All of them show up in the quick palette."),
        h("button", { class: "btn btn-primary", onclick: () => void newPrompt() }, icon("plus", 16), "New prompt"),
      ),
    );
    return;
  }
  const d = (S.draft = draftFrom(prompt));
  const { os } = S.ctx;

  const title = h("input", {
    class: "title-input",
    value: d.title,
    placeholder: "Prompt title",
    "aria-label": "Title",
    maxLength: 200,
    oninput: () => { d.title = title.value; markDirty(); },
  });

  const body = h("textarea", {
    class: "body-input",
    value: d.body,
    placeholder: "Write the prompt you keep retyping…\n\nTip: use {{clipboard}} to include what you just copied, or {{subject}} to be asked for a value.",
    "aria-label": "Prompt body",
    spellcheck: false,
  });
  body.value = d.body;
  const updateVars = debounce(async () => {
    try {
      renderVars(await api.parseVariables(body.value));
    } catch {
      /* ignore */
    }
  }, 200);
  body.addEventListener("input", () => {
    d.body = body.value;
    markDirty();
    updateVars();
    counter.textContent = `${body.value.length.toLocaleString()} chars`;
  });
  const counter = h("span", { class: "label muted" }, `${d.body.length.toLocaleString()} chars`);

  varsEl = h("div", { class: "vars" });

  const favBtn = h(
    "button",
    {
      type: "button",
      class: `btn btn-icon btn-ghost fav-toggle${d.favorite ? " on" : ""}`,
      "aria-pressed": d.favorite ? "true" : "false",
      title: "Favourite",
      "aria-label": "Favourite",
      onclick: () => {
        d.favorite = !d.favorite;
        favBtn.classList.toggle("on", d.favorite);
        favBtn.setAttribute("aria-pressed", String(d.favorite));
        markDirty();
      },
    },
    icon("star", 18),
  );

  const folderSel = h(
    "select",
    {
      class: "input select",
      "aria-label": "Folder",
      onchange: () => { d.folder_id = folderSel.value || null; markDirty(); },
    },
    h("option", { value: "" }, "Unfiled"),
    ...S.ctx.folders.map((f) => h("option", { value: f.id, selected: f.id === d.folder_id }, f.name)),
  );

  const tagsField = tagsInput(d.tags, (tags) => { d.tags = tags; markDirty(); });

  const recorder = createRecorder({
    os,
    value: d.hotkey,
    promptId: d.id ?? null,
    label: "Global hotkey",
    onChange: (accel, check) => {
      d.hotkey = accel;
      d.hotkeyCheck = check;
      markDirty();
      renderEditorStatus();
    },
  });

  const triggerInput = h("input", {
    class: "input mono",
    value: d.trigger ?? "",
    placeholder: ";push",
    "aria-label": "Text trigger",
    maxLength: 32,
    spellcheck: false,
    autocomplete: "off",
  });
  const triggerMsg = h("div", { class: "field-message", "aria-live": "polite" });
  const checkTrigger = debounce(async () => {
    const v = triggerInput.value.trim();
    clear(triggerMsg);
    triggerMsg.className = "field-message";
    if (!v) {
      d.triggerCheck = null;
      return;
    }
    const c = await api.checkTrigger(v, d.id ?? null);
    d.triggerCheck = c;
    if (c.error) {
      triggerMsg.classList.add("is-error");
      triggerMsg.append(icon("alert", 14), " ", c.error);
    } else if (c.warnings.length) {
      triggerMsg.classList.add("is-warning");
      triggerMsg.append(...c.warnings.map((w) => h("div", null, w)));
    }
  }, 180);
  triggerInput.addEventListener("input", () => {
    d.trigger = triggerInput.value.trim() || null;
    markDirty();
    checkTrigger();
    renderEditorStatus();
  });
  if (d.trigger) checkTrigger();

  saveBtn = h("button", { class: "btn btn-primary", disabled: !isNew, onclick: () => void save() }, icon("check", 16), "Save");

  editorStatusEl = h("div", { class: "shortcut-status" });

  editorCol.append(
    h(
      "div",
      { class: "editor" },
      h(
        "div",
        { class: "editor-head" },
        title,
        h("span", { class: "dirty-dot", hidden: true, title: "Unsaved changes", "aria-label": "Unsaved changes" }),
        favBtn,
      ),
      h("div", { class: "meta-row" }, h("label", { class: "meta-field" }, h("span", { class: "label" }, "Folder"), folderSel), h("div", { class: "meta-field grow" }, h("span", { class: "label" }, "Tags"), tagsField)),
      h("div", { class: "body-wrap" }, body, h("div", { class: "body-foot" }, varsEl, counter)),
      h(
        "div",
        { class: "card shortcuts-card" },
        h(
          "div",
          { class: "shortcut-col" },
          h("div", { class: "label" }, "Global hotkey"),
          h("p", { class: "help" }, "Pastes this prompt into whatever app has focus."),
          recorder.el,
        ),
        h(
          "div",
          { class: "shortcut-col" },
          h("div", { class: "label" }, "Text trigger"),
          h("p", { class: "help" }, "Type it anywhere and it expands into the prompt."),
          triggerInput,
          triggerMsg,
        ),
        editorStatusEl,
      ),
      h(
        "footer",
        { class: "editor-foot" },
        saveBtn,
        d.id
          ? h("button", { class: "btn btn-secondary", onclick: () => void copyCurrent(), title: "Copy the rendered prompt" }, icon("copy", 16), "Copy")
          : null,
        d.id ? h("button", { class: "btn btn-ghost", onclick: () => void duplicateCurrent() }, icon("duplicate", 16), "Duplicate") : null,
        h("span", { class: "grow" }),
        d.id ? h("button", { class: "btn btn-ghost btn-danger-text", onclick: () => void deleteCurrent() }, icon("trash", 16), "Delete") : null,
      ),
    ),
  );
  void api.parseVariables(d.body).then(renderVars).catch(() => {});
  renderEditorStatus();
  if (isNew) title.focus();
}

function renderVars(vars: VarSpec[]) {
  if (!varsEl) return;
  clear(varsEl);
  if (!vars.length) {
    varsEl.append(h("span", { class: "help" }, "Built-ins: {{clipboard}} {{date}} {{time}} {{cursor}} · fill-ins: {{name}} {{name=default}} {{name:a|b}}"));
    return;
  }
  varsEl.append(
    h("span", { class: "label" }, "Asks for"),
    ...vars.map((v) =>
      h("span", { class: "chip", title: v.kind === "choice" ? `One of: ${v.options.join(", ")}` : v.default ? `Default: ${v.default}` : "Free text" },
        v.name, v.kind === "choice" ? h("span", { class: "chip-sub" }, `${v.options.length} options`) : v.default ? h("span", { class: "chip-sub" }, `= ${v.default}`) : null),
    ),
  );
}

function renderEditorStatus() {
  if (!editorStatusEl || !S.draft) return;
  const d = S.draft;
  const saved = d.id ? S.ctx.prompts.find((p) => p.id === d.id) : null;
  const { status, settings } = S.ctx;
  clear(editorStatusEl);
  const pill = (kind: "ok" | "warn" | "error" | "muted", text: string) => h("span", { class: `status-pill status-${kind}` }, text);
  const items: HTMLElement[] = [];
  if (settings.paused) {
    items.push(pill("warn", "Shortcuts are paused"));
  } else {
    if (d.hotkey) {
      const err = d.id ? status.hotkey_errors[d.id] : null;
      if (!saved || saved.hotkey !== d.hotkey) items.push(pill("muted", "Hotkey: save to activate"));
      else if (err) items.push(pill("error", `Hotkey not active — ${err}`));
      else items.push(pill("ok", "Hotkey active"));
    }
    if (d.trigger) {
      if (!settings.triggers_enabled) items.push(pill("warn", "Text triggers are off in Settings"));
      else if (status.listener_error) items.push(pill("error", status.listener_error));
      else if (!saved || saved.trigger !== d.trigger) items.push(pill("muted", "Trigger: save to activate"));
      else items.push(pill("ok", "Trigger active"));
    }
  }
  if (!d.hotkey && !d.trigger) items.push(pill("muted", "No shortcut — still available in the quick palette"));
  editorStatusEl.append(...items);
}

function tagsInput(initial: string[], onChange: (tags: string[]) => void): HTMLElement {
  let tags = [...initial];
  const input = h("input", { class: "tags-input", placeholder: "Add tag", "aria-label": "Add tag", maxLength: 40 });
  const wrap = h("div", { class: "input tags", onclick: () => input.focus() });
  const paint = () => {
    clear(wrap);
    for (const t of tags) {
      wrap.append(
        h("span", { class: "chip" }, t, h("button", {
          type: "button", class: "chip-x", "aria-label": `Remove tag ${t}`,
          onclick: (e: Event) => { e.stopPropagation(); tags = tags.filter((x) => x !== t); paint(); onChange(tags); },
        }, "×")),
      );
    }
    wrap.append(input);
  };
  const commit = () => {
    const v = input.value.trim().toLowerCase().replace(/,$/, "");
    input.value = "";
    if (v && !tags.includes(v)) {
      tags = [...tags, v];
      paint();
      onChange(tags);
      input.focus();
    }
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commit();
    } else if (e.key === "Backspace" && !input.value && tags.length) {
      tags = tags.slice(0, -1);
      paint();
      onChange(tags);
      input.focus();
    }
  });
  input.addEventListener("blur", commit);
  paint();
  return wrap;
}

async function save() {
  const d = S.draft;
  if (!d) return;
  if (d.triggerCheck?.error) {
    toast(d.triggerCheck.error, "error");
    return;
  }
  try {
    const p = await api.savePrompt({
      id: d.id,
      title: d.title,
      body: d.body,
      folder_id: d.folder_id,
      tags: d.tags,
      favorite: d.favorite,
      hotkey: d.hotkey,
      trigger: d.trigger,
    });
    S.dirty = false;
    S.selectedId = p.id;
    await load();
    renderSidebar();
    renderList();
    openEditor(p.id);
    toast("Saved", "success");
  } catch (e) {
    toast(errorText(e), "error");
  }
}

async function copyCurrent() {
  if (!S.draft?.id) return;
  try {
    await api.copyPrompt(S.draft.id);
    toast("Copied to clipboard", "success");
  } catch (e) {
    toast(errorText(e), "error");
  }
}

async function duplicateCurrent() {
  if (!S.draft?.id || !(await guardDirty())) return;
  const p = await api.duplicatePrompt(S.draft.id);
  await load();
  renderSidebar();
  renderList();
  openEditor(p.id);
  renderListItems();
  toast("Duplicated — shortcuts are not copied", "success");
}

async function deleteCurrent() {
  const d = S.draft;
  if (!d?.id) return;
  const ok = await confirmDialog({ title: `Delete “${d.title || "Untitled"}”?`, body: "This can't be undone. Export your library in Settings if you want a backup.", confirm: "Delete prompt", danger: true });
  if (!ok) return;
  await api.deletePrompt(d.id);
  S.dirty = false;
  await load();
  renderSidebar();
  renderList();
  openEditor(visiblePrompts()[0]?.id ?? null);
  renderListItems();
  toast("Prompt deleted");
}

// ---------------------------------------------------------------- settings

function renderSettingsView() {
  renderSettings(settingsCol, S.ctx, async () => {
    await load();
    renderSidebar();
  });
}

// ---------------------------------------------------------------- boot

window.addEventListener("keydown", (e) => {
  const mod = S.ctx?.os === "macos" ? e.metaKey : e.ctrlKey;
  if (!mod || e.altKey) return;
  if (e.key.toLowerCase() === "s" && S.view.kind !== "settings") {
    e.preventDefault();
    if (S.draft) void save();
  } else if (e.key.toLowerCase() === "n") {
    e.preventDefault();
    void newPrompt();
  } else if (e.key.toLowerCase() === "f" && S.view.kind !== "settings") {
    e.preventDefault();
    searchInput?.focus();
  }
});

async function boot() {
  const info = await api.getAppInfo().catch(() => ({ version: "0.0.0", os: detectOs(), data_dir: "", session: "" }) as AppInfo);
  S.ctx = { os: info.os, info, prompts: [], folders: [], settings: {} as Settings, status: {} as Status };
  document.documentElement.dataset.os = info.os;
  await load();
  renderSidebar();
  setView({ kind: "all" });

  void on("data-changed", () => void refresh());
  void on("status-changed", () => void refresh());
  void on("prompt-used", () => void load().then(() => { renderSidebar(); if (S.view.kind !== "settings") renderListItems(); }));
  void on<string>("paste-error", (msg) => toast(msg, "error"));

  if (!S.ctx.settings.onboarding_complete) {
    await runOnboarding(S.ctx, async () => {
      await load();
      renderSidebar();
    });
  }
  document.body.classList.add("ready");
}

void boot().catch((e) => {
  root.append(h("pre", { class: "fatal" }, `Shortcut failed to start: ${errorText(e)}`));
});
