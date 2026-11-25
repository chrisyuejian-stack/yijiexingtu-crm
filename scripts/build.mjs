import { tenantAssets } from "./frontend-bundle.mjs";
import vm from "node:vm";
import { readFile, mkdir, writeFile, rm, copyFile } from "node:fs/promises";
import path from "node:path";
const out = "dist";
await rm(out, { recursive: true, force: true });
await mkdir(out + "/assets", { recursive: true });
await mkdir(out + "/console-assets", { recursive: true });
await mkdir(out + "/share", { recursive: true });
// 无第三方运行时；打包成单个 Pages Advanced Mode Worker。源码留在独立交付包。
const completed = new Map();
let chunks = [];
async function bundle(file) {
  file = path.resolve(file);
  if (completed.has(file)) return completed.get(file);
  const symbol = "module_" + completed.size;
  completed.set(file, symbol);
  let code = await readFile(file, "utf8");
  const importRx = /import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"];?/g;
  let imports = [],
    match;
  while ((match = importRx.exec(code)))
    imports.push({ full: match[0], names: match[1], file: match[2] });
  for (const entry of imports) {
    const dep = await bundle(path.resolve(path.dirname(file), entry.file));
    code = code.replace(entry.full, `const {${entry.names}}=${dep};`);
  }
  let names = [];
  for (const m of code.matchAll(
    /export (?:async )?(?:function|class|const|let)\s+(\w+)/g,
  ))
    names.push(m[1]);
  if (/export default worker;/.test(code)) {
    names.push("default:worker");
    code = code.replace("export default worker;", "");
  }
  code = code.replace(
    /\bexport (?=(?:async )?(?:function|class|const|let)\b)/g,
    "",
  );
  chunks.push(
    `const ${symbol}=(()=>{\n${code}\nreturn {${names.join(",")}};\n})();`,
  );
  return symbol;
}
const entry = await bundle("src/server/worker.js");
await writeFile(
  out + "/_worker.js",
  chunks.join("\n") + `\nexport default ${entry}.default;\n`,
);
await copyFile("src/tenant/index.html", out + "/tenant.html");
await copyFile("src/share/index.html", out + "/share/index.html");
await copyFile("src/console/index.html", out + "/console.html");
for (const app of ["tenant", "console"]) {
  const directory = app === "tenant" ? "assets" : "console-assets";
  await copyFile(`src/${app}/app.js`, `${out}/${directory}/${app}.js`);
  await copyFile(`src/${app}/app.css`, `${out}/${directory}/${app}.css`);
}
const frontend = await tenantAssets();
await writeFile(out + "/assets/tenant.js", frontend.js);
await writeFile(out + "/assets/tenant.css", frontend.css);
await copyFile(
  "src/console/vendor/pinyin-pro.js",
  out + "/console-assets/pinyin-pro.js",
);
await copyFile(
  "src/console/vendor/pinyin-pro.LICENSE",
  out + "/console-assets/pinyin-pro.LICENSE",
);
await writeFile(
  out + "/_routes.json",
  JSON.stringify({ version: 1, include: ["/*"], exclude: [] }),
);
await writeFile(
  out + "/index.html",
  '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>教务管理系统</title><p>请使用机构提供的登录地址</p></html>',
);
console.log("Pages 包已生成：dist/");

completed.clear();
chunks = [];
const backupEntry = await bundle("src/server/backup.js");
await mkdir("backup-dist", { recursive: true });
await writeFile(
  "backup-dist/backup-worker.js",
  chunks.join("\n") + `\nexport default ${backupEntry}.default;\n`,
);
console.log("定时备份 Worker 已生成：backup-dist/backup-worker.js");

// 仅构建环境执行固定版本离线工具；生产代码没有eval/Function或source map。
const buildContext = vm.createContext({ console });
vm.runInContext(
  await readFile("scripts/vendor/terser-5.44.1.cjs", "utf8"),
  buildContext,
);
const paths = [
  "dist/_worker.js",
  "backup-dist/backup-worker.js",
  "dist/assets/tenant.js",
  "dist/console-assets/console.js",
];
const sizes = [];
for (const file of paths) {
  const original = await readFile(file, "utf8");
  const result = await buildContext.Terser.minify(original, {
    module: true,
    compress: { passes: 2 },
    mangle: { toplevel: true },
    sourceMap: false,
    format: { comments: false },
  });
  if (!result.code || result.map) throw Error("生产压缩失败");
  await writeFile(file, result.code + "\n");
  sizes.push({
    file,
    before: Buffer.byteLength(original),
    after: Buffer.byteLength(result.code + "\n"),
  });
}
await writeFile(
  "backup-dist/build-report.json",
  JSON.stringify(sizes, null, 2) + "\n",
);
console.log("生产JS已压缩与变量名混淆，无source map；构建工具离线可复现。");

// 静态文件版本号：HTML 引用写成 /assets/tenant.js?v=<内容哈希前 12 位>。
// 内容变了地址就变，浏览器可以长期缓存（配合后端对带 v 的静态文件返回长缓存头）。
const { createHash } = await import("node:crypto");
for (const [page, files] of [
  ["dist/tenant.html", ["/assets/tenant.css", "/assets/tenant.js"]],
  ["dist/console.html", ["/console-assets/console.css", "/console-assets/pinyin-pro.js", "/console-assets/console.js"]],
]) {
  let html = await readFile(page, "utf8");
  for (const file of files) {
    const hash = createHash("sha256").update(await readFile("dist" + file)).digest("hex").slice(0, 12);
    const before = html;
    html = html.replace(`"${file}"`, `"${file}?v=${hash}"`);
    if (html === before) throw Error("HTML 中找不到 " + file);
  }
  await writeFile(page, html);
}
console.log("静态文件已加版本号。");
