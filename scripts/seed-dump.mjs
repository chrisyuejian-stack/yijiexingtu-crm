import fs from "node:fs";
import { f, t, u, outDir } from "./seed-test-data.mjs";
import { backupTables, restoreTables, BUSINESS_SETTINGS } from "../src/server/backup-model.js";
const SLUG = "demo";
const TID = `(SELECT id FROM tenants WHERE slug='${SLUG}')`;
const SUP = `(SELECT id FROM users WHERE tenant_id=${TID} AND deleted_at IS NULL AND roles LIKE '%supervisor%' ORDER BY created_at LIMIT 1)`;
const SKIP = new Set(["credit_operations"]);
const lit = (v) => (v === null || v === undefined ? "NULL" : typeof v === "number" ? String(v) : "'" + String(v).replace(/'/g, "''") + "'");
const stmts = [];
const NOPHONE = new Set(["phone_enc", "parent_phone_enc"]);
const tables = [...restoreTables.filter((x) => !SKIP.has(x))];
const counts = {};
// 把很长的随机编号换成短编号（全表一致），文件体积小一个量级；不改变任何关联。
const idMap = new Map();
const ID_RE = /^[a-z]{2,8}_[0-9a-f]{16,}$/;
const short = (v) => {
  if (typeof v !== "string" || !ID_RE.test(v)) return v;
  if (v === u.id) return v;
  if (!idMap.has(v)) idMap.set(v, "k" + idMap.size.toString(36));
  return idMap.get(v);
};
for (const table of tables) {
  const cols = backupTables[table].columns.filter((c) => c !== "tenant_id");
  const rows = f.db.raw.prepare(`SELECT ${cols.join(",")} FROM ${table} WHERE tenant_id=? ORDER BY rowid`).all(t.id)
    .map((row) => Object.fromEntries(cols.map((c) => [c, NOPHONE.has(c) ? null : (c === "created_by" || c === "updated_by") ? "seed" : short(row[c])])));
  if (!rows.length) continue;
  counts[table] = rows.length;
  // 每列：全表一致 -> 常量；created_at/updated_at -> 相对最小值的差；其余 -> 数组里取值
  const plan = [], dyn = [];
  const sameAs = {};
  const base = Math.min(...rows.map((r) => r.created_at));
  for (const c of cols) {
    const vals = rows.map((r) => r[c]);
    if (c === "updated_at" && rows.every((r) => r.updated_at === r.created_at)) { plan.push({ c, expr: "@created_at" }); continue; }
    if (vals.every((v) => v === vals[0])) { plan.push({ c, expr: lit(vals[0]) }); continue; }
    if (c === "created_at" || c === "updated_at") { plan.push({ c, dyn: dyn.length, delta: c === "updated_at" ? base : base }); dyn.push(c); continue; }
    plan.push({ c, dyn: dyn.length }); dyn.push(c);
  }
  const exprOf = (p) => {
    if (p.expr && p.expr !== "@created_at") return p.expr;
    if (p.expr === "@created_at") return exprOf(plan.find((x) => x.c === "created_at"));
    const j = `json_extract(j.value,'$[${p.dyn}]')`;
    if (p.c === "assignee_id") return `CASE WHEN ${j}='${u.id}' THEN ${SUP} ELSE ${j} END`;
    return p.delta !== undefined ? `${base}+${j}` : j;
  };
  const selects = plan.map(exprOf);
  let batch = [], size = 0;
  const flush = () => {
    if (!batch.length) return;
    const json = "[" + batch.join(",") + "]";
    stmts.push(`INSERT INTO ${table}(tenant_id,${cols.join(",")}) SELECT ${TID},${selects.join(",")} FROM json_each('${json.replace(/'/g, "''")}') j;`);
    batch = []; size = 0;
  };
  for (const row of rows) {
    const arr = dyn.map((c) => (c === "created_at" || c === "updated_at" ? row[c] - base : row[c]));
    const text = JSON.stringify(arr);
    if (size + text.length > 30000) flush();
    batch.push(text); size += text.length + 1;
  }
  flush();
}
for (const key of BUSINESS_SETTINGS) {
  const row = f.db.raw.prepare("SELECT value FROM tenant_settings WHERE tenant_id=? AND id=?").get(t.id, key);
  if (row) stmts.push(`INSERT OR REPLACE INTO tenant_settings(tenant_id,id,value,created_at,created_by,updated_at,updated_by) SELECT ${TID},${lit(key)},${lit(row.value)},${Date.now()},'seed',${Date.now()},'seed';`);
}
fs.mkdirSync(outDir, { recursive: true });
// 分文件：每个文件不超过约 45KB
const files = []; let cur = [], len = 0;
for (const s of stmts) { if (len + s.length > 45000 && cur.length) { files.push(cur); cur = []; len = 0; } cur.push(s); len += s.length; }
if (cur.length) files.push(cur);
const OPEN = `INSERT OR IGNORE INTO trusted_imports(tenant_id,id) SELECT ${TID},'seed-import';`, CLOSE = `DELETE FROM trusted_imports WHERE tenant_id=${TID} AND id='seed-import';`;
files.forEach((c) => { c.unshift(OPEN); c.push(CLOSE); });
files.forEach((c, i) => fs.writeFileSync(`${outDir}/测试数据_${String(i + 1).padStart(2, "0")}共${String(files.length).padStart(2, "0")}.sql`, c.join("\n") + "\n"));
console.log("dumped", files.length, "files", counts);

// 清空脚本：与系统“恢复”动作同一顺序，先删子表再删父表
const RESET = ["PRAGMA defer_foreign_keys=ON;", OPEN, ...[...restoreTables].reverse().map((tb) => `DELETE FROM ${tb} WHERE tenant_id=${TID};`), ...BUSINESS_SETTINGS.map((k) => `DELETE FROM tenant_settings WHERE tenant_id=${TID} AND id='${k}';`), CLOSE];
fs.writeFileSync(`${outDir}/清空测试数据_需要重来时用.sql`, RESET.join("\n") + "\n");
