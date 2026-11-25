// Loopback-only static component preview. Not part of either Cloudflare bundle.
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const csp =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none'; frame-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
export async function createUiPreview({ port = 4180 } = {}) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1"),
      type = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".svg": "image/svg+xml",
        ".png": "image/png",
      };
    res.setHeader("Content-Security-Policy", csp);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405).end();
      return;
    }
    if (url.pathname === "/favicon.ico") {
      res.writeHead(204).end();
      return;
    }
    let file;
    if (["/", "/index.html"].includes(url.pathname))
      file = "dev/ui-components/index.html";
    else if (["/preview.js", "/preview.css"].includes(url.pathname))
      file = "dev/ui-components" + url.pathname;
    else if (
      /^\/ui\/(tokens\.css|components\.css|components\.js|icons\.svg)$/.test(
        url.pathname,
      )
    )
      file = "src" + url.pathname;
    else if(url.pathname==="/shared/view.js")file="src/shared/view.js";
    else if (/^\/reference\/[A-Za-z]+\.png$/.test(url.pathname))
      file = "dev/ui-components/reference/" + path.basename(url.pathname);
    else if (/^\/shots\/[A-Za-z0-9_-]+\.png$/.test(url.pathname))
      file = "work/screenshots/stage10a/" + path.basename(url.pathname);

    if (!file) {
      res.writeHead(404).end("不存在");
      return;
    }
    try {
      const data = await readFile(path.join(root, file));
      res.setHeader(
        "Content-Type",
        type[path.extname(file)] || "application/octet-stream",
      );
      res.writeHead(200);
      res.end(req.method === "HEAD" ? undefined : data);
    } catch {
      res.writeHead(404).end("不存在");
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return {
    server,
    url: "http://127.0.0.1:" + server.address().port,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      ),
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const preview = await createUiPreview({
    port: Number(process.env.UI_PREVIEW_PORT || 4180),
  });
  console.log("组件展示页（仅开发）：" + preview.url);
}
