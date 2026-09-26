// Mirrors the Rust models (src-tauri/src/models.rs & commands.rs).

export interface Prompt {
  id: string;
  title: string;
  body: string;
  folder_id: string | null;
  tags: string[];
  favorite: boolean;
  hotkey: string | null;
  trigger: string | null;
  use_count: number;
  last_used_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface PromptInput {
  id?: string | null;
  title: string;
  body: string;
  folder_id: string | null;
  tags: string[];
  favorite: boolean;
  hotkey: string | null;
  trigger: string | null;
}

export interface Folder {
  id: string;
  name: string;
  sort_order: number;
}

export type PasteMethod = "clipboard" | "type";
export type PasteKeystroke = "ctrl_v" | "ctrl_shift_v" | "shift_insert";

export interface Settings {
  palette_hotkey: string;
  paste_method: PasteMethod;
  paste_keystroke: PasteKeystroke;
  restore_clipboard: boolean;
  restore_delay_ms: number;
  triggers_enabled: boolean;
  launch_at_login: boolean;
  paused: boolean;
  onboarding_complete: boolean;
}

export interface Check {
  normalized: string | null;
  error: string | null;
  warnings: string[];
}

export interface Status {
  paused: boolean;
  triggers_enabled: boolean;
  hotkey_errors: Record<string, string>;
  listener_error: string | null;
  accessibility: boolean | null;
}

export interface VarSpec {
  name: string;
  kind: "text" | "choice";
  default: string | null;
  options: string[];
}

export interface FillRequest {
  prompt: Prompt;
  vars: VarSpec[];
  last_values: Record<string, string>;
}

export interface PaletteMode {
  mode: "search" | "fill";
  prompt_id: string | null;
}

export interface ImportReport {
  prompts_added: number;
  prompts_updated: number;
  folders_added: number;
  warnings: string[];
}

export interface AppInfo {
  version: string;
  os: "macos" | "windows" | "linux";
  data_dir: string;
  session: string;
}
