# Prompt: Generate the PRD for "Shortcut"

Copy everything inside the block below into Claude (or any LLM) to generate the Product Requirements Document.

```text
You are a senior product manager and software architect. Write a complete, build-ready
Product Requirements Document (PRD) for the product described below. Be specific and
opinionated; where a decision is open, recommend one option and say why.

## Product idea
Name (working): "Shortcut" — a prompt & snippet launcher for people who use AI tools daily.

Problem: I reuse the same prompts every day — e.g. "generate an image in this style…",
"commit and push my code to GitHub with a clear message…", "review this code for bugs…".
Today I retype them or dig through notes to copy-paste. It is slow, error-prone, and my best
prompts get lost.

Solution: A lightweight desktop app that runs in the background (system tray / menu bar).
I save my prompts once, assign each a keyboard shortcut (e.g. Ctrl+Alt+1) or a short trigger
text (e.g. ";push"), and when my cursor is in ANY text input — ChatGPT, Claude, Cursor,
VS Code, terminal, Slack, a browser field — pressing the shortcut instantly pastes that prompt.

## Target users
- Developers using AI coding assistants (Claude Code, Cursor, Copilot Chat, ChatGPT)
- Designers/creators using image-generation tools (Midjourney, DALL·E, etc.)
- Power users who repeat the same text often

## Core features to specify (MVP)
1. Prompt library: create, edit, delete, duplicate prompts; title, body, tags/folders, favorite.
2. Global hotkeys: assign a key combination per prompt; works system-wide in any app.
   - Detect and warn about conflicts with OS/app shortcuts (e.g. Ctrl+1..9 switches browser
     tabs, so default to Ctrl+Alt+<n> or Ctrl+Shift+<n>).
3. Text triggers (text expansion): typing an abbreviation like ";push" replaces it with the prompt.
4. Quick-search palette: one global hotkey (e.g. Ctrl+Shift+Space) opens a searchable
   popup of all prompts; Enter pastes the selected one — so I don't need to memorize every combo.
5. Paste mechanism: insert into the focused field via clipboard + simulated paste, then
   restore the user's original clipboard.
6. Variables/placeholders: e.g. {{clipboard}}, {{date}}, {{cursor}}, and fill-in fields like
   {{language}} that prompt me for a value before pasting.
7. Import/export prompts as JSON/Markdown; local-first storage.
8. Runs on startup, lives in the tray, minimal resource usage.

## Post-MVP ideas (mark as later phases)
- Cloud sync across devices + account login
- Browser extension and VS Code extension as companion surfaces
- Shareable prompt packs / community library
- Usage stats (most-used prompts)
- AI "improve this prompt" button
- Mobile keyboard (iOS/Android) for prompts on phone

## What the PRD must contain
1. Overview & vision (one paragraph) and problem statement
2. Goals, non-goals, and success metrics (e.g. time saved, prompts pasted per day, D7 retention)
3. User personas (2–3) and key user stories with acceptance criteria
4. Detailed functional requirements per feature (MVP vs later), including edge cases:
   hotkey conflicts, password/secure input fields, apps that block simulated paste,
   multi-monitor, non-English keyboard layouts, very long prompts
5. Non-functional requirements: performance (paste < 150 ms), memory footprint,
   privacy (prompts stay local by default, no telemetry without opt-in), security, accessibility
6. Platform strategy: compare (a) cross-platform desktop app, (b) browser extension,
   (c) IDE extension — recommend one for MVP and justify it
7. Recommended tech stack with reasons (evaluate Tauri vs Electron; global hotkey and
   keystroke-simulation libraries for Windows/macOS/Linux; storage such as SQLite)
   and required OS permissions (macOS Accessibility permission, etc.)
8. Data model (Prompt, Folder/Tag, Shortcut, Variable, Settings) with fields and types
9. UX: main screens (library, editor, shortcut recorder, quick palette, settings,
   onboarding) described screen by screen, plus the first-run onboarding flow
10. Competitive analysis: Espanso, TextExpander, Raycast snippets, AutoHotkey,
    PhraseExpress, Alfred — and our differentiation (AI-prompt focus, variables,
    prompt packs, simplicity)
11. Monetization options (free/open-source core vs Pro sync tier)
12. Release plan: milestones for MVP → v1 → v2 with rough scope per milestone
13. Risks, open questions, and assumptions

Format the PRD in clean Markdown with headings, tables for requirements
(ID, requirement, priority P0/P1/P2, acceptance criteria), and keep it concrete enough
that an engineer could start building the MVP from it.
```
