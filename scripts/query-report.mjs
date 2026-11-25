import { readdir, readFile, writeFile } from "node:fs/promises";
const source = process.argv[2] || "work/reports/stage6-source-queries",
  target = process.argv[3] || "work/reports/stage6-http-budget.json";
const reports = [];
for (const file of await readdir(source))
  if (file.endsWith(".json"))
    reports.push(...JSON.parse(await readFile(source + "/" + file, "utf8")));
const rows = new Map();
for (const r of reports) {
  if (!r.url) continue;
  const url = new URL(r.url),
    raw = url.pathname,
    parts = raw.split("/api/");
  if (parts.length !== 2) continue;
  let path = "/api/" + parts[1].replace(/[a-z]+_[a-f0-9]{24}/g, ":id");
  const scope = url.hostname.includes("console") ? "控制台" : "机构";
  const kind = url.searchParams.get("kind");
  if (kind && path.startsWith("/api/imports/")) path += "?kind=" + kind;
  const key = scope + " " + r.method + " " + path,
    prior = rows.get(key) || {
      scope,
      method: r.method,
      path,
      maximum: 0,
      requests: 0,
      statuses: [],
    };
  prior.maximum = Math.max(prior.maximum, r.queries);
  prior.requests++;
  if (!prior.statuses.includes(r.status)) prior.statuses.push(r.status);
  rows.set(key, prior);
}
const interfaces = [...rows.values()].sort((a, b) =>
    (a.scope + a.path + a.method).localeCompare(b.scope + b.path + b.method),
  ),
  maximum = Math.max(...interfaces.map((x) => x.maximum));
if (maximum > 40) throw Error("查询预算超限");
await writeFile(
  target,
  JSON.stringify(
    {
      limit: 40,
      maximum,
      requests: interfaces.reduce((s, r) => s + r.requests, 0),
      interfaces,
    },
    null,
    2,
  ) + "\n",
);
console.log(JSON.stringify({ interfaces: interfaces.length, maximum, target }));
