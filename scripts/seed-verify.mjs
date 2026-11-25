import fs from "node:fs";
import { fixture } from "../tests/support.mjs";
import { repo } from "../src/server/repo.js";
import { modules } from "../src/server/permissions.js";
import { newPassword, encrypt, phoneIndex } from "../src/server/crypto.js";
import { b64, bytes, sha } from "../src/server/core.js";
const dir = process.argv[2];
const f = await fixture(); f.env.TENANT_HOST = "localhost";
const t = { id: "ten_realtenant00000000000001", slug: "demo", name: "测试机构", type: "其他", city: "", expires_at: null, staff_seat_limit: 20, student_seat_limit: 200, contact_enc: null };
await repo(f.env, null).createTenant(t, "fixture", modules);
const r = repo(f.env, t.id);
const u = { id: "usr_realsup000000000000000001", name: "超管开通的主管", roles: '["supervisor"]', phone_hmac: await phoneIndex(f.env, t.id, "13900000009"), phone_enc: await encrypt(f.env, "13900000009", t.id + ":phone"), phone_last4: "0009", ...(await newPassword(f.env, b64(bytes(32)))) };
await r.createUser(u, { id: "fixture", name: "x" });
f.db.raw.prepare("UPDATE users SET must_change=0").run();
const token = b64(bytes(32));
await r.createSession(await sha(token), u, { ip: "local", ua: "v" });
for (const name of fs.readdirSync(dir).filter((x) => x.startsWith("测试数据")).sort()) {
  const sql = fs.readFileSync(dir + "/" + name, "utf8").replace(/\n/g, " ");   // 模拟控制台把换行压成一行
  try { f.db.raw.exec(sql); console.log("OK", name); } catch (e) { console.log("ERR", name, e.message); process.exit(1); }
}
const files = fs.readdirSync(dir).filter((x) => x.startsWith("测试数据")).sort();
const reset = fs.readFileSync(dir + "/清空测试数据_需要重来时用.sql", "utf8").replace(/\n/g, " ");
f.db.raw.exec(reset); console.log("RESET ok, students now", f.db.raw.prepare("SELECT count(*) c FROM students WHERE tenant_id=?").get(t.id).c);
for (const name of files) f.db.raw.exec(fs.readFileSync(dir + "/" + name, "utf8").replace(/\n/g, " "));
console.log("REIMPORT ok");
const call = async (p) => { const res = await f.request("http://localhost:4173/demo/api/" + p, { headers: { Origin: "http://localhost:4173", Cookie: "channel_session=" + token } }); return { s: res.status, b: await res.json().catch(() => ({})) }; };
const cnt = (tb) => f.db.raw.prepare(`SELECT count(*) c FROM ${tb} WHERE tenant_id=?`).get(t.id).c;
console.log(Object.fromEntries(["students", "lessons", "lesson_participants", "packages", "package_transactions", "student_payments", "credit_debts", "student_balances_ledger", "leads", "followup_tasks", "classes", "class_members"].map((k) => [k, cnt(k)])));
console.log("fk", JSON.stringify(f.db.raw.prepare("PRAGMA foreign_key_check").all().slice(0, 5)));
for (const p of ["c2/home", "students", "credits/payments/pending", "c2/renewals?group=debt", "c2/unchecked", "c2/makeups", "finance/report?month=2026-11", "finance/receivable-summary", "c2/followups?group=overdue", "todo/summary", "settings"]) {
  const x = await call(p); console.log(p, x.s, JSON.stringify(x.b).slice(0, 220));
}
const asg = f.db.raw.prepare("SELECT DISTINCT assignee_id FROM followup_tasks WHERE tenant_id=?").all(t.id);
console.log("assignees", JSON.stringify(asg));
console.log("CHECK", JSON.stringify(f.db.raw.prepare(fs.readFileSync(dir + "/../pkg/枫琴_测试数据包/检查_导入后执行.sql", "utf8")).get()));
console.log("TRUSTED", JSON.stringify(f.db.raw.prepare("SELECT * FROM trusted_imports").all()));
