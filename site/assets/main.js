// Clazy landing page: dither field, HUD demo, reveals, feature rows and download links.
const cfg = window.CLAZY_CONFIG || { repo: "Rachit315/Shortcut" };
const REPO_URL = `https://github.com/${cfg.repo}`;
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

document.documentElement.classList.remove("no-js");
requestAnimationFrame(() => document.body.classList.add("loaded"));

// ---------------------------------------------------------------- reveals

const revealObserver = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (e.isIntersecting) {
        e.target.classList.add("in");
        revealObserver.unobserve(e.target);
      }
    }
  },
  { rootMargin: "0px 0px -6% 0px", threshold: 0.06 },
);
document.querySelectorAll(".reveal").forEach((el) => revealObserver.observe(el));

// ---------------------------------------------------------------- HUD dial ticks

const ticks = document.querySelector(".dial .ticks");
if (ticks) {
  const ns = "http://www.w3.org/2000/svg";
  for (let i = 0; i < 25; i++) {
    const x = 104 + i * 8;
    const line = document.createElementNS(ns, "line");
    line.setAttribute("x1", String(x));
    line.setAttribute("x2", String(x));
    line.setAttribute("y1", String(i % 5 === 0 ? 236 : 242));
    line.setAttribute("y2", "260");
    ticks.append(line);
  }
}

// ---------------------------------------------------------------- feature rows (accordion)

document.querySelectorAll(".row").forEach((row, i) => {
  const btn = row.querySelector(".row-toggle");
  const set = (open) => {
    row.classList.toggle("open", open);
    btn.setAttribute("aria-expanded", String(open));
  };
  btn.addEventListener("click", () => set(!row.classList.contains("open")));
  if (i === 0) set(true);
});

// ---------------------------------------------------------------- WebGL dither (cream dots on black)

const VERT = `attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;
const FRAG = `
precision mediump float;
uniform vec2 u_res;
uniform float u_time;
uniform vec2 u_mouse;
uniform float u_cell;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p){
  float v = 0.0; float a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
  return v;
}
float bayer2(vec2 a){ a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
float bayer4(vec2 a){ return bayer2(0.5 * a) * 0.25 + bayer2(a); }
float bayer8(vec2 a){ return bayer4(0.5 * a) * 0.25 + bayer2(a); }

void main(){
  vec2 cell = floor(gl_FragCoord.xy / u_cell);
  vec2 uv = (cell * u_cell) / u_res.y;
  float t = u_time * 0.04;
  vec2 q = vec2(fbm(uv * 1.3 + vec2(t, -t)), fbm(uv * 1.3 + vec2(-t, t) + 3.7));
  float n = fbm(uv * 2.0 + 2.4 * q + vec2(t * 1.2, 0.0));
  vec2 m = u_mouse / u_res.y;
  float d = distance(uv, m);
  n += 0.18 * exp(-d * d * 20.0) * (0.6 + 0.4 * sin(d * 44.0 - u_time * 3.0));
  float edge = smoothstep(0.15, 0.95, gl_FragCoord.y / u_res.y) * 0.6 + 0.4;
  float shade = smoothstep(0.45, 0.9, n) * edge;
  float on = step(bayer8(cell), shade);
  vec2 f = fract(gl_FragCoord.xy / u_cell);
  float sq = step(0.25, f.x) * step(f.x, 0.75) * step(0.25, f.y) * step(f.y, 0.75);
  vec3 cream = vec3(0.949, 0.941, 0.922);
  vec3 signal = vec3(1.0, 0.302, 0.180);
  vec3 ink = hash(cell + floor(u_time * 0.4)) > 0.994 ? signal : cream;
  float a = on * sq * 0.5;
  gl_FragColor = vec4(ink * a, a);
}`;

function startDither(canvas) {
  const gl = canvas.getContext("webgl", { antialias: false, alpha: true, premultipliedAlpha: true });
  if (!gl) return false;
  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || "shader");
    return s;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false;
  gl.useProgram(prog);
  gl.clearColor(0, 0, 0, 0);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "p");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const uRes = gl.getUniformLocation(prog, "u_res");
  const uTime = gl.getUniformLocation(prog, "u_time");
  const uMouse = gl.getUniformLocation(prog, "u_mouse");
  const uCell = gl.getUniformLocation(prog, "u_cell");

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let w = 1, h = 1;
  const mouse = { x: -9999, y: -9999, tx: -9999, ty: -9999 };
  const start = performance.now();
  const draw = (now) => {
    mouse.x += (mouse.tx - mouse.x) * 0.08;
    mouse.y += (mouse.ty - mouse.y) * 0.08;
    gl.uniform2f(uRes, w, h);
    gl.uniform1f(uTime, reduceMotion ? 14 : (now - start) / 1000);
    gl.uniform2f(uMouse, mouse.x, mouse.y);
    gl.uniform1f(uCell, 6 * dpr);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  const resize = () => {
    const r = canvas.getBoundingClientRect();
    w = Math.max(1, Math.round(r.width * dpr));
    h = Math.max(1, Math.round(r.height * dpr));
    canvas.width = w;
    canvas.height = h;
    gl.viewport(0, 0, w, h);
    draw(performance.now());
  };
  resize();
  new ResizeObserver(resize).observe(canvas);
  const host = canvas.parentElement;
  host.addEventListener("pointermove", (e) => {
    const r = canvas.getBoundingClientRect();
    mouse.tx = (e.clientX - r.left) * dpr;
    mouse.ty = (r.height - (e.clientY - r.top)) * dpr;
    if (mouse.x < -999) {
      mouse.x = mouse.tx;
      mouse.y = mouse.ty;
    }
  });
  host.addEventListener("pointerleave", () => (mouse.tx = mouse.ty = -9999));
  canvas.addEventListener("webglcontextlost", () => canvas.classList.remove("ready"));

  let visible = true;
  let raf = 0;
  const loop = () => {
    cancelAnimationFrame(raf);
    const tick = (now) => {
      if (!visible || document.hidden) return;
      draw(now);
      if (!reduceMotion) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  };
  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (visible) loop();
  }).observe(canvas);
  document.addEventListener("visibilitychange", () => !document.hidden && loop());
  loop();
  requestAnimationFrame(() => canvas.classList.add("ready"));
  return true;
}

document.querySelectorAll("canvas.dither").forEach((c) => {
  try {
    if (!startDither(c)) c.remove();
  } catch {
    c.remove();
  }
});

// ---------------------------------------------------------------- HUD demo

const demoText = document.querySelector("[data-demo-text]");
const demoHint = document.querySelector("[data-demo-hint]");
const keys = [...document.querySelectorAll(".demo-keys kbd")];
const REVIEW = "Review the following code as a senior engineer. List bugs, security issues and missing tests, ordered by severity, with a concrete fix for each.";
const PUSH = "Look at my staged and unstaged changes, group them into logical commits with Conventional Commit messages, show me the list, then push the branch.";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function showExpanded(text) {
  const span = document.createElement("span");
  span.className = "flash";
  span.textContent = text;
  demoText.replaceChildren(span);
}

async function runDemo() {
  if (!demoText) return;
  if (reduceMotion) {
    showExpanded(REVIEW);
    demoHint.textContent = ";REVIEW → PASTED";
    return;
  }
  let visible = true;
  new IntersectionObserver(([e]) => (visible = e.isIntersecting)).observe(demoText);
  await sleep(1200);
  for (;;) {
    while (!visible || document.hidden) await sleep(400);
    demoHint.textContent = "TYPING";
    demoText.textContent = "";
    for (const ch of ";review") {
      demoText.textContent += ch;
      await sleep(110);
    }
    await sleep(360);
    showExpanded(REVIEW);
    demoHint.textContent = "TRIGGER ;REVIEW → PASTED";
    await sleep(2800);
    demoText.textContent = "";
    demoHint.textContent = "HOTKEY";
    await sleep(500);
    for (const k of keys) {
      k.classList.add("down");
      await sleep(170);
    }
    showExpanded(PUSH);
    demoHint.textContent = "CTRL+ALT+1 → PASTED";
    await sleep(260);
    keys.forEach((k) => k.classList.remove("down"));
    await sleep(3000);
  }
}
void runDemo();

// ---------------------------------------------------------------- downloads

export function detectOs(ua = navigator.userAgent || "", platform = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || "") {
  if (/android|iphone|ipad|ipod/i.test(ua)) return "mobile";
  if (/mac/i.test(platform) || /Macintosh/.test(ua)) return "macos";
  if (/win/i.test(platform) || /Windows/.test(ua)) return "windows";
  if (/linux|x11/i.test(platform + ua)) return "linux";
  return "unknown";
}

const OS_LABEL = { macos: "macOS", windows: "Windows", linux: "Linux" };
// Stable redirect paths (see vercel.json) → GitHub "latest release" assets with fixed names.
const OS_DOWNLOAD = { macos: "/download/macos", windows: "/download/windows", linux: "/download/linux-deb" };

function setup() {
  document.querySelectorAll("[data-repo-link]").forEach((a) => (a.href = REPO_URL));
  document.querySelectorAll("[data-releases-link]").forEach((a) => (a.href = `${REPO_URL}/releases`));
  document.querySelectorAll("[data-prd-link]").forEach((a) => (a.href = `${REPO_URL}/blob/HEAD/docs/PRD.md`));

  const os = detectOs();
  document.documentElement.dataset.os = os;
  document.querySelector(`.dl[data-os="${os}"]`)?.classList.add("detected");
  document.querySelectorAll("[data-primary-label]").forEach((l) => {
    if (OS_LABEL[os]) l.textContent = `Download for ${OS_LABEL[os]}`;
    else if (os === "mobile") l.textContent = "Get it for your computer";
  });
  if (OS_DOWNLOAD[os]) {
    document.querySelectorAll("a[data-primary-download]").forEach((a) => (a.href = OS_DOWNLOAD[os]));
  }
}
setup();

// Before the first release exists, /download/* would 404 on GitHub. Show an honest
// "coming soon" state instead of dead links.
function markNoRelease() {
  document.documentElement.dataset.release = "none";
  const notice = document.querySelector("[data-release-notice]");
  if (notice) notice.hidden = false;
  document.querySelectorAll("[data-asset]").forEach((a) => {
    a.setAttribute("href", `${REPO_URL}/releases`);
    a.setAttribute("aria-disabled", "true");
    if (a.classList.contains("pill")) a.textContent = "Installer coming soon";
  });
  document.querySelectorAll("a[data-primary-download]").forEach((a) => a.setAttribute("href", "#download"));
  const v = document.querySelector("[data-version]");
  if (v) v.textContent = "FIRST RELEASE IN PROGRESS";
}

// Show the current version and detect whether a release exists yet (best effort: if the
// API is unreachable or rate-limited the download links are left as they are).
async function checkRelease() {
  const el = document.querySelector("[data-version]");
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(`https://api.github.com/repos/${cfg.repo}/releases/latest`, { signal: ctrl.signal, headers: { Accept: "application/vnd.github+json" } });
    clearTimeout(timer);
    if (res.status === 404) return markNoRelease();
    if (!res.ok) return;
    const release = await res.json();
    if (el && release.tag_name) el.textContent = `LATEST ${release.tag_name.toUpperCase()}`;
  } catch {
    /* offline or rate-limited: keep the links */
  }
}
void checkRelease();
