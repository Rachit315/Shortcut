// Keyboard helpers for the shortcut recorder and for displaying accelerators.

export type Os = "macos" | "windows" | "linux";

const MODIFIER_CODES = new Set([
  "ControlLeft", "ControlRight", "AltLeft", "AltRight", "ShiftLeft", "ShiftRight",
  "MetaLeft", "MetaRight", "OSLeft", "OSRight", "CapsLock", "Fn", "AltGraph",
]);

const NAMED: Record<string, string> = {
  Space: "Space", Enter: "Enter", Tab: "Tab", Backspace: "Backspace", Delete: "Delete",
  Insert: "Insert", Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown",
  ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right",
  Comma: "Comma", Period: "Period", Minus: "Minus", Equal: "Equal", Slash: "Slash",
  Backslash: "Backslash", Semicolon: "Semicolon", Quote: "Quote", Backquote: "Backquote",
  BracketLeft: "BracketLeft", BracketRight: "BracketRight", Escape: "Escape",
};

/** Map a KeyboardEvent.code to the accelerator key name, or null if unsupported. */
export function keyFromCode(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  const f = /^F([1-9]|1[0-2])$/.exec(code);
  if (f) return code;
  return NAMED[code] ?? null;
}

export function isModifierCode(code: string): boolean {
  return MODIFIER_CODES.has(code);
}

export interface KeyLike {
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

export type RecorderResult =
  | { kind: "partial"; modifiers: string[] }
  | { kind: "combo"; accelerator: string }
  | { kind: "cancel" }
  | { kind: "clear" }
  | { kind: "unsupported"; code: string };

export function modifiersOf(e: KeyLike): string[] {
  const m: string[] = [];
  if (e.ctrlKey) m.push("Ctrl");
  if (e.altKey) m.push("Alt");
  if (e.shiftKey) m.push("Shift");
  if (e.metaKey) m.push("Super");
  return m;
}

/** Interpret a keydown while recording. */
export function recordKey(e: KeyLike): RecorderResult {
  const mods = modifiersOf(e);
  if (isModifierCode(e.code)) return { kind: "partial", modifiers: mods };
  if (mods.length === 0 && e.code === "Escape") return { kind: "cancel" };
  if (mods.length === 0 && (e.code === "Backspace" || e.code === "Delete")) return { kind: "clear" };
  const key = keyFromCode(e.code);
  if (!key) return { kind: "unsupported", code: e.code };
  return { kind: "combo", accelerator: [...mods, key].join("+") };
}

const MAC: Record<string, string> = { Ctrl: "Ctrl", Alt: "Option", Shift: "Shift", Super: "Cmd" };
const WIN: Record<string, string> = { Super: "Win" };

/** Split an accelerator into display parts for <kbd> pills. */
export function displayParts(accel: string | null | undefined, os: Os): string[] {
  if (!accel) return [];
  return accel.split("+").map((p) => (os === "macos" ? MAC[p] ?? p : os === "windows" ? WIN[p] ?? p : p));
}

export function displayAccel(accel: string | null | undefined, os: Os): string {
  return displayParts(accel, os).join("+");
}

export function detectOs(ua: string = typeof navigator !== "undefined" ? navigator.userAgent : ""): Os {
  if (/Mac|iPhone|iPad/i.test(ua)) return "macos";
  if (/Win/i.test(ua)) return "windows";
  return "linux";
}
