import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AppInfo, Check, FillRequest, Folder, ImportReport, PaletteMode, Prompt, PromptInput, Settings, Status, VarSpec,
} from "./lib/types";

export const api = {
  listPrompts: () => invoke<Prompt[]>("list_prompts"),
  savePrompt: (input: PromptInput) => invoke<Prompt>("save_prompt", { input }),
  deletePrompt: (id: string) => invoke<void>("delete_prompt", { id }),
  duplicatePrompt: (id: string) => invoke<Prompt>("duplicate_prompt", { id }),
  listFolders: () => invoke<Folder[]>("list_folders"),
  saveFolder: (id: string | null, name: string) => invoke<Folder>("save_folder", { id, name }),
  deleteFolder: (id: string) => invoke<void>("delete_folder", { id }),
  getSettings: () => invoke<Settings>("get_settings"),
  saveSettings: (settings: Settings) => invoke<Settings>("save_settings", { settings }),
  setPaused: (paused: boolean) => invoke<Settings>("set_paused", { paused }),
  checkHotkey: (accelerator: string, promptId: string | null, forPalette = false) =>
    invoke<Check>("check_hotkey", { accelerator, promptId, forPalette }),
  suggestHotkey: () => invoke<string | null>("suggest_hotkey"),
  checkTrigger: (trigger: string, promptId: string | null) => invoke<Check>("check_trigger", { trigger, promptId }),
  getStatus: () => invoke<Status>("get_status"),
  parseVariables: (body: string) => invoke<VarSpec[]>("parse_variables", { body }),
  getFillRequest: (promptId: string) => invoke<FillRequest>("get_fill_request", { promptId }),
  getPaletteMode: () => invoke<PaletteMode>("get_palette_mode"),
  palettePaste: (promptId: string, values: Record<string, string> | null, copyOnly = false) =>
    invoke<void>("palette_paste", { promptId, values, copyOnly }),
  copyPrompt: (promptId: string) => invoke<void>("copy_prompt", { promptId, values: null }),
  paletteDismiss: (restore: boolean) => invoke<void>("palette_dismiss", { restore }),
  openPalette: () => invoke<void>("open_palette"),
  hideMain: () => invoke<void>("hide_main"),
  exportData: (path: string, format: "json" | "markdown") => invoke<number>("export_data", { path, format }),
  importData: (path: string) => invoke<ImportReport>("import_data", { path }),
  getAppInfo: () => invoke<AppInfo>("get_app_info"),
  openAccessibilitySettings: () => invoke<void>("open_accessibility_settings"),
};

export function on<T = unknown>(event: string, handler: (payload: T) => void): Promise<UnlistenFn> {
  return listen<T>(event, (e) => handler(e.payload));
}

/** Tauri rejects with the Rust error string; normalise anything else. */
export function errorText(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return JSON.stringify(e);
}
