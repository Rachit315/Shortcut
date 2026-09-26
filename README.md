# Shortcut

**Your best prompts, one keystroke away.**

Shortcut is a small desktop app that saves the prompts you reuse every day and pastes them into any app: ChatGPT, Claude, Cursor, VS Code, your terminal, Slack. There are three ways to trigger a prompt:

| | How | Example |
|---|---|---|
| **Global hotkey** | One key combo per prompt | `Ctrl+Alt+1` → code-review prompt |
| **Text trigger** | Type a short abbreviation anywhere | `;push` → "commit & push" prompt |
| **Quick palette** | Search every prompt, press Enter | `Ctrl+Shift+Space` → type "review" |

Prompts can contain variables:

- `{{clipboard}}`: what you just copied
- `{{date}}`, `{{time}}`: the current date and time
- `{{cursor}}`: where the caret should land after pasting
- `{{subject}}`, `{{lang=Python}}`, `{{tone:formal|casual}}`: fill-ins that Shortcut asks you for before pasting

Everything stays on your computer. There's no account, no network requests and no telemetry.

- 📄 Product spec: [`docs/PRD.md`](docs/PRD.md)
- 🌐 Landing page: [`site/`](site/)
- 💻 Desktop app: [`app/`](app/) (Tauri 2 + Rust + TypeScript)

## Download

Grab the installer for your system from the [latest release](https://github.com/Rachit315/Shortcut/releases/latest):

- **macOS**: `.dmg` (universal). On first launch, allow Shortcut in *System Settings → Privacy & Security → Accessibility*.
- **Windows**: `…-setup.exe` or `.msi`. The builds aren't code-signed yet. If SmartScreen appears, choose *More info → Run anyway*.
- **Linux**: `.deb` or `.AppImage`. Global hotkeys and pasting need an X11 session.

## Develop

Prerequisites:

- Node 20+ and Rust (stable).
- On Linux, the Tauri system libraries:

  ```bash
  sudo apt install libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev libxdo-dev libxtst-dev patchelf
  ```

Run the app in dev mode:

```bash
cd app
npm ci
npm run tauri dev          # run the app with hot reload
```

To test with a throwaway library instead of your real one, set `SHORTCUT_DATA_DIR=/tmp/shortcut-dev`.

### Tests

```bash
cd app
npm test                   # Vitest: key handling, search ranking, template preview
npm run test:rust          # cargo test: templates, hotkeys, triggers, database, import/export
npx playwright test        # UI flows (mocked backend) + landing page
npx tauri build --no-bundle && npm run e2e:desktop   # real end-to-end test (Linux, needs Xvfb, xdotool, xclip, python3-tk)
```

The end-to-end test starts the real binary on a virtual X display. It then presses hotkeys, types triggers and uses the palette with `xdotool`, and checks what lands in a separate text-editor window. It covers:

- global hotkeys
- text triggers
- `{{cursor}}` and `{{clipboard}}`
- restoring your clipboard after a paste
- the palette's search and fill-in form
- usage stats

CI runs all of the above on every push (see `.github/workflows/ci.yml`).

### Design tokens

`design/tokens.json` is the single source for colours, type, spacing and radii. After editing it, run `node design/build-tokens.mjs` to regenerate `app/src/styles/tokens.css` and `site/assets/tokens.css`. CI fails if they drift.

## Release

```bash
# bump "version" in app/src-tauri/tauri.conf.json and app/src-tauri/Cargo.toml, then:
git tag v0.1.0 && git push origin v0.1.0
```

`.github/workflows/release.yml` builds macOS (universal), Windows and Linux installers and publishes them to GitHub Releases. The landing page reads the latest release from the GitHub API, so its download buttons update automatically.

## Landing page

`site/` is a static page with no build step. `.github/workflows/pages.yml` deploys it to GitHub Pages on every push to `main`. To enable it, go to *Settings → Pages → Source* and choose **GitHub Actions**. Any static host (Vercel, Netlify, Cloudflare Pages) also works: point it at `site/`. If you fork the project, change the repository in `site/assets/config.js`.

## Project layout

```
app/
  src-tauri/src/
    template.rs    template language ({{clipboard}}, {{cursor}}, fill-ins)
    hotkey.rs      hotkey normalisation, validation, conflict warnings
    triggers.rs    text-trigger validation + rolling-buffer matcher
    listener.rs    OS keyboard listeners (rdev on Win/Linux, CGEventTap on macOS)
    paste.rs       paste worker: clipboard swap, keystroke injection, restore
    platform.rs    focus save/restore, macOS permission, Wayland detection
    db.rs          SQLite store, starter pack, import merge
    io.rs          JSON / Markdown import & export
    engine.rs      runtime glue: hotkeys, triggers, palette
    commands.rs    IPC commands for the UI
  src/             main window, palette, onboarding, settings (TypeScript)
  tests/           Playwright tests (+ mock backend)
  e2e/             real desktop end-to-end test
site/              landing page
design/            design tokens
docs/PRD.md        product requirements
```

## Known limitations

- **Wayland:** global hotkeys and paste injection work only in XWayland apps.
- **Secure input:** password fields and macOS Secure Input block synthetic input by design.
- **Terminals:** some Linux terminals need the `Ctrl+Shift+V` paste keystroke. Set it in *Settings → Pasting*.
- **Code signing:** builds are unsigned until certificates are added.

## License

MIT
