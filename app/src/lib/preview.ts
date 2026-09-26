// Client-side preview of a template for the fill-in form (the Rust side does the real render).
import type { VarSpec } from "./types";

const PLACEHOLDER = /\{\{([^{}\n]*)\}\}/g;
const BUILTIN_LABELS: Record<string, string> = {
  clipboard: "‹clipboard›",
  date: "‹date›",
  time: "‹time›",
  datetime: "‹date time›",
  cursor: "",
};

function nameOf(inner: string): string {
  const t = inner.trim();
  const eq = t.indexOf("=");
  const colon = t.indexOf(":");
  const cut = [eq, colon].filter((i) => i >= 0).sort((a, b) => a - b)[0];
  return (cut === undefined ? t : t.slice(0, cut)).trim();
}

export function previewTemplate(body: string, vars: VarSpec[], values: Record<string, string>): string {
  return body.replace(PLACEHOLDER, (whole, inner: string) => {
    const name = nameOf(inner);
    const lower = name.toLowerCase();
    if (inner.trim() === name && lower in BUILTIN_LABELS) return BUILTIN_LABELS[lower];
    const spec = vars.find((v) => v.name === name);
    if (!spec) return whole;
    const v = values[name];
    return v !== undefined && v !== "" ? v : spec.default ?? `‹${name}›`;
  });
}
