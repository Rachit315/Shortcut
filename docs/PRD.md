# Clazy — Product Requirements Document

| | |
|---|---|
| **Product** | Clazy — a prompt & snippet launcher for people who use AI tools daily |
| **Status** | MVP in build (this repository) |
| **Owner** | Product + Engineering |
| **Last updated** | 2026-09-26 |

---

## 1. Overview & vision

**Vision.** Your best prompts should be one keystroke away, in every app you use. Clazy is a small background app that stores the prompts you reuse and pastes any of them into whatever text field has focus: ChatGPT, Claude, Cursor, VS Code, a terminal, Slack, or a browser form. You can trigger a prompt with a global hotkey (`Ctrl+Alt+1`), a typed abbreviation (`;push`), or a searchable palette (`Ctrl+Shift+Space`). Clazy is local-first and private by default, and is built specifically for AI prompts: fill-in variables, a cursor marker, and prompt packs. It does not try to be a general automation tool.

### Problem statement

People who work with AI assistants reuse a small set of long, carefully tuned prompts many times a day. Examples: "commit and push my code with a conventional commit message…", "review this diff for bugs, security issues and missing tests…", "generate an image in this style: …". Today those prompts are:

- **Retyped**, which is slow and produces worse results each time the wording drifts.
- **Copy-pasted from notes**, which costs 10–30 seconds and a context switch per use.
- **Lost**: the best-performing versions live in old chat threads and are never found again.

General text expanders exist, but they are configured with YAML or scripts, are priced for businesses, or are not designed for multi-paragraph prompts with fill-in values.

---

## 2. Goals, non-goals & success metrics

### Goals (MVP)

1. Paste any saved prompt into any focused text field in **under 150 ms** after the trigger.
2. Offer **three ways to trigger** a prompt: per-prompt global hotkey, typed text trigger, and a searchable quick palette.
3. Get a new user from install to first successful paste **within 2 minutes**.
4. Keep all data **on the device by default**, with no account and no network calls.
5. Ship **installable builds for Windows, macOS and Linux (X11)** from a single codebase.

### Non-goals (MVP)

- Cloud sync, accounts, teams or sharing (planned for later phases).
- Running AI models or calling AI APIs.
- General macro automation (mouse moves, app launching, scripting).
- Native Wayland support for global hotkeys or injection (XWayland only; see Risks).
- Mobile apps.

### Success metrics

| Metric | Definition | MVP target |
|---|---|---|
| Activation | % of installs that paste ≥ 1 prompt within 24 h | ≥ 60 % |
| Time-to-first-paste | Median time from first launch to first paste | < 2 min |
| Daily usage | Median prompts pasted per active user per day | ≥ 5 |
| D7 retention | % of activated users who paste on day 7 | ≥ 35 % |
| Time saved | (avg prompt length ÷ 40 wpm typing) × pastes, shown in-app | ≥ 10 min / user / week |
| Reliability | % of triggers that result in a successful paste (self-reported bug rate) | ≥ 99 % |
| Performance | p95 trigger→paste latency on reference hardware | < 150 ms |

Because the app is private by default, metrics come from **opt-in** anonymous telemetry (post-MVP) and from local in-app counters that the user can see. The MVP ships with **no telemetry**.

---

## 3. Personas & user stories

### Personas

| Persona | Who | Daily prompts | Key need |
|---|---|---|---|
| **Dev Priya** | Full-stack developer using Claude Code, Cursor and ChatGPT | "Review this diff", "Write tests for…", "Commit & push with a conventional message" | Paste into the IDE chat *and* the terminal without leaving the keyboard |
| **Creator Marco** | Designer generating images in Midjourney and DALL·E | Style prompts with swapped subjects, aspect ratios and seeds | Reuse a style with a different subject each time (fill-in variables) |
| **Ops Sam** | Support lead / power user | Canned replies, summarise-this-ticket prompts | Many prompts, quick to find by search rather than memorised keys |

### User stories & acceptance criteria

| ID | Story | Acceptance criteria |
|---|---|---|
| US-1 | As Priya, I save a prompt once so I never retype it. | Create a prompt with title + body; it persists across app restarts; appears in the library immediately. |
| US-2 | As Priya, I press `Ctrl+Alt+1` in Cursor's chat box and the review prompt appears. | With focus in any text field, the prompt body is inserted at the caret in < 150 ms; the original clipboard is restored afterwards. |
| US-3 | As Priya, I type `;push` in my terminal and it expands to the push prompt. | The 5 typed characters are deleted and replaced by the prompt; works in terminals with the "terminal-friendly" paste keystroke enabled. |
| US-4 | As Sam, I press `Ctrl+Shift+Space`, type "refund", press Enter, and the matching prompt is pasted. | The palette opens centred on the active monitor, filters as I type, supports ↑/↓/Enter/Esc, and returns focus to the previous app before pasting. |
| US-5 | As Marco, I trigger my style prompt and am asked for `{{subject}}` before it is pasted. | A small form lists each fill-in variable once; defaults and last-used values are pre-filled; Enter pastes; Esc cancels without pasting. |
| US-6 | As Priya, I set a hotkey that is already used by the OS or another prompt, and I'm warned. | Duplicate combos are blocked; known OS/app combos (e.g. `Ctrl+1`, `Cmd+Q`) show a warning; a failed OS registration is shown next to the prompt. |
| US-7 | As any user, I export my prompts and import them on another machine. | Export to JSON (lossless) and Markdown; importing JSON restores prompts, folders, tags, hotkeys and triggers; conflicting shortcuts are dropped with a report. |
| US-8 | As any user, Clazy starts with my computer and stays out of the way. | Optional launch-at-login; lives in the tray/menu bar; closing the window hides it; idle memory < 120 MB. |
| US-9 | As any user, I can pause all shortcuts, for example while gaming or screen-sharing. | Tray → "Pause shortcuts" disables hotkeys and triggers until resumed; the state persists across restarts. |

---

## 4. Functional requirements

Priorities: **P0** = MVP blocker, **P1** = MVP if time allows, **P2** = later phase.

### 4.1 Prompt library

| ID | Requirement | Priority | Acceptance criteria |
|---|---|---|---|
| LIB-1 | Create, edit, delete and duplicate prompts (title, body). | P0 | CRUD persists to SQLite; delete asks for confirmation; duplicate appends " (copy)" and drops the hotkey and trigger (they must be unique). |
| LIB-2 | Organise prompts in folders. | P0 | Create/rename/delete folders; deleting a folder moves its prompts to "Unfiled". |
| LIB-3 | Tag prompts (free-form, lower-cased, deduplicated). | P0 | Tags are editable as chips; the library can filter by tag. |
| LIB-4 | Favourite prompts. | P0 | Star toggle; "Favourites" view; favourites rank first in the palette. |
| LIB-5 | Search prompts by title, body, tags and trigger. | P0 | Results update as you type (< 50 ms for 1,000 prompts). |
| LIB-6 | Starter prompt pack on first run. | P0 | 5 useful prompts (code review, commit & push, write tests, explain code, image style) that the user can delete. |
| LIB-7 | Usage counter and "last used". | P1 | Increments on every successful paste; sortable in the library. |
| LIB-8 | Very long prompts. | P0 | Bodies up to 100,000 characters are accepted and pasted intact; the editor stays responsive. |

### 4.2 Global hotkeys

| ID | Requirement | Priority | Acceptance criteria |
|---|---|---|---|
| HK-1 | Assign an optional global hotkey per prompt with a key recorder. | P0 | Recorder captures modifiers + one key; Esc cancels; Backspace clears. |
| HK-2 | Require at least one modifier (Ctrl/Alt/Shift/Cmd), with Shift-only disallowed. | P0 | `A` or `Shift+A` is rejected with an explanation (it would block normal typing). |
| HK-3 | Block duplicate hotkeys across prompts and the palette hotkey. | P0 | Saving a duplicate fails with "Already used by '<prompt>'". |
| HK-4 | Warn about well-known OS/app conflicts. | P0 | A built-in table per OS (e.g. `Ctrl+1..9` browser tabs, `Ctrl+C/V/X/Z/A/S`, `Cmd+Q/W/Tab`, `Alt+F4`, `Win+L`) shows a non-blocking warning. |
| HK-5 | Surface OS registration failures. | P0 | If the OS refuses a combo (already grabbed by another app), the prompt shows a "not active" badge with the reason. |
| HK-6 | Suggested defaults. | P1 | The recorder suggests the next free `Ctrl+Alt+<n>` (`Ctrl+Option+<n>` on macOS). |
| HK-7 | Fire on key release, after modifiers are released. | P0 | Held modifiers never leak into the injected paste (for example `Ctrl+Alt+V`). |

### 4.3 Text triggers (text expansion)

| ID | Requirement | Priority | Acceptance criteria |
|---|---|---|---|
| TT-1 | Assign an optional unique trigger per prompt (2–32 chars, no whitespace). | P0 | Validation errors are shown inline; a leading symbol such as `;` is recommended. |
| TT-2 | Expand when the typed sequence ends with the trigger. | P0 | The trigger text is erased with backspaces, then the prompt is pasted. |
| TT-3 | Reset the typing buffer on navigation. | P0 | Enter, Tab, Esc, arrow keys, mouse clicks and modifier chords clear the buffer, so no stale matches occur. |
| TT-4 | Ignore Clazy's own injected keystrokes. | P0 | No recursive expansion. |
| TT-5 | Global on/off switch. | P0 | Settings → "Text triggers" stops all keystroke processing immediately; the OS keyboard listener is never started while triggers are off. |
| TT-6 | Prefix-conflict detection. | P1 | Warn when one trigger is a suffix of another (`;p` vs `;push`). |

### 4.4 Quick palette

| ID | Requirement | Priority | Acceptance criteria |
|---|---|---|---|
| PAL-1 | A configurable global hotkey (default `Ctrl+Shift+Space`) toggles the palette. | P0 | Opens in < 100 ms, always on top, centred on the monitor containing the cursor. |
| PAL-2 | Fuzzy search with keyboard navigation. | P0 | ↑/↓ move, Enter pastes, Esc closes; ranking = match quality, then favourite, then usage count. |
| PAL-3 | Return focus to the previous app, then paste. | P0 | The palette hides and focus returns before injection (macOS: the app is hidden; Windows/Linux: the window is hidden). |
| PAL-4 | Show each prompt's hotkey and trigger in results. | P1 | This helps users learn the faster path. |
| PAL-5 | Copy instead of paste. | P1 | `Ctrl/Cmd+Enter` copies the rendered prompt to the clipboard without pasting. |

### 4.5 Paste mechanism

| ID | Requirement | Priority | Acceptance criteria |
|---|---|---|---|
| PST-1 | Clipboard paste. | P0 | Save clipboard text → write prompt → send `Cmd+V` (macOS) / `Ctrl+V` → wait → restore the original clipboard. |
| PST-2 | Configurable paste keystroke on Windows/Linux. | P0 | Options: `Ctrl+V` (default), `Ctrl+Shift+V` (terminals), `Shift+Insert`. |
| PST-3 | "Type it out" fallback mode. | P0 | For apps that block synthetic paste, the text is typed character by character. |
| PST-4 | Configurable restore delay. | P0 | Default 300 ms (range 50–2,000 ms); restoring can be disabled. |
| PST-5 | Secure and password fields. | P0 | The OS blocks synthetic input into secure fields (macOS Secure Input). Clazy detects that the paste had no effect only where the OS exposes it; otherwise it is documented as a known limitation, and the clipboard still holds the prompt so the user can paste manually. |
| PST-6 | Non-text clipboard content. | P1 | If the clipboard holds an image or files, it is not restored (text-only restore); the user is told once. |

### 4.6 Variables

| ID | Requirement | Priority | Acceptance criteria |
|---|---|---|---|
| VAR-1 | Built-in variables: `{{clipboard}}`, `{{date}}`, `{{time}}`, `{{datetime}}`, `{{cursor}}`. | P0 | Resolved at paste time; `{{clipboard}}` = clipboard text before paste; date = `YYYY-MM-DD`, time = `HH:MM` (local). |
| VAR-2 | `{{cursor}}` places the caret after paste. | P0 | The caret is moved left by the number of characters after the marker (first marker only; others are removed). |
| VAR-3 | Fill-in variables: `{{name}}`, `{{name=default}}`, `{{name:opt1\|opt2}}`. | P0 | Each unique name is asked once in a form; `=default` pre-fills; `:a\|b` renders a dropdown. |
| VAR-4 | Remember the last value per prompt + variable. | P1 | The form pre-fills the last value used. |
| VAR-5 | Malformed or unknown syntax is left as-is. | P0 | `{{ }}` and unclosed `{{` are pasted literally; no errors. |
| VAR-6 | The editor shows detected variables. | P1 | Variable chips appear below the body editor. |

### 4.7 Import / export

| ID | Requirement | Priority | Acceptance criteria |
|---|---|---|---|
| IO-1 | Export everything to JSON (versioned schema). | P0 | Round-trip is lossless (except usage stats). |
| IO-2 | Export to Markdown. | P0 | One `##` section per prompt with a YAML-like metadata block and a fenced body. |
| IO-3 | Import JSON and Markdown. | P0 | Merge by default; duplicates by ID are updated; conflicting hotkeys/triggers are dropped and reported. |

### 4.8 App shell

| ID | Requirement | Priority | Acceptance criteria |
|---|---|---|---|
| APP-1 | Tray / menu-bar icon with Open, Quick palette, Pause/Resume, Quit. | P0 | Present on all platforms; no dock icon on macOS. |
| APP-2 | Closing the main window hides it. | P0 | Quit only from the tray or `Cmd/Ctrl+Q` in the app. |
| APP-3 | Launch at login (opt-in during onboarding). | P0 | Uses OS-native autostart (LaunchAgent / Registry Run key / XDG autostart). |
| APP-4 | Single instance. | P0 | A second launch focuses the existing window. |
| APP-5 | Permission status (macOS Accessibility). | P0 | Settings and onboarding show whether the permission is granted, with a button to open System Settings. |

### 4.9 Edge cases (explicit)

| Case | Behaviour |
|---|---|
| Hotkey already grabbed by another app | Registration fails → prompt shows "not active: already in use"; the user chooses another combo. |
| Browser `Ctrl+1..9` | Warned at record time; defaults use `Ctrl+Alt+<n>`. |
| Password / secure input fields | macOS Secure Input blocks both the listener and injection; triggers will not fire. The palette still copies to the clipboard. Documented in the FAQ. |
| Apps that block synthetic paste (some remote desktops, games, VMs) | Switch to "Type it out" mode (PST-3). |
| Terminals where `Ctrl+V` is not paste (Linux) | Use the `Ctrl+Shift+V` or `Shift+Insert` paste keystroke. |
| Multi-monitor | The palette opens on the monitor under the mouse cursor. |
| Non-English keyboard layouts | Triggers match the *produced characters* (layout-aware), not physical keys. Hotkeys are registered by key code, so `Ctrl+Alt+1` is the physical "1" key. On layouts where `Ctrl+Alt` = AltGr (e.g. German, Polish), `Ctrl+Alt+<key>` can clash with typing characters; the recorder warns, and `Ctrl+Shift+<n>` is recommended. |
| Dead keys / IME composition (CJK) | Composed text is not matched as a trigger; hotkeys and the palette are unaffected. |
| Very long prompts (≥ 10k chars) | Clipboard mode is used even if "type it out" is set (typing would take too long); a warning is shown in the editor. |
| Clipboard holds image/files | Not restored (PST-6). |
| Rapid double trigger | A new paste is ignored while one is in progress (single-flight lock). |
| Linux Wayland session | Global hotkeys and injection work only for XWayland apps; a banner explains this on first run. |

---

## 5. Non-functional requirements

| Area | Requirement |
|---|---|
| **Performance** | Trigger→paste p95 < 150 ms (clipboard mode). Palette open < 100 ms. Cold start < 1.5 s. Library search < 50 ms at 1,000 prompts. |
| **Footprint** | Installer < 15 MB. Idle RAM < 120 MB with the main window hidden. Idle CPU ≈ 0 % (event-driven, no polling). |
| **Privacy** | All data is stored in a local SQLite file in the OS app-data directory. No network requests in the MVP. No telemetry. The keyboard listener keeps only the last 64 typed characters in memory and never writes keystrokes to disk or logs; it is not started at all while text triggers are disabled. |
| **Security** | Tauri capability allow-list: the UI can only call Clazy's own commands. CSP blocks remote scripts. Import files are parsed with strict schema validation and size limits (10 MB). Release binaries are code-signed (macOS notarised, Windows Authenticode) once certificates are available. |
| **Reliability** | The SQLite database uses WAL mode with a schema migration table. Crash-safe writes. The clipboard is always restored, even if injection fails. |
| **Accessibility** | Full keyboard operation of every screen. Visible focus rings. WCAG AA contrast (text `#111827` on `#FFFFFF`, primary `#3B82F6` used for large text/controls only, with `#1D4ED8` for small text). Respects `prefers-reduced-motion`. Screen-reader labels on icon buttons. |
| **Compatibility** | Windows 10 (1809)+, macOS 11+ (Apple Silicon + Intel universal build), Ubuntu 22.04+/Fedora 38+ on X11. |
| **Localisation** | English UI at launch; all strings centralised for later translation. |

---

## 6. Platform strategy

| Option | Reach | Can paste into terminals/IDEs/desktop apps? | Build effort | Verdict |
|---|---|---|---|---|
| **(a) Cross-platform desktop app** | Every app on the computer | ✅ Yes, system-wide hotkeys + injection | Medium (OS permissions, native input) | **✅ MVP** |
| (b) Browser extension | Browser tabs only | ❌ No terminal, IDE or native apps | Low | Companion, post-MVP |
| (c) IDE extension (VS Code) | One editor | ❌ Only VS Code and its forks | Low | Companion, post-MVP |

**Recommendation: (a) a desktop tray app.** The main pain point is switching *between* tools (ChatGPT in the browser, Claude Code in the terminal, Cursor). Only a system-wide app covers all of them from one prompt library. Extensions can later be thin clients that read the same library (via sync).

---

## 7. Tech stack

### Tauri 2 vs Electron

| | **Tauri 2** | Electron |
|---|---|---|
| Installer size | ~5–12 MB | ~80–150 MB |
| Idle RAM | ~40–80 MB (system webview) | ~150–300 MB (bundled Chromium) |
| Native access | Rust: direct access to OS APIs and crates | Node native modules (rebuild per Electron version) |
| Security model | Capability allow-list per window | Must be hardened manually |
| Cross-platform CI | `tauri-action` builds signed Win/macOS/Linux bundles | electron-builder, similar |
| Webview differences | WebView2 / WKWebView / WebKitGTK render slightly differently | Identical Chromium everywhere |

**Decision: Tauri 2.** A tray app that runs all day must be light. The paste pipeline (hotkeys, keyboard hooks, input injection) is native work that Rust does well. Webview differences are manageable for a simple UI.

### Components

| Concern | Choice | Notes |
|---|---|---|
| App shell | Tauri 2 (Rust) | Tray, windows, IPC, bundling |
| UI | Vite + TypeScript (no framework) | Small bundle, fast start; fonts bundled locally via Fontsource |
| Global hotkeys | `tauri-plugin-global-shortcut` (wraps `global-hotkey`) | RegisterHotKey (Win), Carbon hotkeys (macOS), XGrabKey (X11) |
| Keystroke injection | `enigo` 0.6 | SendInput (Win), CGEvent (macOS), XTest (X11) |
| Clipboard | `arboard` | One long-lived instance, so X11 ownership is kept while needed |
| Keyboard listener (triggers) | `rdev` on Windows/Linux; a small **native CGEventTap** module on macOS | rdev's macOS key-name translation calls Text Input Source APIs off the main thread, which crashes on macOS 14+. The macOS module reads characters with `CGEventKeyboardGetUnicodeString`, which is thread-safe and layout-aware. |
| Storage | SQLite via `rusqlite` (bundled) | WAL, migrations via `user_version` |
| Autostart | `tauri-plugin-autostart` | |
| Single instance | `tauri-plugin-single-instance` | |
| File dialogs | `tauri-plugin-dialog` | Import/export paths |
| Tests | `cargo test` (core logic), Vitest (UI logic), Playwright (UI flows with mocked IPC), Xvfb + xdotool (real end-to-end paste on Linux) | |
| CI/CD | GitHub Actions + `tauri-action` | Draft release with `.dmg` (universal), `.msi`/`-setup.exe`, `.AppImage`/`.deb` |

### OS permissions

| OS | Permission | Why | UX |
|---|---|---|---|
| macOS | **Accessibility** (System Settings → Privacy & Security → Accessibility) | Injecting `Cmd+V` and listening to keys for triggers | Onboarding step checks `AXIsProcessTrusted`, deep-links to the pane, and re-checks on focus |
| macOS | Input Monitoring (may be requested for the event tap on some versions) | Text triggers | Requested only when triggers are enabled |
| Windows | None (SmartScreen warning until signed) | — | FAQ explains "More info → Run anyway" for unsigned builds |
| Linux | X11 session; `libxdo`/XTest present | Injection + hotkeys | Wayland banner |

---

## 8. Data model

SQLite, `PRAGMA user_version = 1`.

```text
Folder
  id           TEXT PK (UUID v4)
  name         TEXT NOT NULL
  sort_order   INTEGER NOT NULL DEFAULT 0
  created_at   INTEGER (unix ms)

Prompt
  id           TEXT PK (UUID v4)
  title        TEXT NOT NULL (1–200 chars)
  body         TEXT NOT NULL (≤ 100,000 chars)
  folder_id    TEXT NULL → Folder.id (ON DELETE SET NULL)
  tags         TEXT NOT NULL DEFAULT '[]'   -- JSON array of lower-case strings
  favorite     INTEGER NOT NULL DEFAULT 0   -- bool
  hotkey       TEXT NULL UNIQUE             -- Shortcut (normalised accelerator, e.g. "Ctrl+Alt+1")
  trigger      TEXT NULL UNIQUE             -- Shortcut (text trigger, e.g. ";push")
  use_count    INTEGER NOT NULL DEFAULT 0
  last_used_at INTEGER NULL
  created_at   INTEGER NOT NULL
  updated_at   INTEGER NOT NULL

VariableValue          -- remembered fill-in values (Variable definitions are parsed from body)
  prompt_id    TEXT → Prompt.id (ON DELETE CASCADE)
  name         TEXT
  value        TEXT
  PRIMARY KEY (prompt_id, name)

Settings               -- single JSON row (key = 'settings')
  palette_hotkey      string   default "Ctrl+Shift+Space"
  paste_method        "clipboard" | "type"             default "clipboard"
  paste_keystroke     "ctrl_v" | "ctrl_shift_v" | "shift_insert"  default "ctrl_v" (ignored on macOS)
  restore_clipboard   bool     default true
  restore_delay_ms    int      default 300
  triggers_enabled    bool     default true
  launch_at_login     bool     default false
  paused              bool     default false
  onboarding_complete bool     default false
```

**Shortcut** (logical entity) = `{ kind: "hotkey" | "trigger", value, prompt_id }`. It is stored as the unique `hotkey` / `trigger` columns on Prompt, plus `Settings.palette_hotkey`. Uniqueness is enforced by the database and checked in the UI.

**Variable** (parsed, not stored) = `{ name, kind: "builtin" | "text" | "choice", default?: string, options?: string[] }`.

### Export schema (JSON)

```json
{
  "app": "shortcut",
  "version": 1,
  "exported_at": "2026-09-26T12:00:00Z",
  "folders": [{ "id": "…", "name": "Coding" }],
  "prompts": [{ "id": "…", "title": "…", "body": "…", "folder_id": "…",
                "tags": ["git"], "favorite": true, "hotkey": "Ctrl+Alt+1", "trigger": ";push" }]
}
```

---

## 9. UX

Visual language follows `design/tokens.css`:

- **Colours:** white surfaces, `#111827` text, `#3B82F6` primary, `#EF4444` accent/destructive, `#E5E7EB` borders.
- **Radius:** 23 px on cards and controls.
- **Type:** Inter for display and UI, Playfair Display for body copy, JetBrains Mono for labels, shortcuts and prompt bodies.

### Screens

1. **Library (main window)**, three columns:
   - **Sidebar:** All prompts, Favourites, folders (+ new), Settings, and a Pause toggle at the bottom.
   - **List:** search field (`Ctrl/Cmd+F`), "New prompt" button (`Ctrl/Cmd+N`), and rows showing the title, a one-line body preview, and hotkey/trigger badges in mono pills.
   - **Editor:** the selected prompt.
2. **Editor:**
   - Fields: title, a large monospace body editor, and detected variable chips below it.
   - Metadata row: folder select, tag chips, favourite star.
   - "Shortcuts" card: hotkey recorder and trigger field, each with inline validation, conflict warnings and a status badge (active / not active).
   - Footer: Save (`Ctrl/Cmd+S`), Duplicate, Delete, and "Copy rendered".
3. **Shortcut recorder:**
   - An inline control that reads "Click to record".
   - While recording, it shows pressed modifiers live (`Ctrl + Alt + …`) with a pulsing primary border.
   - Esc cancels, Backspace clears.
   - Shows errors (red) or warnings (amber text using the accent colour family).
4. **Quick palette:** a separate frameless, transparent window, 640×420, with:
   - a large search input;
   - a result list (title, preview, badges), with the selected row highlighted with a primary tint;
   - a footer legend (`↵ paste · ⌘↵ copy · esc close`).
   - When a prompt has fill-in variables, the palette switches to a form (one field per variable) with a "Paste" button.
5. **Settings:**
   - Palette hotkey
   - Paste method
   - Paste keystroke (Windows/Linux)
   - Restore clipboard + delay
   - Text triggers toggle
   - Launch at login
   - Import / Export
   - macOS Accessibility status
   - About (version, data folder path)
6. **Onboarding (first run)**, a 4-step modal over the library:
   1. **Welcome:** "Your best prompts, one keystroke away." Shows what the app does in three lines.
   2. **Permissions (macOS only):** Accessibility status with an "Open System Settings" button, re-checked live.
   3. **Try it:** shows the starter pack and the palette hotkey, and asks the user to press it and paste into a practice text box in the modal.
   4. **Finish:** launch-at-login toggle, then "Start using Clazy", which hides the window to the tray.

### First-run flow

Install → launch → main window opens with onboarding → (macOS) grant Accessibility → practice paste succeeds (success state turns the step green) → enable launch at login (optional) → window hides to tray with a notification: "Clazy is running in the tray. Press Ctrl+Shift+Space anytime."

---

## 10. Competitive analysis

| Product | Price | Strengths | Gaps for AI-prompt users |
|---|---|---|---|
| **Espanso** | Free, OSS | Fast, cross-platform text expansion | Configured through YAML files; no GUI library; no per-snippet hotkeys; forms need YAML |
| **TextExpander** | ~$40–$50/user/yr | Polished, teams, fill-ins | Subscription; account required; business-focused |
| **Raycast snippets** | Free (macOS / Windows beta) | Great launcher UX | Part of a large launcher; no Linux; no per-snippet global hotkeys |
| **AutoHotkey** | Free, OSS | Unlimited power | Windows only; requires scripting |
| **PhraseExpress** | Free personal / paid | Feature-rich | Complex UI; Windows/macOS only |
| **Alfred** | Powerpack £34+ | Snippets + launcher | macOS only; paid for snippets |

**Differentiation:**

1. **Built for AI prompts:** long multi-paragraph bodies, fill-in forms, `{{clipboard}}` for "apply this prompt to what I just copied", and a starter pack for coding and image generation.
2. **Three triggers in one small app:** per-prompt hotkeys, text triggers and a palette. Competitors usually offer one or two.
3. **Zero config:** a GUI-first library with no YAML and no account.
4. **Free, open-source core**, local-first and cross-platform, including Linux.

---

## 11. Monetisation

**Recommendation: open-source core + optional "Pro" subscription for cloud features (post-MVP).**

| Tier | Price | Includes |
|---|---|---|
| **Free (OSS, MIT)** | $0 | Everything in the MVP: unlimited prompts, hotkeys, triggers, palette, variables, import/export |
| **Pro** | $4/mo or $36/yr | End-to-end-encrypted sync across devices, browser & VS Code companions, prompt version history, curated prompt packs |
| **Team** (later) | $8/user/mo | Shared folders, admin-managed packs, SSO |

Rationale: the local tool must be free to compete with Espanso and to earn trust for an app that listens to the keyboard. Sync has real ongoing costs and is where users see value in paying.

---

## 12. Release plan

| Milestone | Scope | Exit criteria |
|---|---|---|
| **MVP (v0.1)** | LIB-1…6, HK-1…5/7, TT-1…5, PAL-1…3, PST-1…5, VAR-1…3/5, IO-1…3, APP-1…5, onboarding, landing page, CI builds for Win/macOS/Linux | E2E paste test green on Linux CI; manual smoke test on Win 11 + macOS 14; installers on GitHub Releases |
| **v1.0** | P1s (usage stats, remembered values, palette copy, suffix warnings, "time saved" counter), code signing + notarisation, auto-update (`tauri-plugin-updater`), opt-in anonymous telemetry, localisation scaffold | D7 retention ≥ 35 % for beta cohort; crash-free sessions ≥ 99.5 % |
| **v2.0** | Pro: E2E-encrypted sync + accounts, browser extension, VS Code extension, prompt packs gallery, AI "improve this prompt" (bring-your-own key), per-app paste settings | 3 % free→Pro conversion target |
| **v3.0** | Teams, mobile keyboard (iOS/Android), prompt version history | — |

---

## 13. Risks, open questions & assumptions

### Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| macOS permission friction (Accessibility / Input Monitoring) reduces activation | High | High | Guided onboarding step with live status; the palette + copy path works without permissions |
| Wayland blocks global hotkeys and injection | High on modern Linux | Medium | XWayland support + clear banner; investigate `xdg-desktop-portal` GlobalShortcuts + libei in v1 |
| Antivirus / SmartScreen flags an unsigned keyboard-listening app | Medium | High | Code-sign ASAP; open source; the listener is disabled when triggers are off |
| Clipboard restore race (target app reads clipboard late) | Medium | Medium | Configurable delay (default 300 ms); "type it out" fallback |
| Keyboard layouts / IMEs break trigger matching | Medium | Low | Layout-aware character matching; document IME limitations |
| Users are wary of a keyboard-listening app | Medium | High | Local-only, no network, OSS, a 64-char in-memory buffer, clear privacy copy on the landing page |

### Open questions

1. Should triggers require a word boundary before them (`a;push` not expanding)? *Current decision: no boundary (matches Espanso); revisit after beta feedback.*
2. Per-app paste keystroke rules (auto-detect terminals)? *Deferred to v2; a global setting for now.*
3. Should the palette support "run in sequence" (multiple prompts)? *Out of scope.*
4. Pricing validation for Pro. *Survey beta users.*

### Assumptions

- Target users mainly paste into text fields that accept standard OS paste.
- Most users have fewer than 200 prompts; the UI is optimised for that, and performance targets hold up to 1,000.
- Users accept a one-time macOS permission prompt when the reason is explained clearly.
