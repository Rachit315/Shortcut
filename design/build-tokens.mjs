#!/usr/bin/env node
// Generates CSS custom properties from design/tokens.json for the app and the landing page.
// Usage: node design/build-tokens.mjs          (write)
//        node design/build-tokens.mjs --check  (exit 1 if generated files are stale — used in CI)
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const tokens = JSON.parse(readFileSync(join(here, "tokens.json"), "utf8"));
const targets = [join(root, "app/src/styles/tokens.css"), join(root, "site/assets/tokens.css")];

const lines = [];
for (const [k, v] of Object.entries(tokens.color)) lines.push(`  --color-${k}: ${v};`);
for (const [k, v] of Object.entries(tokens.font)) lines.push(`  --font-${k}: ${v};`);
for (const [k, t] of Object.entries(tokens.type)) {
  lines.push(`  --text-${k}-size: ${t.size};`);
  lines.push(`  --text-${k}-weight: ${t.weight};`);
  lines.push(`  --text-${k}-line-height: ${t["line-height"]};`);
  lines.push(`  --text-${k}-letter-spacing: ${t["letter-spacing"]};`);
}
for (const [k, v] of Object.entries(tokens.space)) lines.push(`  --space-${k}: ${v};`);
for (const [k, v] of Object.entries(tokens.radius)) lines.push(`  --radius-${k}: ${v};`);
for (const [k, v] of Object.entries(tokens.shadow)) lines.push(`  --shadow-${k}: ${v};`);
for (const [k, v] of Object.entries(tokens.motion)) lines.push(`  --motion-${k}: ${v};`);
for (const [k, v] of Object.entries(tokens.breakpoint)) lines.push(`  --bp-${k}: ${v};`);

const css = `/* Generated from design/tokens.json by design/build-tokens.mjs — do not edit by hand. */
:root {
${lines.join("\n")}
}
`;

const check = process.argv.includes("--check");
let stale = false;
for (const file of targets) {
  const current = existsSync(file) ? readFileSync(file, "utf8") : "";
  if (current === css) continue;
  if (check) {
    console.error(`stale: ${file}`);
    stale = true;
  } else {
    writeFileSync(file, css);
    console.log(`wrote ${file}`);
  }
}
if (stale) {
  console.error("Run `node design/build-tokens.mjs` and commit the result.");
  process.exit(1);
}
