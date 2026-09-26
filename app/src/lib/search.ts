import type { Prompt } from "./types";

function normalize(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
}

/** Score how well `needle` fuzzily matches `hay` as a subsequence (0 = no match). */
export function fuzzyScore(needle: string, hay: string): number {
  if (!needle) return 1;
  const n = normalize(needle);
  const h = normalize(hay);
  const direct = h.indexOf(n);
  if (direct === 0) return 100;
  if (direct > 0) return /[\s\-_/.]/.test(h[direct - 1]) ? 80 : 60;
  let score = 0;
  let hi = 0;
  let streak = 0;
  for (const c of n) {
    const found = h.indexOf(c, hi);
    if (found < 0) return 0;
    streak = found === hi ? streak + 1 : 0;
    score += 1 + streak * 2 + (found === 0 || /[\s\-_/.]/.test(h[found - 1] ?? "") ? 3 : 0);
    hi = found + 1;
  }
  return Math.min(50, score);
}

/** Score a prompt for a (possibly multi-word) query. Every word must match somewhere. */
export function scorePrompt(p: Prompt, query: string): number {
  const words = query.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 1;
  let total = 0;
  for (const w of words) {
    const nw = normalize(w);
    const title = fuzzyScore(w, p.title) * 3;
    const trigger = p.trigger && normalize(p.trigger).includes(nw) ? 240 : 0;
    const tags = p.tags.some((t) => normalize(t).includes(nw)) ? 120 : 0;
    const body = normalize(p.body).includes(nw) ? 40 : 0;
    const best = Math.max(title, trigger, tags, body);
    if (best === 0) return 0;
    total += best;
  }
  return total;
}

/** Filter + rank: match quality, then favourites, then usage, then title. */
export function rankPrompts(prompts: Prompt[], query: string): Prompt[] {
  return prompts
    .map((p) => ({ p, s: scorePrompt(p, query) }))
    .filter((x) => x.s > 0)
    .sort(
      (a, b) =>
        b.s - a.s ||
        Number(b.p.favorite) - Number(a.p.favorite) ||
        b.p.use_count - a.p.use_count ||
        a.p.title.localeCompare(b.p.title),
    )
    .map((x) => x.p);
}

export function preview(body: string, max = 140): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max - 1) + "…" : flat;
}
