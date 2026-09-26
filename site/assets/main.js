// Shortcut landing page: dither background, live demo, reveals and download links.
const cfg = window.SHORTCUT_CONFIG || { repo: "Rachit315/Shortcut" };
const REPO_URL = `https://github.com/${cfg.repo}`;
const RELEASES_URL = `${REPO_URL}/releases/latest`;
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

document.documentElement.classList.remove("no-js");
requestAnimationFrame(() => document.body.classList.add("loaded"));

// ---------------------------------------------------------------- nav + reveals

const nav = document.querySelector(".nav");
const onScroll = () => nav.classList.toggle("scrolled", window.scrollY > 8);
window.addEventListener("scroll", onScroll, { passive: true });
onScroll();

const revealObserver = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (e.isIntersecting) {
        e.target.classList.add("in");
        revealObserver.unobserve(e.target);
      }
    }
  },
  { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
);
document.querySelectorAll(".reveal").forEach((el) => revealObserver.observe(el));

// ---------------------------------------------------------------- WebGL dither

const VERT = `attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;
const FRAG = `
precision mediump float;
uniform vec2 u_res;
uniform float u_time;
uniform vec2 u_mouse;
uniform float u_cell;
uniform float u_density;
uniform vec2 u_focus;

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
  float t = u_time * 0.045;
  vec2 q = vec2(fbm(uv * 1.4 + vec2(t, -t)), fbm(uv * 1.4 + vec2(-t, t) + 3.7));
  float n = fbm(uv * 2.1 + 2.2 * q + vec2(t * 1.3, 0.0));
  vec2 m = u_mouse / u_res.y;
  float d = distance(uv, m);
  n += 0.16 * exp(-d * d * 22.0) * (0.6 + 0.4 * sin(d * 46.0 - u_time * 3.2));
  // keep the area behind the headline calmer
  float calm = smoothstep(0.0, 0.9, distance(gl_FragCoord.xy / u_res, u_focus));
  float shade = smoothstep(0.42, 0.86, n) * mix(0.25, 1.0, calm) * u_density;
  float on = step(bayer8(cell), shade);
  vec2 f = fract(gl_FragCoord.xy / u_cell);
  float sq = step(0.2, f.x) * step(f.x, 0.8) * step(0.2, f.y) * step(f.y, 0.8);
  vec3 blue = vec3(0.231, 0.510, 0.965);
  vec3 red = vec3(0.937, 0.267, 0.267);
  vec3 ink = hash(cell + floor(u_time * 0.5)) > 0.992 ? red : blue;
  float a = on * sq * 0.6;
  gl_FragColor = vec4(ink * a, a);
}`;

function startDither(canvas, { density = 1, focus = [0.3, 0.62] } = {}) {
  const gl = canvas.getContext("webgl", { antialias: false, alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: false });
  if (!gl) return false;
  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false;
  gl.useProgram(prog);
  gl.clearColor(0, 0, 0, 0);
  canvas.addEventListener("webglcontextlost", () => canvas.classList.remove("ready"));
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "p");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const u = (n) => gl.getUniformLocation(prog, n);
  const uRes = u("u_res"), uTime = u("u_time"), uMouse = u("u_mouse"), uCell = u("u_cell"), uDensity = u("u_density"), uFocus = u("u_focus");

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let w = 0, h = 0;
  const mouse = { x: -9999, y: -9999, tx: -9999, ty: -9999 };
  const resize = () => {
    const r = canvas.getBoundingClientRect();
    w = Math.max(1, Math.round(r.width * dpr));
    h = Math.max(1, Math.round(r.height * dpr));
    canvas.width = w;
    canvas.height = h;
    gl.viewport(0, 0, w, h);
    if (reduceMotion) requestAnimationFrame((t) => draw(t));
  };
  resize();
  new ResizeObserver(resize).observe(canvas);
  canvas.parentElement.addEventListener("pointermove", (e) => {
    const r = canvas.getBoundingClientRect();
    mouse.tx = (e.clientX - r.left) * dpr;
    mouse.ty = (r.height - (e.clientY - r.top)) * dpr;
    if (mouse.x < -999) { mouse.x = mouse.tx; mouse.y = mouse.ty; }
  });
  canvas.parentElement.addEventListener("pointerleave", () => { mouse.tx = mouse.ty = -9999; });

  let visible = true;
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) loop(); }).observe(canvas);
  const start = performance.now();
  let raf = 0;
  const draw = (now) => {
    mouse.x += (mouse.tx - mouse.x) * 0.08;
    mouse.y += (mouse.ty - mouse.y) * 0.08;
    gl.uniform2f(uRes, w, h);
    gl.uniform1f(uTime, reduceMotion ? 12 : (now - start) / 1000);
    gl.uniform2f(uMouse, mouse.x, mouse.y);
    gl.uniform1f(uCell, 5 * dpr);
    gl.uniform1f(uDensity, density);
    gl.uniform2f(uFocus, focus[0], focus[1]);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  function loop() {
    cancelAnimationFrame(raf);
    const tick = (now) => {
      if (!visible || document.hidden) return;
      draw(now);
      if (!reduceMotion) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }
  document.addEventListener("visibilitychange", () => !document.hidden && loop());
  loop();
  requestAnimationFrame(() => canvas.classList.add("ready"));
  return true;
}

let webgl = true;
document.querySelectorAll("canvas.dither").forEach((c) => {
  try {
    const final = c.classList.contains("dither-final");
    if (!startDither(c, final ? { density: 0.8, focus: [0.5, 0.5] } : {})) webgl = false;
  } catch {
    webgl = false;
  }
});
if (!webgl) document.documentElement.classList.add("no-webgl");

// ---------------------------------------------------------------- live demo

const demoText = document.querySelector("[data-demo-text]");
const demoHint = document.querySelector("[data-demo-hint]");
const keys = [...document.querySelectorAll(".demo-keys kbd")];
const REVIEW = "Review the following code as a senior engineer. List bugs, security issues and missing tests, ordered by severity, with a concrete fix for each.";
const PUSH = "Look at my staged and unstaged changes, group them into logical commits with Conventional Commit messages, show me the list, then push the branch.";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function showExpanded(text) {
  demoText.textContent = "";
  const span = document.createElement("span");
  span.className = "flash";
  span.textContent = text;
  demoText.append(span);
}

async function runDemo() {
  if (!demoText) return;
  if (reduceMotion) {
    showExpanded(REVIEW);
    demoHint.textContent = ";review → expanded";
    return;
  }
  let visible = true;
  new IntersectionObserver(([e]) => (visible = e.isIntersecting)).observe(demoText);
  await sleep(1400);
  for (;;) {
    while (!visible || document.hidden) await sleep(400);
    demoHint.textContent = "typing";
    demoText.textContent = "";
    for (const ch of ";review") {
      demoText.textContent += ch;
      await sleep(110);
    }
    await sleep(380);
    showExpanded(REVIEW);
    demoHint.textContent = "text trigger · ;review";
    await sleep(2800);

    demoText.textContent = "";
    demoHint.textContent = "hotkey";
    await sleep(500);
    for (const k of keys) {
      k.classList.add("down");
      await sleep(170);
    }
    showExpanded(PUSH);
    demoHint.textContent = "hotkey · Ctrl+Alt+1";
    await sleep(260);
    keys.forEach((k) => k.classList.remove("down"));
    await sleep(3000);
  }
}
void runDemo();

// ---------------------------------------------------------------- downloads

function detectOs() {
  const ua = navigator.userAgent || "";
  const platform = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || "";
  if (/android|iphone|ipad|ipod/i.test(ua)) return "mobile";
  if (/mac/i.test(platform) || /Macintosh/.test(ua)) return "macos";
  if (/win/i.test(platform) || /Windows/.test(ua)) return "windows";
  if (/linux|x11/i.test(platform + ua)) return "linux";
  return "unknown";
}

const OS_LABEL = { macos: "macOS", windows: "Windows", linux: "Linux" };
const PRIMARY_ASSET = { macos: "dmg", windows: "exe", linux: "deb" };

export function pickAssets(assets) {
  const find = (re, prefer) => {
    const all = assets.filter((a) => re.test(a.name));
    return (prefer && all.find((a) => prefer.test(a.name))) || all[0];
  };
  return {
    dmg: find(/\.dmg$/i, /universal/i),
    exe: find(/setup\.exe$/i) || find(/\.exe$/i),
    msi: find(/\.msi$/i),
    deb: find(/\.deb$/i, /amd64|x86_64/i),
    appimage: find(/\.AppImage$/i, /amd64|x86_64/i),
  };
}

function setLinks() {
  document.querySelectorAll("[data-repo-link]").forEach((a) => (a.href = REPO_URL));
  document.querySelectorAll("[data-releases-link]").forEach((a) => (a.href = `${REPO_URL}/releases`));
  document.querySelectorAll("[data-prd-link]").forEach((a) => (a.href = `${REPO_URL}/blob/main/docs/PRD.md`));
  document.querySelectorAll("[data-asset]").forEach((a) => (a.href = RELEASES_URL));
}

async function resolveDownloads() {
  setLinks();
  const os = detectOs();
  const card = document.querySelector(`.dl[data-os="${os}"]`);
  if (card) card.classList.add("detected");
  const labels = document.querySelectorAll("[data-primary-label]");
  if (OS_LABEL[os]) labels.forEach((l) => (l.textContent = `Download for ${OS_LABEL[os]}`));
  else if (os === "mobile") labels.forEach((l) => (l.textContent = "Get it for your computer"));

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(`https://api.github.com/repos/${cfg.repo}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json" },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`GitHub API ${res.status}`);
    const release = await res.json();
    const picked = pickAssets(release.assets || []);
    document.querySelectorAll("[data-asset]").forEach((a) => {
      const asset = picked[a.dataset.asset];
      if (asset) {
        a.href = asset.browser_download_url;
        a.dataset.resolved = "true";
        const mb = asset.size ? ` · ${(asset.size / 1048576).toFixed(1)} MB` : "";
        a.title = `${asset.name}${mb}`;
      }
    });
    const v = document.querySelector("[data-version]");
    if (v && release.tag_name) v.textContent = `· ${release.tag_name}`;
    const primary = picked[PRIMARY_ASSET[os]];
    if (primary) document.querySelectorAll("a[data-primary-download]").forEach((a) => (a.href = primary.browser_download_url));
  } catch {
    // No release yet or offline: every download link already points at the releases page.
  }
}
void resolveDownloads();
