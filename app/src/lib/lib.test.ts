import { describe, expect, it } from "vitest";
import { detectOs, displayAccel, displayParts, keyFromCode, recordKey } from "./keys";
import { fuzzyScore, preview, rankPrompts } from "./search";
import { previewTemplate } from "./preview";
import type { Prompt, VarSpec } from "./types";

const key = (code: string, mods: Partial<Record<"ctrlKey" | "altKey" | "shiftKey" | "metaKey", boolean>> = {}) => ({
  code,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...mods,
});

describe("keys", () => {
  it("maps KeyboardEvent.code to accelerator keys", () => {
    expect(keyFromCode("KeyA")).toBe("A");
    expect(keyFromCode("Digit7")).toBe("7");
    expect(keyFromCode("F12")).toBe("F12");
    expect(keyFromCode("F13")).toBeNull();
    expect(keyFromCode("ArrowUp")).toBe("Up");
    expect(keyFromCode("NumpadAdd")).toBeNull();
  });

  it("records combos, partials, cancel and clear", () => {
    expect(recordKey(key("Digit1", { ctrlKey: true, altKey: true }))).toEqual({ kind: "combo", accelerator: "Ctrl+Alt+1" });
    expect(recordKey(key("KeyP", { metaKey: true, shiftKey: true }))).toEqual({ kind: "combo", accelerator: "Shift+Super+P" });
    expect(recordKey(key("ControlLeft", { ctrlKey: true }))).toEqual({ kind: "partial", modifiers: ["Ctrl"] });
    expect(recordKey(key("Escape"))).toEqual({ kind: "cancel" });
    expect(recordKey(key("Backspace"))).toEqual({ kind: "clear" });
    expect(recordKey(key("NumpadAdd", { ctrlKey: true })).kind).toBe("unsupported");
  });

  it("displays accelerators per OS", () => {
    expect(displayAccel("Ctrl+Alt+Super+1", "macos")).toBe("Ctrl+Option+Cmd+1");
    expect(displayParts("Super+Space", "windows")).toEqual(["Win", "Space"]);
    expect(displayParts(null, "linux")).toEqual([]);
  });

  it("detects OS from user agent", () => {
    expect(detectOs("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)")).toBe("macos");
    expect(detectOs("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("windows");
    expect(detectOs("Mozilla/5.0 (X11; Linux x86_64)")).toBe("linux");
  });
});

const prompt = (over: Partial<Prompt>): Prompt => ({
  id: over.title ?? "id",
  title: "Untitled",
  body: "",
  folder_id: null,
  tags: [],
  favorite: false,
  hotkey: null,
  trigger: null,
  use_count: 0,
  last_used_at: null,
  created_at: 0,
  updated_at: 0,
  ...over,
});

describe("search", () => {
  const prompts = [
    prompt({ title: "Code review", body: "Review the following code", tags: ["code"], trigger: ";review" }),
    prompt({ title: "Commit & push", body: "git push", trigger: ";push", favorite: true }),
    prompt({ title: "Image style", body: "cinematic lighting", tags: ["midjourney"] }),
    prompt({ title: "Refund reply", body: "Thanks for reaching out", use_count: 9 }),
  ];

  it("fuzzy scores prefixes above substrings above subsequences", () => {
    expect(fuzzyScore("cod", "Code review")).toBeGreaterThan(fuzzyScore("rev", "Code review"));
    expect(fuzzyScore("rev", "Code review")).toBeGreaterThan(fuzzyScore("cdr", "Code review"));
    expect(fuzzyScore("xyz", "Code review")).toBe(0);
  });

  it("ranks by match, then favourite, then usage", () => {
    expect(rankPrompts(prompts, "").map((p) => p.title)).toEqual(["Commit & push", "Refund reply", "Code review", "Image style"]);
    expect(rankPrompts(prompts, "push")[0].title).toBe("Commit & push");
    expect(rankPrompts(prompts, "midjourney").map((p) => p.title)).toEqual(["Image style"]);
    expect(rankPrompts(prompts, "cinematic")[0].title).toBe("Image style");
    expect(rankPrompts(prompts, "code review").map((p) => p.title)[0]).toBe("Code review");
    expect(rankPrompts(prompts, "nothing-matches")).toEqual([]);
  });

  it("previews bodies on one line", () => {
    expect(preview("a\n\nb   c")).toBe("a b c");
    expect(preview("x".repeat(200), 10)).toHaveLength(10);
  });
});

describe("template preview", () => {
  const vars: VarSpec[] = [
    { name: "subject", kind: "text", default: null, options: [] },
    { name: "palette", kind: "text", default: "teal", options: [] },
    { name: "aspect", kind: "choice", default: "16:9", options: ["16:9", "1:1"] },
  ];
  it("fills values, defaults and built-in labels", () => {
    const body = "{{subject}} in {{palette=teal}} --ar {{aspect:16:9|1:1}} {{clipboard}}{{cursor}} {{!x}}";
    expect(previewTemplate(body, vars, { subject: "a fox" })).toBe("a fox in teal --ar 16:9 ‹clipboard› {{!x}}");
    expect(previewTemplate(body, vars, { aspect: "1:1" })).toContain("‹subject› in teal --ar 1:1");
  });
});
