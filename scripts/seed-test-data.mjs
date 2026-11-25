// 生成“测试机构”数据：用系统自己的代码在内存库里造数据，再导出成 SQL。仅开发用，不进入生产包。
import fs from "node:fs";
import { fixture } from "../tests/support.mjs";
import { repo } from "../src/server/repo.js";
import { modules } from "../src/server/permissions.js";
import { newPassword, encrypt, phoneIndex } from "../src/server/crypto.js";
import { b64, bytes, sha, randomId } from "../src/server/core.js";
import { convertLegacy } from "../src/server/legacy-import.js";
const [, , legacyPath, outDir] = process.argv;
const f = await fixture();
f.env.TENANT_HOST = "localhost";
const t = { id: "ten_testseed0000000000000001", slug: "ceshi", name: "测试机构", type: "其他", city: "", expires_at: null, staff_seat_limit: 20, student_seat_limit: 200, contact_enc: null };
await repo(f.env, null).createTenant(t, "fixture", modules);
const r = repo(f.env, t.id);
const u = { id: "usr_testseed0000000000000001", name: "测试主管", roles: '["supervisor"]', phone_hmac: await phoneIndex(f.env, t.id, "13900000001"), phone_enc: await encrypt(f.env, "13900000001", t.id + ":phone"), phone_last4: "0001", ...(await newPassword(f.env, b64(bytes(32)))) };
await r.createUser(u, { id: "fixture", name: "系统维护" });
f.db.raw.prepare("UPDATE users SET must_change=0").run();
const admin = { id: u.id, name: u.name };
const token = b64(bytes(32));
await r.createSession(await sha(token), u, { ip: "local", ua: "seed" });
// ---- 1. 旧版 JSON 导入（走系统自己的转换与落库）
const raw = JSON.parse(fs.readFileSync(legacyPath, "utf8"));
const settings = raw.settings || {};
const conv = await convertLegacy(f.env, t.id, raw, settings, admin);
const job = { id: randomId("job"), kind: "legacy", reason: "seed", source_tenant: t.id, manifest: { counts: {}, settings: {}, preview: null } };
await r.createJob(job, admin, await r.dataVersion());
await r.stageConverted(job.id, conv.rows);
await r.finalizeJob(job.id, admin, "legacy", conv.settings, Object.fromEntries(Object.entries(conv.rows).map(([k, v]) => [k, v.length])));
console.log("legacy imported", Object.fromEntries(Object.entries(conv.rows).filter(([, v]) => v.length).map(([k, v]) => [k, v.length])), conv.warnings);


await r.createSession(await sha(token), u, { ip: "local", ua: "seed" });
// ---- 2. 新功能场景（走真实接口，保证流水、欠课、余额一致）
const log = [];
async function api(path, method = "POST", data) {
  const res = await f.request("http://localhost:4173/ceshi/api/" + path, { method, headers: { Origin: "http://localhost:4173", Cookie: "channel_session=" + token, "Content-Type": "application/json" }, body: data === undefined ? undefined : JSON.stringify(method === "GET" ? undefined : { operation_id: crypto.randomUUID(), ...data }) });
  const body = await res.json().catch(() => ({}));
  if (res.status !== 200) { log.push("FAIL " + method + " " + path + " " + res.status + " " + JSON.stringify(body).slice(0, 200)); return null; }
  return body;
}
const q1 = (sql, ...a) => f.db.raw.prepare(sql).get(...a);
const idOf = (table, name) => q1(`SELECT id FROM ${table} WHERE tenant_id=? AND name=?`, t.id, name)?.id;
const ct = { piano: idOf("course_types", "钢琴一对一"), voice: idOf("course_types", "声乐一对一"), theory: idOf("course_types", "乐理小班") };
const teacher = idOf("teachers", "钱宇航"), room = idOf("locations", "104琴房");
const mkStudent = async (name, extra = {}) => (await api("data/students", "POST", { name, grade: "初二", direction: "钢琴", ...extra }))?.id;
const mkLesson = async (date, hh, sids, type = ct.piano, units = 1) => (await api("data/lessons", "POST", { start_at: date + "T" + hh, teacher_id: teacher, course_type_id: type, location_id: room, duration: 45, units, student_ids: sids }))?.id;
const done = async (lid, status = "completed") => { if (!lid) { console.log(log.join("\n")); throw Error("lesson missing"); } const l = await r.businessGet("lessons", lid); return api("credits/lessons/" + lid + "/status", "POST", { lesson_version: l.version, status }); };
const pkg = (sid, type, units, amount) => ({ student_id: sid, course_type_id: type, units_total: units, amount, unit_price: Math.round(amount / units * 100) / 100 });
// 2.1 欠课中：3 节已销课全记欠课（达到上限 3），第 4 节待销课会被拦住
const sDebt = await mkStudent("测试-欠课中");
for (const d of ["2026-11-02", "2026-11-03", "2026-11-04"]) await done(await mkLesson(d, "11:00", [sDebt]));
await mkLesson("2026-11-05", "11:00", [sDebt]);
// 2.2 欠课已补扣：先欠 1 课时，再买包自动补扣（收入在补扣日确认）
const sRepaid = await mkStudent("测试-欠课已补扣");
await done(await mkLesson("2026-11-02", "12:00", [sRepaid]));
await api("credits/packages", "POST", pkg(sRepaid, ct.piano, 10, 2000));
// 2.3 预收余额：先收款进余额，再兑换成课时包，余下仍在余额
const sBal = await mkStudent("测试-预收余额");
await api("credits/payments", "POST", { student_id: sBal, kind: "tuition", amount: 5000, paid_at: "2026-11-05", method: "微信", allocations: [] });
await api("credits/balance/redeem", "POST", { student_id: sBal, items: [{ new_package: { course_type_id: ct.piano, units_total: 10, unit_price: 200 }, amount: 2000 }] });
// 2.4 多包缴费：一笔钱分到钢琴包和声乐包，多出的进余额
const sMulti = await mkStudent("测试-多包缴费", { direction: "钢琴+声乐" });
await api("credits/payments", "POST", { student_id: sMulti, kind: "tuition", amount: 6000, paid_at: "2026-11-06", method: "银行转账", allocations: [{ new_package: { course_type_id: ct.piano, units_total: 10, unit_price: 220 }, amount: 2200 }, { new_package: { course_type_id: ct.voice, units_total: 10, unit_price: 300 }, amount: 3000 }] });
// 2.5 其他收入：报名费、教材费，直接确认为收入
const sOther = await mkStudent("测试-其他收入");
await api("credits/payments", "POST", { student_id: sOther, kind: "other_income", other_category: "报名费", other_note: "秋季报名", amount: 300, paid_at: "2026-11-03", method: "微信" });
await api("credits/payments", "POST", { student_id: sOther, kind: "other_income", other_category: "教材费", other_note: "钢琴教材", amount: 150, paid_at: "2026-11-03", method: "现金" });
// 2.6 冲正：一笔收错的钱被冲正
const sRev = await mkStudent("测试-缴费冲正");
const wrong = await api("credits/payments", "POST", { student_id: sRev, kind: "tuition", amount: 800, paid_at: "2026-11-04", method: "支付宝", allocations: [] });
if (wrong) await api("credits/payments/" + wrong.id + "/reverse", "POST", { version: 1, reason: "登记错学员，冲正" });
// 2.7 正常续费场景：低余额、课时包到期（已有 74 个包里已含）；再加一个全新、没有课的学员
await mkStudent("测试-新生未排课", { grade: "小学3年级" });
// 2.8 班级：两个班各带学员
const cls = [];
for (const [name, type] of [["测试班A（周末钢琴班）", ct.piano], ["测试班B（乐理基础）", ct.theory]]) {
  const c = await api("tools/classes", "POST", { name, course_type_id: type, teacher_id: teacher, location_id: room, date_from: "2026-09-01", date_to: "2027-01-31", status: "active", note: "测试班级" });
  if (c) cls.push(c.id);
}
const someStudents = f.db.raw.prepare("SELECT id FROM students WHERE tenant_id=? AND status='active' ORDER BY sort_order LIMIT 8").all(t.id).map((x) => x.id);
for (const [i, sid] of someStudents.entries()) if (cls[i % 2]) await api("tools/class_members", "POST", { class_id: cls[i % 2], student_id: sid });
// 2.9 线索（各阶段）
const today = "2026-11-09";
for (const [name, stage, nf, src] of [["线索-小雨妈妈", "new", today, "朋友推荐"], ["线索-浩然家长", "contacted", "2026-11-12", "小红书"], ["线索-安安", "contacted", "2026-11-10", "公众号"], ["线索-子墨", "trial", "2026-11-08", "校园活动"], ["线索-睿睿（逾期未跟进）", "contacted", "2026-11-03", "老学员介绍"], ["线索-已流失", "lost", null, "线上广告"]]) {
  const body = { name, grade: "小学5年级", direction: "声乐", source: src, note: "测试线索", stage, next_followup: nf, phone: "137" + String(Math.floor(Math.random() * 1e8)).padStart(8, "0") };
  if (name === "线索-安安") body.trial_at = "2026-11-10T16:00";
  await api("tools/leads", "POST", body);
}
// 2.10 跟进任务：到期/今天/逾期/已完成，指派给测试主管
for (const [title, due, done_] of [["联系家长续费（逾期）", "2026-11-05", false], ["确认考级报名（今天）", today, false], ["回访试听学员", "2026-11-11", false], ["发送阶段报告（已完成）", "2026-11-06", true]]) {
  const sid = someStudents[Math.floor(Math.random() * someStudents.length)];
  await api("tools/followup_tasks", "POST", { title, due_date: due, assignee_id: u.id, student_id: sid, done: done_ });
}
console.log(log.length ? log.join("\n") : "新功能场景全部成功");
export { f, t, r, u, admin, token, outDir, api };
