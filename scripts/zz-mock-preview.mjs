// 仅本机：导入100人模拟数据，五个角色各开一个端口。不得进入 dist。
// 固定验收时钟：MOCK_NOW（默认 2026-11-04T20:00:00+08:00），之后按真实流逝前进。
const ANCHOR = Date.parse(process.env.MOCK_NOW || "2026-11-04T20:00:00+08:00"), REAL0 = Date.now(), realNow = Date.now.bind(Date);
Date.now = () => ANCHOR + (realNow() - REAL0);
{ const D = Date; globalThis.Date = class extends D { constructor(...a) { if (a.length) super(...a); else super(D.now()); } static now() { return D.now(); } }; }
import http from "node:http";
import fs from "node:fs";
import { fixture } from "../tests/support.mjs";
import { adminCall } from "../tests/fixtures-admin.mjs";
import { repo } from "../src/server/repo.js";
import { modules } from "../src/server/permissions.js";
import { newPassword, encrypt, decrypt, phoneIndex } from "../src/server/crypto.js";
import { b64, bytes, sha } from "../src/server/core.js";
import { seedPromoDemo } from "./promo-demo.mjs";
const f = await fixture();
f.env.TURNSTILE_MODE = "off";
const t = { id: "ten_111111111111111111111111", slug: "preview-school", name: "教务示范机构", type: "其他", city: "", expires_at: null, staff_seat_limit: 50, student_seat_limit: 300, contact_enc: null };
await repo(f.env, null).createTenant(t, "fixture", modules);
const raw = JSON.parse(fs.readFileSync(process.env.MOCK, "utf8"));
const counts = {}; for (const [k, v] of Object.entries(raw)) if (Array.isArray(v) && v.length) counts[k] = v.length;
const ac = async (p, m, d) => { const x = await adminCall(f, "tenants/" + t.id + "/" + p, m, d); if (x.status !== 200) throw Error(p + x.text); return x.body; };
const job = await ac("jobs", "POST", { kind: "legacy", counts, settings: raw.settings, reason: "模拟数据导入验证" });
for (const [table, rows] of Object.entries(counts)) for (let i = 0; i < rows; i += 200) await ac("jobs/" + job.id + "/page", "POST", { table, rows: raw[table].slice(i, i + 200) });
const validation=await ac("jobs/" + job.id + "/preview", "POST", {});
if(validation.counts?.students!==raw.students.length)throw Error("导入预览学员数与原始样本不一致");
console.log("IMPORT_PREVIEW",JSON.stringify(validation));
await ac("jobs/" + job.id + "/commit", "POST", {});
f.env.TENANT_HOST = "localhost"; f.env.CONSOLE_HOST = "127.0.0.1";
const r = repo(f.env, t.id);
const q = (s, ...a) => f.db.raw.prepare(s).all(...a);
const teacherId = q("SELECT id FROM teachers WHERE tenant_id=? AND name='罗老师'", t.id)[0].id;
// 按手机号精确定位 s003（学员手机 13900000003），不按同名猜测
let studentId = null;
for (const row of q("SELECT id,phone_enc FROM students WHERE tenant_id=? AND name='王小明'", t.id))
  if (row.phone_enc && (await decrypt(f.env, row.phone_enc, t.id + ":phone")) === "13900000003") studentId = row.id;
if (!studentId) throw Error("找不到 s003 王小明（13900000003）");
const tokens = {};
let n = 1;
for (const [role, name] of [["supervisor", "陈主管"], ["academic", "林教务"], ["finance", "周财务"], ["teacher", "罗老师"], ["student", "王小明"]]) {
  const phone = "1360000000" + n++;
  const u = { id: "usr_" + role.padEnd(24, "0").slice(0, 24), name, roles: JSON.stringify([role]), phone_hmac: await phoneIndex(f.env, t.id, phone), phone_enc: await encrypt(f.env, phone, t.id + ":phone"), phone_last4: phone.slice(-4), teacher_id: role === "teacher" ? teacherId : null, student_id: role === "student" ? studentId : null, ...(await newPassword(f.env, "MockPass2026x")) };
  await r.createUser(u, { id: "fixture", name: "系统" });
  const tk = b64(bytes(32)); await r.createSession(await sha(tk), await r.user(u.id), { ip: "local", ua: "mock" }); tokens[role] = tk;
}
f.db.raw.prepare("UPDATE users SET must_change=0").run();
const call = async (path, data, method = "POST") => { const x = await f.request("http://localhost:4173/preview-school/api/" + path, { method, headers: { Origin: "http://localhost:4173", Cookie: "channel_session=" + tokens.supervisor, "Content-Type": "application/json" }, body: JSON.stringify({ operation_id: crypto.randomUUID(), ...data }) }); const b = await x.json(); if (x.status !== 200) throw Error("种子写入失败 " + path + " " + JSON.stringify(b)); return b; };
const leads = [["赵晓棠","小红书","new","2026-11-05"],["孙立言","抖音","new","2026-11-06"],["周沐阳","官网","new","2026-11-08"],["吴语桐","线下地推","new","2026-11-04"],["郑可心","朋友推荐","contacted","2026-11-02"],["冯子墨","小红书","contacted","2026-11-04"],["陈安然","抖音","contacted","2026-11-10"],["褚一鸣","线下地推","contacted","2026-11-12"],["卫清禾","朋友推荐","trial","2026-11-07","2026-11-06T15:00"],["蒋予安","官网","trial","2026-11-09","2026-11-08T10:00"],["沈知意","小红书","trial","2026-11-11","2026-11-10T16:30"],["韩星河","转介绍","trial","2026-11-05","2026-11-05T14:00"],["朱浩宇","抖音","lost",null],["秦雨菲","线下地推","lost",null]];
let i = 1; for (const [name, source, stage, nf, trial] of leads) await call("tools/leads", { name, phone: "135000000" + String(i++).padStart(2, "0"), source, stage, next_followup: nf || undefined, trial_at: trial, note: stage === "lost" ? "价格原因暂不报名" : "咨询课程安排" });
const stu = q("SELECT id FROM students WHERE tenant_id=? AND status='active' ORDER BY id LIMIT 4", t.id);
for (const [k, s] of stu.entries()) await call("tools/referrals", { student_id: s.id, intention: ["英国音乐学院本科","美国音乐表演硕士","德国钢琴本科","香港音乐教育"][k], parent_phone: "1340000000" + (k + 1), consent_name: "家长", consent_at: "2026-11-01T10:00", consent_method: "微信当面确认", consent_operator: "陈主管" });
await seedPromoDemo(f, t, tokens.supervisor);
if (process.env.MOCK_PROMO_IMG) await (await import("./zz-promo-seed.mjs")).seedPromoRich(f, t, tokens.supervisor, process.env.MOCK_PROMO_IMG);
await repo(f.env, null).publishAnnouncement({ id: "msg_preview", title: "课程安排提醒", content: "请及时核对本周课程与教师提交。", roles: ["supervisor","academic","finance","teacher","student"], starts_at: Date.now() - 1000, ends_at: null }, [t.id], { id: "adm_fixture" });
f.db.raw.exec("DELETE FROM security_limits");
// 合作升学推荐：平台开关（迁移 0013 起存于 platform_state），与正式环境一样默认关闭；MOCK_REFERRALS_MODE=on 可打开。
if (process.env.MOCK_REFERRALS_MODE !== "on") f.db.raw.prepare("DELETE FROM platform_state WHERE id='referrals_enabled'").run();
// 4206：控制台“真实登录”入口（用浏览器自己的登录 cookie），用来查看主管顾问账号看到的界面。
const ports = { 4201: "supervisor", 4202: "academic", 4203: "finance", 4204: "teacher", 4205: "student", 4200: "console", 4206: "console-login" };
for (const [port, role] of Object.entries(ports)) http.createServer(async (req, res) => {
  try {
    const chunks = []; for await (const c of req) chunks.push(c);
    const headers = { ...req.headers };
    const consoleMode = role.startsWith("console");
    const origin = consoleMode ? "http://127.0.0.1:4173" : "http://localhost:4173";
    headers.host = origin.slice(7); if (headers.origin) headers.origin = origin; if (headers.referer) delete headers.referer;
    if (consoleMode) { headers["cf-access-jwt-assertion"] = f.access; if (role === "console") headers.cookie = f.adminCookie; }
    else if (req.url.includes("/app") || (req.url.includes("/api/") && !req.url.includes("/public/"))) headers.cookie = "channel_session=" + tokens[role];
    // MOCK_LATENCY=毫秒：给每个接口请求加延迟，模拟线上网络 + Worker + D1 的往返时间。
    if (process.env.MOCK_LATENCY && req.url.includes("/api/")) await new Promise((r) => setTimeout(r, Number(process.env.MOCK_LATENCY)));
    const resp = await f.request(origin + req.url, { method: req.method, headers, body: ["GET","HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks) });
    const outHeaders = Object.fromEntries(resp.headers);
    if (resp.headers.getSetCookie?.().length) outHeaders["set-cookie"] = resp.headers.getSetCookie();
    res.writeHead(resp.status, outHeaders); res.end(Buffer.from(await resp.arrayBuffer()));
  } catch (e) { res.writeHead(500); res.end("err " + e.message); }
}).listen(Number(port)+Number(process.env.MOCK_PORT_OFFSET||0), "127.0.0.1");
console.log("READY", JSON.stringify({ now: new Date().toISOString(), teacherId, studentId }));
console.log("截图时浏览器也要固定时钟：Playwright 用 page.clock.install({ time: new Date(process.env.MOCK_NOW || \"2026-11-04T20:00:00+08:00\") })");
