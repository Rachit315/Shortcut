import React from "react";
import { AbsoluteFill, Audio, Easing, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig, type SpringConfig } from "remotion";
import { morphAt, morphPath, SHAPES, type Frame } from "./morph";
import { C, FONT, MONO } from "./theme";
import T from "./timeline.json";

const S = T.scenes;
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

// ---------------------------------------------------------------------------------------------
// The morphing shape: one element that becomes every "screen" in turn.
// ---------------------------------------------------------------------------------------------
const K: Frame[] = [
  { f: 0, cx: 960, cy: 470, w: 0, h: 0, r: 0, bg: C.accent, border: C.accent },
  { f: 1, cx: 960, cy: 470, w: 36, h: 36, r: 18, bg: C.accent, border: C.accent },
  { f: 14, cx: 960, cy: 430, w: 240, h: 240, r: 120, bg: C["surface-raised"], border: C["border-strong"] },
  { f: S.problem - 2, cx: 960, cy: 800, w: 1240, h: 104, r: 52, bg: C.surface, border: C["border-strong"] },
  { f: S.save - 2, cx: 960, cy: 625, w: 1560, h: 770, r: 24, bg: C.surface, border: C["border-strong"] },
  { f: S.hotkey - 2, cx: 960, cy: 720, w: 1180, h: 190, r: 32, bg: C.surface, border: C["border-strong"] },
  { f: S.trigger - 2, cx: 960, cy: 640, w: 1180, h: 130, r: 32, bg: C.surface, border: C["border-strong"] },
  { f: 486, cx: 960, cy: 640, w: 1180, h: 300, r: 32, bg: C.surface, border: C["border-strong"] },
  { f: S.palette - 2, cx: 960, cy: 640, w: 980, h: 560, r: 28, bg: C.surface, border: C["border-strong"] },
  { f: 594, cx: 960, cy: 640, w: 980, h: 300, r: 28, bg: C.surface, border: C["border-strong"] },
  { f: S.fill - 2, cx: 960, cy: 640, w: 1560, h: 500, r: 24, bg: C.surface, border: C["border-strong"] },
  { f: S.features - 2, cx: 960, cy: 660, w: 1600, h: 400, r: 24, bg: C.surface, border: C["border-strong"] },
  { f: S.outro - 2, cx: 960, cy: 400, w: 240, h: 240, r: 120, bg: C["surface-raised"], border: C["border-strong"] },
];

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------
function useF() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const sp = (start: number, config: Partial<SpringConfig> = { damping: 200 }) => spring({ frame: frame - start, fps, config });
  const pop = (start: number) => spring({ frame: frame - start, fps, config: { damping: 11, stiffness: 160, mass: 0.7 } });
  /** 0 → 1 → 0 visibility window */
  const win = (from: number, to: number, fin = 10, fout = 8) => interpolate(frame, [from, from + fin, to - fout, to], [0, 1, 1, 0], clamp);
  const typed = (text: string, from: number, to: number) => text.slice(0, Math.round(interpolate(frame, [from, to], [0, text.length], clamp)));
  return { frame, fps, sp, pop, win, typed };
}

const Caret: React.FC<{ h?: number }> = ({ h = 26 }) => {
  const frame = useCurrentFrame();
  return <span style={{ display: "inline-block", width: 3, height: h, marginLeft: 2, verticalAlign: "text-bottom", background: C.accent, opacity: Math.floor(frame / 12) % 2 ? 0 : 1 }} />;
};

const Kbd: React.FC<{ children: React.ReactNode; size?: number; press?: number; lit?: number }> = ({ children, size = 1, press = 0, lit = 0 }) => (
  <span
    style={{
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      minWidth: 30 * size,
      height: 30 * size,
      padding: `0 ${9 * size}px`,
      fontFamily: MONO,
      fontSize: 13 * size,
      fontWeight: 500,
      color: interpolateColorSafe(lit, C["text-primary"], C["on-primary"]),
      background: interpolateColorSafe(lit, C.surface, C.primary),
      border: `${Math.max(1, size)}px solid ${C["border-strong"]}`,
      borderBottomWidth: Math.max(2, 3 * size * (1 - press)),
      borderRadius: 9 * size,
      transform: `translateY(${press * 4 * size}px)`,
    }}
  >
    {children}
  </span>
);

function interpolateColorSafe(t: number, a: string, b: string) {
  // tiny local wrapper so components can take plain numbers
  const k = Math.min(1, Math.max(0, t));
  const pa = hex(a), pb = hex(b);
  return `rgb(${pa.map((v, i) => Math.round(v + (pb[i] - v) * k)).join(",")})`;
}
function hex(c: string): number[] {
  const m = c.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(m.slice(i, i + 2), 16));
}

const Label: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div style={{ fontFamily: FONT, fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: C["text-muted"], ...style }}>{children}</div>
);

/** The Clazy mark: a relaxed "C" with the red keystroke dot. `draw` 0→1 draws the stroke. */
const Mark: React.FC<{ size: number; draw: number; dot: number }> = ({ size, draw, dot }) => {
  const arcLen = 2 * Math.PI * 250 * 0.75;
  return (
    <svg viewBox="200 200 624 624" width={size} height={size} style={{ overflow: "visible" }}>
      <g transform="rotate(-14 512 512)">
        <path
          d="M688.8 688.8 A250 250 0 1 1 688.8 335.2"
          fill="none"
          stroke={C.primary}
          strokeWidth={124}
          strokeLinecap="round"
          strokeDasharray={arcLen}
          strokeDashoffset={arcLen * (1 - draw)}
          opacity={draw > 0.001 ? 1 : 0}
        />
        <circle cx={700} cy={512} r={58 * dot} fill={C.accent} />
      </g>
    </svg>
  );
};

/** Kinetic headline: numbered mono tag + words rising in one by one. */
const Headline: React.FC<{ from: number; to: number; tag?: string; text: string; y?: number; accent?: string }> = ({ from, to, tag, text, y = 70, accent }) => {
  const { frame, fps, win } = useF();
  const o = win(from, to, 6, 8);
  const words = text.split(" ");
  return (
    <div style={{ position: "absolute", top: y, left: 0, right: 0, textAlign: "center", opacity: o }}>
      {tag && (
        <div style={{ fontFamily: MONO, fontSize: 18, letterSpacing: "0.08em", color: C["text-muted"], marginBottom: 14 }}>
          <span style={{ color: C.accent }}>●</span> {tag}
        </div>
      )}
      <div style={{ fontFamily: FONT, fontSize: 72, fontWeight: 500, letterSpacing: "-0.035em", lineHeight: 1, color: C["text-primary"] }}>
        {words.map((w, i) => {
          const p = spring({ frame: frame - from - i * 3, fps, config: { damping: 18, stiffness: 140 } });
          return (
            <span key={i} style={{ display: "inline-block", overflow: "hidden", verticalAlign: "top", paddingBottom: 8 }}>
              <span style={{ display: "inline-block", transform: `translateY(${(1 - p) * 90}%)`, color: accent && w.includes(accent) ? C.accent : undefined }}>
                {w}
                {i < words.length - 1 ? " " : ""}
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
};

const Pointer: React.FC<{ x: number; y: number; down?: number; opacity?: number }> = ({ x, y, down = 0, opacity = 1 }) => (
  <svg width={34} height={34} viewBox="0 0 24 24" style={{ position: "absolute", left: x, top: y, opacity, transform: `scale(${1 - down * 0.15})`, transformOrigin: "0 0", filter: "drop-shadow(0 4px 10px rgba(0,0,0,.6))" }}>
    <path d="M4 2 L4 19 L8.5 15 L11.5 22 L14.5 20.7 L11.6 14 L18 14 Z" fill={C.primary} stroke={C.background} strokeWidth={1.2} strokeLinejoin="round" />
  </svg>
);

// ---------------------------------------------------------------------------------------------
// Background: technical dot grid that drifts, with a soft accent glow that breathes on the beat.
// ---------------------------------------------------------------------------------------------
const Background: React.FC = () => {
  const { frame } = useF();
  const beat = (frame % 15) / 15;
  const pulse = frame >= 120 && frame < 900 ? Math.exp(-beat * 5) * 0.05 : 0;
  return (
    <AbsoluteFill style={{ background: C.background }}>
      <AbsoluteFill
        style={{
          backgroundImage: `radial-gradient(circle at 1.5px 1.5px, ${C["border-strong"]} 1.5px, transparent 0)`,
          backgroundSize: "32px 32px",
          backgroundPosition: `${-frame * 0.35}px ${-frame * 0.2}px`,
          opacity: 0.55,
        }}
      />
      <AbsoluteFill style={{ background: `radial-gradient(ellipse 60% 50% at 50% 60%, rgba(255,77,46,${0.07 + pulse}), transparent 70%)` }} />
      <AbsoluteFill style={{ background: `radial-gradient(ellipse at center, transparent 45%, ${C.background} 100%)` }} />
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------------------------
// Scenes. Each one renders inside the morph box (w × h) and fades with its own window.
// ---------------------------------------------------------------------------------------------

const Intro: React.FC = () => {
  const { sp, pop, win } = useF();
  const o = win(0, S.problem - 2, 1, 6);
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: o }}>
      <Mark size={150} draw={sp(18, { damping: 30 })} dot={pop(44)} />
    </AbsoluteFill>
  );
};

const IntroText: React.FC = () => {
  const { frame, fps, win } = useF();
  const o = win(52, S.problem - 2, 1, 8);
  const word = "Clazy";
  return (
    <div style={{ position: "absolute", top: 590, left: 0, right: 0, textAlign: "center", opacity: o }}>
      <div style={{ fontFamily: FONT, fontSize: 150, fontWeight: 500, letterSpacing: "-0.05em", lineHeight: 1, color: C["text-primary"] }}>
        {word.split("").map((ch, i) => {
          const p = spring({ frame: frame - 52 - i * 3, fps, config: { damping: 16, stiffness: 150 } });
          return (
            <span key={i} style={{ display: "inline-block", overflow: "hidden", verticalAlign: "top" }}>
              <span style={{ display: "inline-block", transform: `translateY(${(1 - p) * 100}%)` }}>{ch}</span>
            </span>
          );
        })}
      </div>
      <div style={{ fontFamily: MONO, fontSize: 22, letterSpacing: "0.08em", color: C["text-secondary"], marginTop: 26, opacity: interpolate(frame, [76, 90], [0, 1], clamp) }}>
        YOUR BEST PROMPTS, ONE KEYSTROKE AWAY
      </div>
    </div>
  );
};

const PROMPT_REVIEW = "Review the following code for bugs, edge cases and readability. Suggest fixes with short explanations.";

const Problem: React.FC = () => {
  const { typed, win } = useF();
  const o = win(S.problem + 2, S.save - 2, 8, 6);
  return (
    <AbsoluteFill style={{ alignItems: "center", flexDirection: "row", padding: "0 48px", opacity: o, fontFamily: MONO, fontSize: 24, color: C["text-primary"], whiteSpace: "nowrap", overflow: "hidden" }}>
      {typed("Review the following code for bugs, edge cases and readab…", S.problem + 6, S.problem + 34)}
      <Caret />
    </AbsoluteFill>
  );
};

const ProblemGhosts: React.FC = () => {
  const { sp, win, frame } = useF();
  const o = win(S.problem + 2, S.save - 2, 6, 6);
  const rows = [0, 1, 2];
  return (
    <div style={{ position: "absolute", left: 340, right: 340, top: 470, height: 260, opacity: o }}>
      {rows.map((i) => {
        const p = sp(S.problem + 10 + i * 12);
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: 180 - i * 80 - p * 20,
              height: 60,
              borderRadius: 30,
              border: `1px dashed ${C["border-strong"]}`,
              display: "flex",
              alignItems: "center",
              padding: "0 36px",
              fontFamily: MONO,
              fontSize: 20,
              color: C["text-muted"],
              opacity: p * (0.75 - i * 0.2),
              whiteSpace: "nowrap",
              overflow: "hidden",
            }}
          >
            Review the following code for bugs, edge cases and readab…
            <span style={{ marginLeft: "auto", paddingLeft: 20, color: C.accent }}>{["×2", "×7", "×19"][i]}</span>
          </div>
        );
      })}
      <div style={{ position: "absolute", top: -90, left: 0, right: 0, textAlign: "center", fontFamily: FONT, fontSize: 40, fontWeight: 500, color: C.accent, letterSpacing: "-0.02em", opacity: interpolate(frame, [S.problem + 30, S.problem + 36], [0, 1], clamp) }}>
        {frame >= S.problem + 44 ? "Again. And again." : "Again."}
      </div>
    </div>
  );
};

// ---- the app window (matches the real Clazy UI) ----
const STARTERS = [
  { t: "Code review", p: "Review the following code for bugs, edge cases…", k: "Ctrl+Alt+1", tr: ";review" },
  { t: "Commit & push", p: "Look at my staged and unstaged changes, write a…", k: "Ctrl+Alt+2", tr: ";push" },
  { t: "Write tests", p: "Write unit tests for the code below. Cover the happy…", k: "", tr: ";tests" },
  { t: "Explain simply", p: "Explain this like I'm new to the topic. Use one…", k: "", tr: ";eli5" },
  { t: "Image style", p: "Cinematic still, soft volumetric light, 35mm film…", k: "Ctrl+Alt+3", tr: ";img" },
];

const AppWindow: React.FC = () => {
  const { frame, sp, pop, win, typed } = useF();
  const o = win(S.save + 6, S.hotkey - 2, 10, 6);
  const sel = frame >= 226 ? 1 : 0;
  const px = interpolate(frame, [196, 222, 240, 256], [1300, 560, 560, 1150], { ...clamp, easing: Easing.bezier(0.22, 1, 0.36, 1) });
  const py = interpolate(frame, [196, 222, 240, 256], [700, 212, 212, 580], { ...clamp, easing: Easing.bezier(0.22, 1, 0.36, 1) });
  const down = frame >= 224 && frame < 230 ? 1 : frame >= 258 && frame < 262 ? 1 : 0;
  return (
    <AbsoluteFill style={{ opacity: o, fontFamily: FONT, color: C["text-primary"], display: "flex", flexDirection: "column" }}>
      {/* title bar */}
      <div style={{ height: 46, display: "flex", alignItems: "center", gap: 8, padding: "0 18px", borderBottom: `1px solid ${C.border}` }}>
        {[0, 1, 2].map((i) => (
          <span key={i} style={{ width: 12, height: 12, borderRadius: 6, background: C["border-strong"] }} />
        ))}
        <span style={{ flex: 1, textAlign: "center", fontFamily: MONO, fontSize: 13, color: C["text-muted"], marginRight: 52 }}>Clazy</span>
      </div>
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* sidebar */}
        <div style={{ width: 270, borderRight: `1px solid ${C.border}`, padding: "22px 18px", display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
            <div style={{ width: 30, height: 30, borderRadius: 8, background: C.background, border: `1px solid ${C["border-strong"]}`, display: "grid", placeItems: "center" }}>
              <Mark size={20} draw={1} dot={1} />
            </div>
            <div style={{ fontSize: 18, fontWeight: 500, letterSpacing: "-0.02em" }}>Clazy</div>
          </div>
          {[
            ["All prompts", "5", true],
            ["Favourites", "2", false],
          ].map(([t, n, on]) => (
            <div key={t as string} style={{ display: "flex", justifyContent: "space-between", padding: "9px 12px", borderRadius: 10, fontSize: 14, fontWeight: 500, background: on ? C["surface-raised"] : "transparent", color: on ? C["text-primary"] : C["text-secondary"] }}>
              <span>{t}</span>
              <span style={{ fontFamily: MONO, fontSize: 11, color: C["text-muted"] }}>{n}</span>
            </div>
          ))}
          <Label style={{ margin: "18px 12px 6px" }}>Folders</Label>
          {["Coding", "Writing", "Images"].map((t) => (
            <div key={t} style={{ padding: "9px 12px", fontSize: 14, fontWeight: 500, color: C["text-secondary"] }}>{t}</div>
          ))}
          <div style={{ marginTop: "auto", border: `1px solid ${C.border}`, borderRadius: 14, padding: 14 }}>
            <Label>Quick palette</Label>
            <div style={{ marginTop: 10, display: "flex", gap: 4 }}>
              <Kbd size={0.8}>Ctrl</Kbd>
              <Kbd size={0.8}>Shift</Kbd>
              <Kbd size={0.8}>Space</Kbd>
            </div>
          </div>
        </div>
        {/* list */}
        <div style={{ width: 520, borderRight: `1px solid ${C.border}`, padding: "24px 20px" }}>
          <div style={{ fontSize: 32, fontWeight: 500, letterSpacing: "-0.02em", marginBottom: 16 }}>All prompts</div>
          <div style={{ height: 40, borderRadius: 999, background: C["surface-sunken"], border: `1px solid ${C.border}`, display: "flex", alignItems: "center", padding: "0 16px", fontSize: 14, color: C["text-muted"], marginBottom: 14 }}>
            Search prompts…
          </div>
          {STARTERS.map((s, i) => {
            const p = sp(S.save + 12 + i * 4);
            const on = sel && i === 0;
            return (
              <div
                key={s.t}
                style={{
                  padding: "13px 14px",
                  borderRadius: 14,
                  marginBottom: 4,
                  background: on ? C.primary : "transparent",
                  color: on ? C["on-primary"] : C["text-primary"],
                  opacity: p,
                  transform: `translateY(${(1 - p) * 20}px)`,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontFamily: MONO, fontSize: 11, opacity: 0.55 }}>({String(i + 1).padStart(3, "0")})</span>
                  <span style={{ fontSize: 16, fontWeight: 500, flex: 1 }}>{s.t}</span>
                  {s.k && <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 500, opacity: 0.8 }}>{s.k}</span>}
                </div>
                <div style={{ fontSize: 14, marginTop: 4, color: on ? "rgba(10,10,10,.65)" : C["text-secondary"], whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.p}</div>
              </div>
            );
          })}
        </div>
        {/* editor */}
        <div style={{ flex: 1, padding: "24px 30px", display: "flex", flexDirection: "column", gap: 18, opacity: sel ? 1 : 0.25 }}>
          <div style={{ fontSize: 32, fontWeight: 500, letterSpacing: "-0.02em" }}>{sel ? "Code review" : "Select a prompt"}</div>
          <div style={{ display: "flex", gap: 8 }}>
            {["coding", "review"].map((t) => (
              <span key={t} style={{ padding: "4px 12px", borderRadius: 999, background: C["surface-raised"], border: `1px solid ${C["border-strong"]}`, fontSize: 12, fontWeight: 500 }}>
                {t}
              </span>
            ))}
          </div>
          <div style={{ border: `1px solid ${C["border-strong"]}`, borderRadius: 16, padding: "18px 20px", height: 220, fontFamily: MONO, fontSize: 15, lineHeight: 1.6, color: C["text-primary"] }}>
            {sel ? typed(PROMPT_REVIEW + "\n\n{{clipboard}}", 230, 262) : ""}
            {sel ? <Caret h={20} /> : null}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div style={{ border: `1px solid ${frame >= 256 && frame < 280 ? C.accent : C.border}`, borderRadius: 16, padding: 16 }}>
              <Label>Hotkey</Label>
              <div style={{ display: "flex", gap: 6, marginTop: 12, height: 32 }}>
                {["Ctrl", "Alt", "1"].map((k, i) => {
                  const p = pop(262 + i * 6);
                  return (
                    <span key={k} style={{ transform: `scale(${p})`, display: "inline-block" }}>
                      <Kbd>{k}</Kbd>
                    </span>
                  );
                })}
              </div>
            </div>
            <div style={{ border: `1px solid ${C.border}`, borderRadius: 16, padding: 16 }}>
              <Label>Text trigger</Label>
              <div style={{ marginTop: 12, fontFamily: MONO, fontSize: 15, height: 32, display: "flex", alignItems: "center" }}>;review</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: C.success, opacity: interpolate(frame, [280, 286], [0, 1], clamp) }}>
            <span style={{ width: 8, height: 8, borderRadius: 4, background: C.success }} /> Ready: works in every app
          </div>
        </div>
      </div>
      <Pointer x={px} y={py} down={down} opacity={interpolate(frame, [196, 204, 286, 292], [0, 1, 1, 0], clamp)} />
    </AbsoluteFill>
  );
};

// ---- a generic AI chat input (hotkey + trigger scenes) ----
const PROMPT_PUSH = "Look at my staged and unstaged changes. Write a clear, conventional commit message, commit, then push the current branch.";

const ChatBox: React.FC<{ from: number; to: number; children: React.ReactNode; flash?: number }> = ({ from, to, children, flash = -99 }) => {
  const { frame, win } = useF();
  const o = win(from, to, 10, 6);
  const ring = frame >= flash ? interpolate(frame, [flash, flash + 14], [1, 0], clamp) : 0;
  return (
    <AbsoluteFill style={{ opacity: o, padding: "30px 40px", fontFamily: MONO, fontSize: 24, lineHeight: 1.55, color: C["text-primary"], boxShadow: `inset 0 0 0 ${3 * ring}px ${C.accent}` }}>
      <div style={{ paddingRight: 90 }}>{children}</div>
      <div style={{ position: "absolute", right: 26, bottom: 26, width: 52, height: 52, borderRadius: 26, background: C.primary, display: "grid", placeItems: "center" }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={C["on-primary"]} strokeWidth="2.6" strokeLinecap="round">
          <path d="M12 19V5M5 12l7-7 7 7" />
        </svg>
      </div>
    </AbsoluteFill>
  );
};

const HotkeyScene: React.FC = () => {
  const { frame } = useF();
  const reveal = interpolate(frame, [375, 390], [0, 1], clamp);
  return (
    <ChatBox from={S.hotkey + 4} to={S.trigger - 2} flash={375}>
      {frame < 375 ? (
        <span style={{ color: C["text-muted"] }}>
          Ask anything…
          <Caret />
        </span>
      ) : (
        <span style={{ clipPath: `inset(0 ${(1 - reveal) * 100}% 0 0)`, display: "inline-block" }}>{PROMPT_REVIEW}</span>
      )}
    </ChatBox>
  );
};

const HotkeyKeys: React.FC = () => {
  const { frame, pop, win } = useF();
  const o = win(S.hotkey + 2, S.trigger - 4, 6, 8);
  const keys = ["Ctrl", "Alt", "1"];
  const presses = [330, 345, 360];
  return (
    <div style={{ position: "absolute", top: 340, left: 0, right: 0, display: "flex", justifyContent: "center", alignItems: "center", gap: 26, opacity: o }}>
      {keys.map((k, i) => {
        const p = pop(S.hotkey + 6 + i * 4);
        const down = frame >= presses[i] && frame < 376 ? 1 : 0;
        const lit = frame >= presses[i] ? interpolate(frame, [presses[i], presses[i] + 4, 376, 384], [0, 1, 1, 0], clamp) : 0;
        return (
          <React.Fragment key={k}>
            {i > 0 && <span style={{ fontFamily: FONT, fontSize: 48, color: C["text-muted"], opacity: p }}>+</span>}
            <span style={{ transform: `scale(${p})`, display: "inline-block" }}>
              <Kbd size={3.4} press={down} lit={lit}>
                {k}
              </Kbd>
            </span>
          </React.Fragment>
        );
      })}
    </div>
  );
};

const TriggerScene: React.FC = () => {
  const { frame } = useF();
  const code = ";push".slice(0, Math.max(0, Math.min(5, Math.floor((frame - 444) / 6) + 1)));
  const expanded = frame >= 486;
  const reveal = interpolate(frame, [486, 506], [0, 1], clamp);
  return (
    <ChatBox from={S.trigger + 4} to={S.palette - 2} flash={486}>
      {!expanded ? (
        <span>
          <span style={{ color: C["text-secondary"] }}>Ship it </span>
          <span style={{ color: C["accent-strong"] }}>{frame >= 444 ? code : ""}</span>
          <Caret />
        </span>
      ) : (
        <span style={{ display: "inline-block", clipPath: `inset(0 0 ${(1 - reveal) * 100}% 0)` }}>
          <span style={{ color: C["text-secondary"] }}>Ship it </span>
          {PROMPT_PUSH}
          <Caret />
        </span>
      )}
    </ChatBox>
  );
};

const TriggerBadge: React.FC = () => {
  const { pop, win } = useF();
  const o = win(488, S.palette - 4, 4, 8);
  const p = pop(488);
  return (
    <div style={{ position: "absolute", top: 452, left: 0, right: 0, display: "flex", justifyContent: "center", opacity: o }}>
      <div style={{ transform: `scale(${p})`, display: "flex", gap: 14, alignItems: "center", padding: "10px 20px", borderRadius: 999, background: C.primary, color: C["on-primary"], fontFamily: MONO, fontSize: 20, fontWeight: 500 }}>
        ;push <span style={{ opacity: 0.5 }}>→</span> Commit &amp; push
      </div>
    </div>
  );
};

const PaletteScene: React.FC = () => {
  const { frame, sp, win, typed } = useF();
  const o = win(S.palette + 6, S.fill - 2, 10, 8);
  const q = typed("rev", 576, 590);
  const filtered = sp(592);
  const enter = frame >= 630;
  return (
    <AbsoluteFill style={{ opacity: o, padding: 22, fontFamily: FONT, color: C["text-primary"] }}>
      <div style={{ height: 64, borderRadius: 999, background: C["surface-sunken"], border: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 14, padding: "0 24px", fontSize: 24, marginBottom: 12 }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={C["text-muted"]} strokeWidth="2.2">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        {q ? q : <span style={{ color: C["text-muted"] }}>Search prompts</span>}
        <Caret h={28} />
      </div>
      {STARTERS.map((s, i) => {
        const keep = i === 0;
        const hRow = keep ? 68 : 68 * (1 - filtered);
        const on = i === 0;
        const flash = enter && on ? interpolate(frame, [630, 634, 640], [1, 0.4, 1], clamp) : 1;
        return (
          <div
            key={s.t}
            style={{
              height: hRow,
              overflow: "hidden",
              opacity: keep ? flash : Math.max(0, 1 - filtered * 2.5),
              borderRadius: 16,
              background: on ? C.primary : "transparent",
              color: on ? C["on-primary"] : C["text-primary"],
              display: "flex",
              alignItems: "center",
              gap: 16,
              padding: "0 22px",
              marginBottom: keep ? 4 : 4 * (1 - filtered),
            }}
          >
            <span style={{ fontFamily: MONO, fontSize: 13, opacity: 0.55 }}>({String(i + 1).padStart(3, "0")})</span>
            <span style={{ fontSize: 20, fontWeight: 500 }}>{s.t}</span>
            <span style={{ flex: 1, fontSize: 16, opacity: 0.6, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.p}</span>
            <span style={{ fontFamily: MONO, fontSize: 14, opacity: 0.7 }}>{s.tr}</span>
          </div>
        );
      })}
      <div style={{ position: "absolute", left: 30, right: 30, bottom: 20, display: "flex", gap: 24, fontFamily: MONO, fontSize: 14, color: C["text-muted"] }}>
        <span>
          <Kbd size={0.8} press={enter && frame < 636 ? 1 : 0} lit={enter ? interpolate(frame, [630, 634, 642], [0, 1, 0], clamp) : 0}>
            ↵
          </Kbd>{" "}
          PASTE
        </span>
        <span>
          <Kbd size={0.8}>esc</Kbd> CLOSE
        </span>
        <span style={{ marginLeft: "auto" }}>5 PROMPTS</span>
      </div>
    </AbsoluteFill>
  );
};

const PaletteKeys: React.FC = () => {
  const { frame, pop, win } = useF();
  const o = win(S.palette + 4, 600, 4, 10);
  const presses = [552, 556, 560];
  return (
    <div style={{ position: "absolute", top: 300, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 12, opacity: o }}>
      {["Ctrl", "Shift", "Space"].map((k, i) => {
        const p = pop(S.palette + 6 + i * 3);
        const lit = interpolate(frame, [presses[i], presses[i] + 3, 590, 598], [0, 1, 1, 0], clamp);
        return (
          <span key={k} style={{ transform: `scale(${p})`, display: "inline-block" }}>
            <Kbd size={1.6} press={frame >= presses[i] && frame < 590 ? 1 : 0} lit={lit}>
              {k}
            </Kbd>
          </span>
        );
      })}
    </div>
  );
};

const Chip: React.FC<{ from: string; to: string; at: number }> = ({ from, to, at }) => {
  const { pop, frame } = useF();
  const done = frame >= at;
  const p = done ? pop(at) : 1;
  return (
    <span
      style={{
        display: "inline-block",
        padding: "0 10px",
        borderRadius: 10,
        background: done ? C.primary : C["accent-soft"],
        color: done ? C["on-primary"] : C["accent-strong"],
        transform: `scale(${0.8 + 0.2 * p})`,
        transformOrigin: "left center",
      }}
    >
      {done ? to : from}
    </span>
  );
};

const FillScene: React.FC = () => {
  const { frame, sp, win, typed } = useF();
  const o = win(S.fill + 6, S.features - 2, 10, 6);
  const form = sp(676);
  const pressed = frame >= 705 && frame < 712;
  const toast = sp(752);
  return (
    <AbsoluteFill style={{ opacity: o, flexDirection: "row", fontFamily: FONT, color: C["text-primary"] }}>
      <div style={{ flex: 1, padding: "36px 44px", borderRight: `1px solid ${C.border}` }}>
        <Label style={{ fontSize: 14 }}>Prompt · Explain simply</Label>
        <div style={{ marginTop: 22, fontFamily: MONO, fontSize: 26, lineHeight: 1.75 }}>
          Explain this <Chip from="{{lang=Python}}" to="Python" at={730} /> code to a beginner, step by step:
          <br />
          <br />
          <Chip from="{{clipboard}}" to="def add(a, b): return a + b" at={738} />
        </div>
      </div>
      <div style={{ width: 560, padding: "36px 40px", transform: `translateX(${(1 - form) * 60}px)`, opacity: form, display: "flex", flexDirection: "column", gap: 20 }}>
        <div style={{ fontSize: 24, fontWeight: 500 }}>Fill in the blanks</div>
        <div>
          <Label>lang</Label>
          <div style={{ marginTop: 8, height: 54, borderRadius: 999, border: `1px solid ${C["border-strong"]}`, display: "flex", alignItems: "center", padding: "0 20px", fontFamily: MONO, fontSize: 18 }}>
            {typed("Python", 684, 698)}
            {frame < 702 && <Caret h={22} />}
          </div>
        </div>
        <div>
          <Label>clipboard · filled in automatically</Label>
          <div style={{ marginTop: 8, height: 54, borderRadius: 999, background: C["surface-sunken"], border: `1px solid ${C.border}`, display: "flex", alignItems: "center", padding: "0 20px", fontFamily: MONO, fontSize: 18, color: C["text-secondary"] }}>
            def add(a, b): return a + b
          </div>
        </div>
        <div
          style={{
            marginTop: 10,
            alignSelf: "flex-start",
            padding: "14px 28px",
            borderRadius: 999,
            background: C.primary,
            color: C["on-primary"],
            fontSize: 18,
            fontWeight: 500,
            transform: `scale(${pressed ? 0.94 : 1})`,
          }}
        >
          Paste ↵
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          bottom: -80 + toast * 110,
          left: "50%",
          transform: "translateX(-50%)",
          padding: "12px 22px",
          borderRadius: 999,
          background: C["success-soft"],
          border: `1px solid ${C.success}`,
          color: C.success,
          fontSize: 18,
          fontWeight: 500,
          opacity: toast,
          whiteSpace: "nowrap",
        }}
      >
        ✓ Pasted into your chat
      </div>
    </AbsoluteFill>
  );
};

const FEATURES = [
  { shape: SHAPES.shield, t: "No account", d: "Nothing to sign up for." },
  { shape: SHAPES.monitor, t: "Works offline", d: "Your prompts stay on your computer." },
  { shape: SHAPES.star, t: "Free", d: "macOS · Windows · Linux" },
];

const FeaturesScene: React.FC = () => {
  const { sp, win } = useF();
  const o = win(S.features + 4, S.outro - 2, 8, 6);
  return (
    <AbsoluteFill style={{ opacity: o, flexDirection: "row", fontFamily: FONT, color: C["text-primary"] }}>
      {FEATURES.map((f, i) => {
        const m = sp(790 + i * 8, { damping: 14 });
        const t = Math.min(1, Math.max(0, m));
        return (
          <div key={f.t} style={{ flex: 1, padding: "46px 50px", borderLeft: i ? `1px solid ${C.border}` : undefined, display: "flex", flexDirection: "column", gap: 18 }}>
            <div style={{ fontFamily: MONO, fontSize: 14, color: C["text-muted"] }}>({String(i + 1).padStart(3, "0")})</div>
            <svg width="96" height="96" viewBox="0 0 100 100">
              <path d={morphPath(SHAPES.circle, f.shape, t)} fill={i === 2 ? C.accent : "none"} stroke={i === 2 ? C.accent : C.primary} strokeWidth={5} strokeLinejoin="round" />
            </svg>
            <div style={{ fontSize: 40, fontWeight: 500, letterSpacing: "-0.03em", opacity: t }}>{f.t}</div>
            <div style={{ fontSize: 20, color: C["text-secondary"], opacity: t }}>{f.d}</div>
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

const AppsMarquee: React.FC = () => {
  const { frame, win } = useF();
  const o = win(S.features + 6, S.outro - 2, 8, 6);
  const apps = "ChatGPT  ·  Claude  ·  Cursor  ·  VS Code  ·  Terminal  ·  Slack  ·  Notion  ·  Gemini  ·  ";
  return (
    <div style={{ position: "absolute", top: 905, left: 0, right: 0, overflow: "hidden", whiteSpace: "nowrap", opacity: o, fontFamily: MONO, fontSize: 22, letterSpacing: "0.06em", color: C["text-muted"] }}>
      <div style={{ transform: `translateX(${-(frame - S.features) * 6}px)` }}>{(apps + apps + apps).toUpperCase()}</div>
    </div>
  );
};

const Outro: React.FC = () => {
  const { sp, pop, win } = useF();
  const o = win(S.outro + 2, T.durationInFrames + 20, 4, 1);
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: o }}>
      <Mark size={150} draw={sp(S.outro + 6, { damping: 30 })} dot={pop(870)} />
    </AbsoluteFill>
  );
};

const OutroText: React.FC = () => {
  const { frame, fps } = useF();
  const word = "Clazy";
  const ring = interpolate(frame, [900, 940], [0, 1], clamp);
  return (
    <>
      <div
        style={{
          position: "absolute",
          left: 960 - 120 - ring * 260,
          top: 400 - 120 - ring * 260,
          width: 240 + ring * 520,
          height: 240 + ring * 520,
          borderRadius: "50%",
          border: `2px solid ${C.accent}`,
          opacity: frame >= 900 ? (1 - ring) * 0.8 : 0,
        }}
      />
      <div style={{ position: "absolute", top: 560, left: 0, right: 0, textAlign: "center" }}>
        <div style={{ fontFamily: FONT, fontSize: 150, fontWeight: 500, letterSpacing: "-0.05em", lineHeight: 1, color: C["text-primary"] }}>
          {word.split("").map((ch, i) => {
            const p = spring({ frame: frame - 878 - i * 3, fps, config: { damping: 16, stiffness: 150 } });
            return (
              <span key={i} style={{ display: "inline-block", overflow: "hidden", verticalAlign: "top" }}>
                <span style={{ display: "inline-block", transform: `translateY(${(1 - p) * 100}%)` }}>{ch}</span>
              </span>
            );
          })}
        </div>
        <div style={{ fontFamily: FONT, fontSize: 36, fontWeight: 400, color: C["text-secondary"], marginTop: 22, opacity: interpolate(frame, [902, 916], [0, 1], clamp) }}>
          Your best prompts, one keystroke away.
        </div>
        <div style={{ display: "inline-flex", gap: 14, marginTop: 44, opacity: interpolate(frame, [924, 938], [0, 1], clamp) }}>
          <span style={{ padding: "16px 30px", borderRadius: 999, background: C.primary, color: C["on-primary"], fontFamily: FONT, fontSize: 22, fontWeight: 500 }}>Download free</span>
          <span style={{ padding: "16px 30px", borderRadius: 999, border: `1px solid ${C["border-strong"]}`, color: C["text-primary"], fontFamily: MONO, fontSize: 18, display: "flex", alignItems: "center" }}>
            MACOS · WINDOWS · LINUX
          </span>
        </div>
      </div>
    </>
  );
};

// ---------------------------------------------------------------------------------------------
export const Demo: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const m = morphAt(K, frame, fps);
  const fadeOut = interpolate(frame, [T.durationInFrames - 14, T.durationInFrames - 1], [1, 0], clamp);

  return (
    <AbsoluteFill style={{ background: C.background }}>
      <Audio src={staticFile("music.wav")} />
      <AbsoluteFill style={{ opacity: fadeOut }}>
        <Background />

        {/* headlines */}
        <Headline from={S.problem + 2} to={S.save - 2} text="You retype the same prompt" y={150} />
        <Headline from={S.save} to={S.hotkey - 2} tag="01 — SAVE" text="Save it once." y={36} />
        <Headline from={S.hotkey} to={S.trigger - 2} tag="02 — HOTKEY" text="Press a key. It's pasted." y={90} />
        <Headline from={S.trigger} to={S.palette - 2} tag="03 — TEXT TRIGGER" text="Or just type ;push" y={150} accent=";push" />
        <Headline from={S.palette} to={S.fill - 2} tag="04 — QUICK PALETTE" text="Search every prompt." y={90} />
        <Headline from={S.fill} to={S.features - 2} tag="05 — FILL-INS" text="Blanks fill themselves." y={90} />
        <Headline from={S.features} to={S.outro - 2} tag="PRIVATE BY DESIGN" text="Offline. No account. Free." y={180} />

        <ProblemGhosts />
        <HotkeyKeys />
        <TriggerBadge />
        <PaletteKeys />
        <AppsMarquee />

        {/* the morphing shape */}
        <div
          style={{
            position: "absolute",
            left: m.cx - m.w / 2,
            top: m.cy - m.h / 2,
            width: m.w,
            height: m.h,
            borderRadius: Math.min(m.r, m.h / 2, m.w / 2),
            background: m.bg,
            border: `1px solid ${m.border}`,
            overflow: "hidden",
            boxShadow: "0 1px 0 rgba(255,255,255,.06) inset, 0 50px 120px -40px rgba(0,0,0,.95)",
          }}
        >
          {/* scene content is laid out at the target size and centred in the (springing) box */}
          <SceneSlot w={240} h={240} m={m}>
            <Intro />
          </SceneSlot>
          <SceneSlot w={1240} h={104} m={m}>
            <Problem />
          </SceneSlot>
          <SceneSlot w={1560} h={770} m={m} scale={1.3}>
            <AppWindow />
          </SceneSlot>
          <SceneSlot w={1180} h={190} m={m}>
            <HotkeyScene />
          </SceneSlot>
          <SceneSlot w={1180} h={Math.max(130, m.h)} m={m}>
            <TriggerScene />
          </SceneSlot>
          <SceneSlot w={980} h={m.h} m={m} scale={1.15}>
            <PaletteScene />
          </SceneSlot>
          <SceneSlot w={1560} h={500} m={m} scale={1.1}>
            <FillScene />
          </SceneSlot>
          <SceneSlot w={1600} h={400} m={m}>
            <FeaturesScene />
          </SceneSlot>
          <SceneSlot w={240} h={240} m={m}>
            <Outro />
          </SceneSlot>
        </div>

        <IntroText />
        {frame >= S.outro && <OutroText />}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const SceneSlot: React.FC<{ w: number; h: number; m: { w: number; h: number }; scale?: number; children: React.ReactNode }> = ({ w, h, m, scale = 1, children }) => (
  <div style={{ position: "absolute", width: w, height: h, left: (m.w - w) / 2, top: (m.h - h) / 2 }}>
    {/* content is laid out smaller and scaled up so UI text stays legible on a phone */}
    <div style={{ position: "absolute", width: w / scale, height: h / scale, transform: `scale(${scale})`, transformOrigin: "0 0" }}>{children}</div>
  </div>
);
