/* Local APPROXIMATION of the production host, used only to prove that scripts/smoke-test.mjs and hosting/_headers
   behave as intended. It serves ./dist like html_handling="none" + not_found_handling="404-page" and applies the
   rules in dist/_headers. It is NOT Cloudflare; the real check is `scripts/smoke-test.mjs` on the preview URL.
   Run:  node scripts/build-static.mjs && node tests/deploy/emulate-and-smoke.mjs */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const dist = path.join(root, "dist");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".webmanifest": "application/manifest+json", ".ico": "image/x-icon", ".xml": "application/xml", ".txt": "text/plain" };

// minimal _headers parser: blocks of "pattern" followed by indented "Name: value"
const rules = []; let cur = null;
for (const line of fs.readFileSync(path.join(dist, "_headers"), "utf8").split("\n")) {
  if (!line.trim() || line.trim().startsWith("#")) continue;
  if (/^\S/.test(line)) { cur = { re: new RegExp("^" + line.trim().replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$"), h: [] }; rules.push(cur); }
  else { const i = line.indexOf(":"); cur.h.push([line.slice(0, i).trim(), line.slice(i + 1).trim()]); }
}
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]); const rel = url === "/" ? "index.html" : url.slice(1);
  const f = path.join(dist, rel);
  const found = f.startsWith(dist) && fs.existsSync(f) && fs.statSync(f).isFile() && rel !== "_headers";
  const headers = { "content-type": TYPES[path.extname(f)] || "application/octet-stream" };
  for (const r of rules) if (r.re.test(url)) for (const [k, v] of r.h) headers[k.toLowerCase()] = headers[k.toLowerCase()] ? headers[k.toLowerCase()] + ", " + v : v;
  if (!found) { res.writeHead(404, { ...headers, "content-type": "text/html; charset=utf-8" }); return res.end(fs.readFileSync(path.join(dist, "404.html"))); }
  res.writeHead(200, headers); fs.createReadStream(f).pipe(res);
});
server.listen(0, () => {
  const base = "http://127.0.0.1:" + server.address().port;
  // async spawn: the server must keep answering while the smoke test runs
  const child = spawn(process.execPath, [path.join(root, "scripts", "smoke-test.mjs"), base], { stdio: "inherit" });
  child.on("exit", (code) => { server.close(); process.exit(code ?? 1); });
});
