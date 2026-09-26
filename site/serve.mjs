// Tiny local server that mimics vercel.json (static files + /download redirects) for tests.
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const config = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8"));
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };
const port = Number(process.env.PORT || 4173);

createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  const redirect = config.redirects.find((r) => r.source === url.pathname);
  if (redirect) {
    res.writeHead(307, { Location: redirect.destination });
    return res.end();
  }
  let path = normalize(join(root, decodeURIComponent(url.pathname)));
  if (!path.startsWith(root)) return res.writeHead(403).end();
  if (existsSync(path) && statSync(path).isDirectory()) path = join(path, "index.html");
  if (!existsSync(path)) return res.writeHead(404).end("Not found");
  res.writeHead(200, { "Content-Type": types[extname(path)] || "application/octet-stream" });
  res.end(readFileSync(path));
}).listen(port, "127.0.0.1", () => console.log(`site on http://127.0.0.1:${port}`));
