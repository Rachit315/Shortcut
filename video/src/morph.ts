import { getLength, getPointAtLength } from "@remotion/paths";
import { interpolateColors, spring } from "remotion";

/** Geometry of the one shape that morphs through the whole film. */
export interface Frame {
  f: number;
  cx: number;
  cy: number;
  w: number;
  h: number;
  r: number;
  bg: string;
  border: string;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Springs from keyframe to keyframe; every transition keeps a little overshoot so it feels physical. */
export function morphAt(keys: Frame[], frame: number, fps: number) {
  let i = 0;
  while (i + 1 < keys.length && frame >= keys[i + 1].f) i++;
  const cur = keys[i];
  const prev = keys[Math.max(0, i - 1)];
  const t = i === 0 ? 1 : spring({ frame: frame - cur.f, fps, config: { damping: 15, stiffness: 120, mass: 0.85 } });
  const c = Math.min(1, Math.max(0, t));
  return {
    cx: lerp(prev.cx, cur.cx, t),
    cy: lerp(prev.cy, cur.cy, t),
    w: Math.max(0, lerp(prev.w, cur.w, t)),
    h: Math.max(0, lerp(prev.h, cur.h, t)),
    r: Math.max(0, lerp(prev.r, cur.r, c)),
    bg: interpolateColors(c, [0, 1], [prev.bg, cur.bg]),
    border: interpolateColors(c, [0, 1], [prev.border, cur.border]),
    settled: c,
  };
}

/** Resample any closed SVG path to `n` points so two different shapes can be tweened point by point. */
const cache = new Map<string, [number, number][]>();
function sample(d: string, n = 96): [number, number][] {
  const key = `${n}:${d}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const len = getLength(d);
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const p = getPointAtLength(d, (len * i) / n);
    pts.push(p ? [p.x, p.y] : [50, 50]);
  }
  cache.set(key, pts);
  return pts;
}

export function morphPath(from: string, to: string, t: number): string {
  const a = sample(from), b = sample(to);
  return a.map(([x, y], i) => `${i ? "L" : "M"}${lerp(x, b[i][0], t).toFixed(2)} ${lerp(y, b[i][1], t).toFixed(2)}`).join(" ") + " Z";
}

// Closed outlines on a 100×100 grid.
export const SHAPES = {
  circle: "M50 10 A40 40 0 1 1 49.99 10 Z",
  shield: "M50 8 L84 20 L84 48 C84 70 68 84 50 92 C32 84 16 70 16 48 L16 20 Z",
  monitor: "M12 20 L88 20 L88 70 L58 70 L62 84 L38 84 L42 70 L12 70 Z",
  star: "M50 8 L61 38 L93 38 L67 57 L77 90 L50 70 L23 90 L33 57 L7 38 L39 38 Z",
};
