// In-memory stand-in for the Rust backend so the UI can be driven in a normal browser.
// Injected with page.addInitScript before the app loads. Every call is recorded in window.__calls.
(() => {
  const opts = Object.assign({ onboarded: true, os: "linux" }, window.__MOCK_OPTS || {});
  let n = 0;
  const id = () => `id-${++n}`;
  const now = () => Date.now();

  const folders = [
    { id: "f-coding", name: "Coding", sort_order: 0 },
    { id: "f-images", name: "Images", sort_order: 1 },
  ];
  const mk = (title, body, extra = {}) => ({
    id: extra.id || id(), title, body, folder_id: null, tags: [], favorite: false, hotkey: null, trigger: null,
    use_count: 0, last_used_at: null, created_at: now(), updated_at: now(), ...extra,
  });
  const prompts = [
    mk("Code review", "Review the following code as a senior engineer.\n\n{{clipboard}}", { id: "p-review", folder_id: "f-coding", tags: ["code", "review"], favorite: true, hotkey: "Ctrl+Alt+1", trigger: ";review" }),
    mk("Commit & push", "Look at my staged and unstaged changes, then push the current branch.", { id: "p-push", folder_id: "f-coding", tags: ["git"], favorite: true, hotkey: "Ctrl+Alt+2", trigger: ";push" }),
    mk("Write tests", "Write thorough unit tests using {{framework=the project's existing test framework}}.\n\n{{clipboard}}", { id: "p-tests", folder_id: "f-coding", trigger: ";tests" }),
    mk("Explain simply", "Explain the following to a smart beginner.\n\n{{clipboard}}", { id: "p-eli5", folder_id: "f-coding", trigger: ";eli5" }),
    mk("Image style: cinematic", "{{subject}}, cinematic lighting, muted {{palette=teal and orange}} palette --ar {{aspect:16:9|1:1|9:16}}", { id: "p-img", folder_id: "f-images", tags: ["image"], hotkey: "Ctrl+Alt+3", trigger: ";img" }),
  ];
  let settings = {
    palette_hotkey: "Ctrl+Shift+Space", paste_method: "clipboard", paste_keystroke: "ctrl_v", restore_clipboard: true,
    restore_delay_ms: 300, triggers_enabled: true, launch_at_login: false, paused: false, onboarding_complete: opts.onboarded,
  };
  const varValues = {};
  let paletteMode = opts.paletteMode || { mode: "search", prompt_id: null };

  const MODS = ["Ctrl", "Alt", "Shift", "Super"];
  function normalize(accel) {
    const parts = accel.split("+").map((s) => s.trim()).filter(Boolean);
    const mods = MODS.filter((m) => parts.some((p) => p.toLowerCase() === m.toLowerCase()));
    const key = parts.find((p) => !MODS.some((m) => m.toLowerCase() === p.toLowerCase()));
    if (!key) throw "Add a key after the modifiers, e.g. Ctrl+Alt+1.";
    if (!mods.some((m) => m !== "Shift")) throw "Add at least one modifier (Ctrl, Alt or Cmd) so normal typing keeps working.";
    return [...mods, key].join("+");
  }
  function hotkeyOwner(accel, exclude, includePalette = true) {
    if (includePalette && settings.palette_hotkey === accel) return "the quick palette";
    const p = prompts.find((x) => x.hotkey === accel && x.id !== exclude);
    return p ? `'${p.title}'` : null;
  }
  function parseVars(body) {
    const out = [];
    const re = /\{\{([^{}\n]*)\}\}/g;
    let m;
    while ((m = re.exec(body))) {
      const inner = m[1].trim();
      if (["clipboard", "date", "time", "datetime", "cursor"].includes(inner.toLowerCase())) continue;
      const eq = inner.indexOf("=");
      const colon = inner.indexOf(":");
      let v;
      if (colon >= 0 && (eq < 0 || colon < eq)) {
        const options = inner.slice(colon + 1).split("|").map((s) => s.trim()).filter(Boolean);
        v = { name: inner.slice(0, colon).trim(), kind: "choice", default: options[0], options };
      } else if (eq >= 0) {
        v = { name: inner.slice(0, eq).trim(), kind: "text", default: inner.slice(eq + 1), options: [] };
      } else {
        v = { name: inner, kind: "text", default: null, options: [] };
      }
      if (v.name && !out.some((x) => x.name === v.name)) out.push(v);
    }
    return out;
  }
  const sorted = () => [...prompts].sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.title.toLowerCase().localeCompare(b.title.toLowerCase()));
  const get = (pid) => {
    const p = prompts.find((x) => x.id === pid);
    if (!p) throw "That prompt no longer exists.";
    return p;
  };

  const handlers = {
    list_prompts: () => sorted(),
    save_prompt: ({ input }) => {
      if (!input.title.trim()) throw "Give the prompt a title.";
      if (!input.body.trim()) throw "The prompt body is empty.";
      const hotkey = input.hotkey ? normalize(input.hotkey) : null;
      if (hotkey) {
        const owner = hotkeyOwner(hotkey, input.id);
        if (owner) throw `${hotkey} is already used by ${owner}.`;
      }
      if (input.trigger && prompts.some((p) => p.trigger === input.trigger && p.id !== input.id)) throw `${input.trigger} is already used.`;
      if (input.id) {
        const p = get(input.id);
        Object.assign(p, { ...input, hotkey, updated_at: now() });
        return p;
      }
      const p = mk(input.title.trim(), input.body, { ...input, id: id(), hotkey });
      prompts.push(p);
      return p;
    },
    delete_prompt: ({ id: pid }) => {
      prompts.splice(prompts.findIndex((p) => p.id === pid), 1);
    },
    duplicate_prompt: ({ id: pid }) => {
      const p = get(pid);
      const d = mk(`${p.title} (copy)`, p.body, { folder_id: p.folder_id, tags: [...p.tags], favorite: p.favorite });
      prompts.push(d);
      return d;
    },
    list_folders: () => folders,
    save_folder: ({ id: fid, name }) => {
      if (!name.trim()) throw "Folder names need 1–60 characters.";
      if (fid) {
        const f = folders.find((x) => x.id === fid);
        f.name = name.trim();
        return f;
      }
      const f = { id: id(), name: name.trim(), sort_order: folders.length };
      folders.push(f);
      return f;
    },
    delete_folder: ({ id: fid }) => {
      folders.splice(folders.findIndex((f) => f.id === fid), 1);
      prompts.forEach((p) => p.folder_id === fid && (p.folder_id = null));
    },
    get_settings: () => settings,
    save_settings: ({ settings: s }) => {
      const palette = normalize(s.palette_hotkey);
      const owner = hotkeyOwner(palette, null, false);
      if (owner) throw `Palette hotkey is already used by ${owner}.`;
      settings = { ...s, palette_hotkey: palette };
      return settings;
    },
    set_paused: ({ paused }) => (settings = { ...settings, paused }),
    check_hotkey: ({ accelerator, promptId, forPalette }) => {
      try {
        const a = normalize(accelerator);
        const owner = hotkeyOwner(a, promptId, !forPalette);
        const warnings = /^Ctrl\+[0-9]$/.test(a) ? ["Ctrl+1…9 switches browser and editor tabs — this hotkey will override it everywhere."] : [];
        return { normalized: a, error: owner ? `${a} is already used by ${owner}.` : null, warnings };
      } catch (e) {
        return { normalized: null, error: String(e), warnings: [] };
      }
    },
    suggest_hotkey: () => ["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((k) => `Ctrl+Alt+${k}`).find((a) => !hotkeyOwner(a, null)),
    check_trigger: ({ trigger, promptId }) => {
      const t = trigger.trim();
      if (t.length < 2) return { normalized: null, error: "Use at least 2 characters, e.g. ;push", warnings: [] };
      if (/\s/.test(t)) return { normalized: null, error: "Triggers can't contain spaces or line breaks.", warnings: [] };
      const other = prompts.find((p) => p.trigger === t && p.id !== promptId);
      return { normalized: t, error: other ? `${t} is already used by '${other.title}'.` : null, warnings: [] };
    },
    get_status: () => ({ paused: settings.paused, triggers_enabled: settings.triggers_enabled, hotkey_errors: opts.hotkeyErrors || {}, listener_error: null, accessibility: opts.os === "macos" ? !!opts.accessibility : null }),
    parse_variables: ({ body }) => parseVars(body),
    get_fill_request: ({ promptId }) => {
      const p = get(promptId);
      return { prompt: p, vars: parseVars(p.body), last_values: varValues[promptId] || {} };
    },
    get_palette_mode: () => paletteMode,
    palette_paste: ({ promptId, values }) => {
      get(promptId).use_count += 1;
      if (values) varValues[promptId] = { ...(varValues[promptId] || {}), ...values };
    },
    copy_prompt: () => null,
    palette_dismiss: () => null,
    open_palette: () => null,
    hide_main: () => null,
    export_data: () => prompts.length,
    import_data: () => ({ prompts_added: 1, prompts_updated: 0, folders_added: 0, warnings: [] }),
    get_app_info: () => ({ version: "0.1.0", os: opts.os, data_dir: "/home/test/.local/share/app.shortcut.desktop", session: "x11" }),
    open_accessibility_settings: () => null,
    "plugin:dialog|save": () => "/tmp/shortcut-prompts.json",
    "plugin:dialog|open": () => "/tmp/import.json",
    "plugin:autostart|is_enabled": () => false,
  };

  const listeners = {};
  let cb = 0;
  window.__calls = [];
  window.__mock = { prompts, folders, get settings() { return settings; }, varValues };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "main" }, currentWebview: { windowLabel: "main", label: "main" } },
    transformCallback(fn, once) {
      const key = ++cb;
      window[`_${key}`] = (payload) => {
        if (once) delete window[`_${key}`];
        return fn(payload);
      };
      return key;
    },
    unregisterCallback(key) {
      delete window[`_${key}`];
    },
    convertFileSrc: (p) => p,
    async invoke(cmd, args = {}) {
      window.__calls.push({ cmd, args: JSON.parse(JSON.stringify(args ?? {})) });
      if (cmd === "plugin:event|listen") {
        (listeners[args.event] ||= []).push(args.handler);
        return args.handler;
      }
      if (cmd === "plugin:event|unlisten") return null;
      const h = handlers[cmd];
      if (!h) throw `mock: unknown command ${cmd}`;
      try {
        const r = h(args);
        return r === undefined ? null : JSON.parse(JSON.stringify(r));
      } catch (e) {
        throw typeof e === "string" ? e : String(e);
      }
    },
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  window.__emit = (event, payload) => {
    for (const h of listeners[event] || []) window[`_${h}`]?.({ event, id: 0, payload });
  };
  window.__setPaletteMode = (m) => (paletteMode = m);
})();
