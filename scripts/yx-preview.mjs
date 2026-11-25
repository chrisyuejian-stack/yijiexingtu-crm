// 艺界星途前端本机预览（仅开发用，不进入 dist）：真实走登录流程，不注入会话。
// 运行：node scripts/yx-preview.mjs   然后打开 http://localhost:4180/login
// 虚构数据：两家机构共用主管手机号 13911112222（密码 PhaseTwoSecure9），用于“选择机构”；
// 家长 13800001111（密码 ParentPreview9）绑定两个孩子；老师/家长入口 http://localhost:4180/schedule-xingguang/login
import http from "node:http";
import { fixture } from "../tests/support.mjs";
import { schoolFixture } from "../tests/fixtures-school.mjs";
import { newPassword } from "../src/server/crypto.js";

const PORT = Number(process.env.PREVIEW_PORT || 4180);
const f = await fixture();
f.env.TURNSTILE_MODE = "off";
f.env.TENANT_HOST = "localhost";
f.env.CONSOLE_HOST = "127.0.0.1";
const origin = "http://localhost:" + PORT;
async function call(s, path, method = "GET", data) {
  const res = await f.request(origin + "/" + s.t.slug + "/api/" + path, {
    method,
    headers: { Origin: origin, Cookie: "channel_session=" + s.token, "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const body = await res.json().catch(() => ({}));
  if (res.status >= 300) throw Error(path + " " + res.status + " " + JSON.stringify(body));
  return body;
}
const a = await schoolFixture(f, "xingguang");
const b = await schoolFixture(f, "mingyue");
f.db.raw.prepare("UPDATE tenants SET name=? WHERE id=?").run("星光琴行", a.t.id);
f.db.raw.prepare("UPDATE tenant_branding SET display_name=?, theme_color=? WHERE tenant_id=?").run("星光琴行", "#16A394", a.t.id);
f.db.raw.prepare("UPDATE tenants SET name=? WHERE id=?").run("明月画室", b.t.id);
f.db.raw.prepare("UPDATE tenant_branding SET display_name=?, theme_color=? WHERE tenant_id=?").run("明月画室", "#E8478B", b.t.id);
f.db.raw.prepare("UPDATE users SET name=? WHERE tenant_id=?").run("周主管", a.t.id);

const cat = (await call(a, "data/course_categories", "POST", { name: "钢琴", color: "#5B8DB8" })).id;
const course = (await call(a, "data/course_types", "POST", { name: "钢琴一对一", category_id: cat, format: "individual", capacity: 1 })).id;
const teacher = (await call(a, "data/teachers", "POST", { name: "张老师" })).id;
const room = (await call(a, "data/locations", "POST", { name: "201 琴房", capacity: 2 })).id;
const kids = [];
for (const [name, grade] of [["陈小雨", "三年级"], ["陈小星", "一年级"], ["周子涵", "五年级"]])
  kids.push((await call(a, "data/students", "POST", { name, grade, direction: "钢琴" })).id);
const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
const monday = new Date(Date.parse(today + "T12:00:00Z") - ((new Date(today + "T12:00:00Z").getUTCDay() + 6) % 7) * 86400000);
for (let i = 0; i < 6; i++) {
  const date = new Date(monday.getTime() + i * 86400000).toISOString().slice(0, 10);
  await call(a, "data/lessons", "POST", {
    start_at: date + "T" + (i % 2 ? "16:00" : "18:30"),
    teacher_id: teacher,
    course_type_id: course,
    location_id: room,
    duration: 45,
    units: 1,
    student_ids: [kids[i % 2]],
  });
}
// 阶段 6 预览：老师账号（13700001111 / TeacherPreview9）、今天一节小组课、开启老师自助提交。
const groupCourse = (await call(a, "data/course_types", "POST", { name: "钢琴小组课", category_id: cat, format: "group", capacity: 4 })).id;
const nowBj = new Date(Date.now() + 8 * 3600000 - 30 * 60000).toISOString().slice(0, 16);
await call(a, "data/lessons", "POST", { start_at: nowBj, teacher_id: teacher, course_type_id: groupCourse, location_id: room, duration: 45, units: 1, student_ids: [kids[0], kids[1]] });
await call(a, "settings", "PUT", { key: "teacher_self_checkin", value: true });
const tAcc = await call(a, "accounts", "POST", { name: "张老师", phone: "13700001111", roles: ["teacher"], teacher_id: teacher });
{
  const tpw = await newPassword(f.env, "TeacherPreview9");
  const tc = Object.keys(tpw);
  f.db.raw.prepare("UPDATE users SET " + tc.map((c) => c + "=?").join(",") + ", must_change=0 WHERE tenant_id=? AND id=?").run(...tc.map((c) => tpw[c]), a.t.id, tAcc.id);
}
const g = await call(a, "students/" + kids[0] + "/guardians", "POST", { phone: "13800001111", name: "陈妈妈", relation: "mother" });
await call(a, "students/" + kids[1] + "/guardians", "POST", { phone: "13800001111", name: "陈妈妈", relation: "mother" });
await call(a, "students/" + kids[0] + "/guardians", "POST", { phone: "13800002222", name: "陈爸爸", relation: "father" });
const pw = await newPassword(f.env, "ParentPreview9");
const cols = Object.keys(pw);
f.db.raw
  .prepare("UPDATE users SET " + cols.map((c) => c + "=?").join(",") + ", must_change=0 WHERE tenant_id=? AND id=?")
  .run(...cols.map((c) => pw[c]), a.t.id, g.user.id);
f.db.raw.exec("DELETE FROM security_limits");
// 平台为机构 A 开通音乐兴趣、音乐艺考（阶段 3 设置页预览用）。
{
  const ch = { "cf-access-jwt-assertion": f.access, cookie: f.adminCookie, Origin: "http://127.0.0.1:" + PORT, "Content-Type": "application/json" };
  const cur = await (await f.request("http://127.0.0.1:" + PORT + "/api/ops/tenants/" + a.t.id, { headers: ch })).json();
  const put = await f.request("http://127.0.0.1:" + PORT + "/api/ops/tenants", { method: "PUT", headers: ch, body: JSON.stringify({ id: a.t.id, version: cur.version, subjects: ["music_interest", "music_exam"] }) });
  if (put.status !== 200) console.log("开通学科失败", put.status, await put.text());
}
// 课程方案预览用：两门已定价课程 + 一项可选费用。
for (const c of [
  { subject: "music_interest", group: "主修", name: "钢琴一对一 45 分钟", form: "one_to_one", minutes: 45, pricing: { mode: "per_unit", amount: 280 } },
  { subject: "music_interest", group: "基础乐科", name: "乐理小班", form: "small_class", minutes: 60, pricing: { mode: "per_term", amount: 1200 } },
  { subject: "music_interest", group: "可选费用", name: "考级教材", form: "one_to_one", duration_text: "一次性", pricing: { mode: "per_unit", amount: 120 }, optional: true },
])
  await call(a, "settings/courses", "POST", c).catch((e) => console.log("建课失败", e.message));

// AI 预览桩（只在本机预览用，不调用真实模型）：按工具和动作返回像样的建议，方便检查界面。
f.db.raw.prepare("UPDATE ai_settings SET fast_model='preview-fast',deep_model='preview-deep'").run();
f.env.AI_PROVIDER = async (request) => {
  await new Promise((r) => setTimeout(r, 600));
  const sys = request.messages[0].content,
    data = JSON.parse(request.messages[1].content);
  const tool = /当前工具=(\w+)/.exec(sys)?.[1],
    action = /动作=([\w-]+)/.exec(sys)?.[1];
  const ins = data.instruction ? "（按要求：" + data.instruction + "）" : "";
  let out = [];
  if (tool === "content") {
    const brief = data.content?.brief || data.brief || "寒假钢琴集训营，1 月 20 日开营，6–12 岁，6 人小班";
    if (action === "versions")
      out = [{ payload: { versions: { short: "寒假不躺平，来琴房过一个有声音的假期 🎹 " + brief + "。名额不多，私信预约体验课～" + ins, medium: "【寒假钢琴集训营开始报名】\n📅 " + brief + "\n🎼 每天 2 小时：技巧 + 曲目 + 视奏\n🎤 结营汇报演出，家长到场观看\n\n想了解孩子适合哪个班，欢迎扫码咨询。", long: "去年寒假，小雨在集训营的最后一天第一次在台上完整弹完了《小步舞曲》。下台的时候她说：“原来我也可以。”\n\n今年的寒假集训营照旧是 6 人小班，" + brief + "。\n\n每天两小时，技巧、曲目、视奏轮着来；最后一天是孩子们自己的汇报演出。" } }, basis: [{ type: "ai_judgement", text: "按场景写成三种长度" }, { type: "unsupported", text: "“小雨”的故事在资料里没有，是示例，请换成真实学员（需家长同意）或删掉" }], warnings: [] }];
    if (action === "outline")
      out = [{ payload: { sections: [{ key: "intro", title: "为什么来集训营", required: true, points: ["小班 6 人", "结营汇报演出"] }, { key: "what", title: "学什么", required: true, points: ["技巧", "曲目", "视奏"] }, { key: "time", title: "上课时间与地点", required: true, points: [] }, { key: "join", title: "报名方式", required: true, points: [] }] }, basis: [{ type: "ai_judgement", text: "按招生简章的必有小节" }], warnings: [] }];
    if (action === "section")
      out = [{ payload: { section_key: data.section_key, blocks: [{ type: "paragraph", text: "这一节的正文示例：小班上课，老师能照顾到每个孩子的手型和节奏。" + ins, basis: [0] }, { type: "list", items: ["每天 2 小时", "6 人小班", "结营汇报演出"], ordered: false, basis: [1] }] }, basis: [{ type: "ai_judgement", text: "概括课程特色" }, { type: "unsupported", text: "“每天 2 小时”在课程库里找不到" }], warnings: [] }];
    if (action === "rewrite") out = [{ payload: { mode: data.mode, blocks: [{ type: "paragraph", text: "（改写示例）" + String(data.selected_text || "").slice(0, 60) }] }, basis: [{ type: "ai_judgement", text: "调整语气" }], warnings: [] }];
    if (action === "fact-check") out = [{ payload: { items: [{ result: "missing", block_index: 0, quote: "每天 2 小时", expected: "", source: "" }] }, basis: [], warnings: [] }];
    if (action === "images") out = [];
  } else if (!tool && data.report) {
    const quotes = JSON.stringify(data.feedback || []).match(/"(?:text|quote|good|learned|attention|homework)":"([^"]{2,60})"/g) || [];
    const q = quotes.map((x) => x.replace(/^"\w+":"|"$/g, ""));
    const texts = { progress: q[0] || "本期按时上课，状态稳定。", focus: q[1] || "继续巩固读谱。", home_practice: [q[2] || "每天练琴 20 分钟"], teacher_note: "继续保持" + ins };
    const fields = data.fields || Object.keys(texts);
    out = [{ payload: { texts: Object.fromEntries(fields.map((k) => [k, texts[k]])) }, basis: [], warnings: [] }];
  } else if (!tool && "tags" in data) {
    const parts = [...(data.tags || []), ...(data.repertoire || []).map((r) => r.name), ...String(data.note || "").split(/[，。,\n]/)].map((x) => x.trim()).filter(Boolean);
    out = [{ payload: { message: { learned: parts[2] || parts[0] || "", good: parts[0] || "", attention: parts[1] || "", homework: parts[3] || "每天慢练 10 分钟" } }, basis: [], warnings: [] }];
  } else if (tool === "growth_reports" || tool === "report") {
    const quotes = JSON.stringify(data.feedback || []).match(/"(?:text|quote|good|learned|attention|homework)":"([^"]{2,60})"/g) || [];
    const q = quotes.map((x) => x.replace(/^"\w+":"|"$/g, ""));
    const texts = { progress: q[0] || "本期按时上课，状态稳定。", focus: q[1] || "继续巩固读谱。", home_practice: [q[2] || "每天练琴 20 分钟"], teacher_note: "继续保持" + ins };
    const fields = data.fields || Object.keys(texts);
    const one = () => ({ payload: { texts: Object.fromEntries(fields.map((k) => [k, texts[k]])) }, basis: [], warnings: [] });
    out = [one()];
  } else if (tool === "plan") {
    const plan = data.plan,
      priced = (data.courses || []).filter((c) => c.price_cents != null && !c.optional && c.pricing?.mode === "per_unit");
    const lines = (plan.modules.courses.lines || []).map((l) => ({ line_id: l.line_id, stage_key: l.stage_key, course_id: l.course_id, qty: l.qty, frequency_text: l.frequency_text || "", note: "", includes: [] }));
    const add = (n) => plan.modules.path.stages.map((s, i) => ({ line_id: "tmp_preview_" + n + "_" + i, stage_key: s.key, course_id: priced[0]?.id, qty: { units: n }, frequency_text: "每周 1 次", note: "", includes: [] }));
    const courses = [
      { payload: { variant: "recommended", lines: [...lines, ...add(8)] }, basis: [{ type: "rule", text: "钢琴主修每周 1 次" }, { type: "ai_judgement", text: "先建立读谱习惯，课时适中" }], warnings: [] },
      { payload: { variant: "alt", lines: [...lines, ...add(12)] }, basis: [{ type: "ai_judgement", text: "进度更快的配法" }], warnings: [] },
    ];
    const text = [{ payload: { fields: [{ path: "modules.assessment.text", value: "孩子对音乐有兴趣，节奏感不错，读谱还需要加强。" + ins }, { path: "title", value: (plan.title || "学习方案") + " · 一年规划" }] }, basis: [{ type: "ai_judgement", text: "按试听情况润色" }], warnings: [] }];
    if (action === "stage-courses") out = courses;
    else if (action === "adjust") out = /课|节/.test(data.instruction || "") ? courses : text;
    else if (action === "polish") out = text;
    else if (action === "fill-from-consult") out = [{ payload: { fields: [{ path: "modules.assessment.text", value: String(data.consult || "").slice(0, 40) || "（咨询记录为空）", quote: String(data.consult || "").slice(0, 40) }] }, basis: [{ type: "consult", quote: String(data.consult || "").slice(0, 40) }], warnings: [] }];
  }
  return { content: JSON.stringify({ suggestions: out }), tokens: { prompt_tokens: 10, completion_tokens: 10 } };
};
const server = http.createServer(async (req, res) => {
  try {
    const host = req.headers.host || "localhost:" + PORT,
      isConsole = host.startsWith("127.0.0.1");
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const headers = { ...req.headers };
    if (isConsole) {
      headers["cf-access-jwt-assertion"] = f.access;
      headers.cookie = f.adminCookie;
    }
    const response = await f.request("http://" + host + req.url, {
      method: req.method,
      headers,
      redirect: "manual",
      body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks),
    });
    const out = {};
    response.headers.forEach((v, k) => (out[k] = v));
    const cookies = response.headers.getSetCookie?.() || [];
    if (cookies.length) out["set-cookie"] = cookies;
    res.writeHead(response.status, out);
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (e) {
    res.writeHead(500);
    res.end("preview error " + e.message);
  }
});
server.listen(PORT, "127.0.0.1", () =>
  console.log(
    "预览：" + origin + "/login（管理者）· " + origin + "/" + a.t.slug + "/login（老师/家长）· 控制台 http://127.0.0.1:" + PORT + "/\n" +
      JSON.stringify({ tenantA: a.t.id, slugA: a.t.slug, tenantB: b.t.id, kids }),
  ),
);
