import { seedPromoDemo, seedPromoBrands } from "./promo-demo.mjs";
import { startBackup, continueBackup } from "../src/server/backup.js";
// 本地预览适配器：仅监听 loopback，随机测试密钥/内存数据库；永不进入 dist。
import http from "node:http";
import { fixture } from "../tests/support.mjs";
import { repo } from "../src/server/repo.js";
import { modules } from "../src/server/permissions.js";
import { newPassword, encrypt, phoneIndex } from "../src/server/crypto.js";
import { b64, bytes, sha } from "../src/server/core.js";
const f = await fixture();
if (process.env.PREVIEW_TURNSTILE_OFF === "1") f.env.TURNSTILE_MODE = "off";
f.env.TENANT_HOST = "localhost";
f.env.CONSOLE_HOST = "127.0.0.1";
const t = {
  id: "ten_111111111111111111111111",
  slug: "preview-school",
  name: "机构预览",
  type: "其他",
  city: "",
  expires_at: null,
  staff_seat_limit: 20,
  student_seat_limit: 200,
  contact_enc: null,
};
await repo(f.env, null).createTenant(t, "fixture", modules);
const r = repo(f.env, t.id),
  u = {
    id: "usr_111111111111111111111111",
    name: "预览主管",
    roles: '["supervisor"]',
    phone_hmac: await phoneIndex(f.env, t.id, "13900000001"),
    phone_enc: await encrypt(f.env, "13900000001", t.id + ":phone"),
    phone_last4: "0001",
    ...(await newPassword(f.env, b64(bytes(32)))),
  };
await r.createUser(u, { id: "fixture", name: "系统维护" });
f.db.raw.prepare("UPDATE users SET must_change=0").run();
const token = b64(bytes(32));
await r.createSession(await sha(token), u, { ip: "local", ua: "preview" });
// 本机预览用虚构夹具，仅存在于开发脚本，不进入生产包。
async function seed(resource, data) {
  const response = await f.request(
    "http://localhost:4173/preview-school/api/data/" + resource,
    {
      method: "POST",
      headers: {
        Origin: "http://localhost:4173",
        Cookie: "channel_session=" + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    },
  );
  const result = await response.json();
  if (!result.id) throw Error(JSON.stringify(result));
  return result.id;
}
const category = await seed("course_categories", { name: "基础课程" }),
  course = await seed("course_types", {
    name: "基础班课",
    category_id: category,
    format: "group",
    capacity: 20,
  }),
  teacher = await seed("teachers", { name: "预览教师" }),
  room = await seed("locations", { name: "预览教室", capacity: 20 }),
  students = [];
for (let i = 0; i < 4; i++)
  students.push(
    await seed("students", {
      name: "预览学员 " + (i + 1),
      grade: "高二",
      direction: "音乐",
    }),
  );
const extraCourses = [];
if (process.env.PREVIEW_STAGEB === "1")
  for (const [name, color] of [
    ["钢琴", "#5B8DB8"],
    ["声乐", "#62A598"],
    ["乐理视唱", "#C99A54"],
  ]) {
    const cat = await seed("course_categories", { name, color });
    extraCourses.push(
      await seed("course_types", {
        name,
        category_id: cat,
        format: "group",
        capacity: 20,
      }),
    );
  }
const current = new Date().toLocaleDateString("sv-SE", {
    timeZone: "Asia/Shanghai",
  }),
  monday = new Date(
    Date.parse(current + "T12:00:00Z") -
      ((new Date(current + "T12:00:00Z").getUTCDay() + 6) % 7) * 86400000,
  );
for (let i = 0; i < 7; i++) {
  const date = new Date(monday.getTime() + i * 86400000)
    .toISOString()
    .slice(0, 10);
  await seed("lessons", {
    start_at: date + "T09:00",
    teacher_id: teacher,
    course_type_id: course,
    location_id: room,
    duration: 60,
    units: 2,
    student_ids: students.slice(i % 2, (i % 2) + 2),
  });
}
// 第十阶段B性能夹具：原9节加21节，合计一周30节；不进入生产。
if (process.env.PREVIEW_STAGEB === "1") {
  for (let i = 0; i < 21; i++) {
    const date = new Date(monday.getTime() + (i % 7) * 86400000)
      .toISOString()
      .slice(0, 10);
    await seed("lessons", {
      start_at:
        date +
        "T" +
        String([10, 11, 15][Math.floor(i / 7)]).padStart(2, "0") +
        ":00",
      teacher_id: teacher,
      course_type_id: extraCourses[i % extraCourses.length] || course,
      location_id: room,
      duration: 45,
      units: 1,
      student_ids: students.slice(0, 2),
    });
  }
}
// 第四阶段虚构预览数据，所有写入仅在本机内存测试库。
async function previewCredit(path, data, method = "POST") {
  const response = await f.request(
    "http://localhost:4173/preview-school/api/" + path,
    {
      method,
      headers: {
        Origin: "http://localhost:4173",
        Cookie: "channel_session=" + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ operation_id: crypto.randomUUID(), ...data }),
    },
  );
  const result = await response.json();
  if (response.status !== 200)
    throw Error("preview seed " + JSON.stringify(result));
  return result;
}
for (const student of students)
  await previewCredit("credits/packages", {
    student_id: student,
    course_type_id: course,
    units_total: 12,
    unit_price: 100,
  });
await previewCredit("finance/rates", {
  teacher_id: teacher,
  course_type_id: course,
  rate: 120,
  rate_basis: "legacy",
  effective_from: "2026-01-01",
  effective_to: "2026-12-31",
});
await previewCredit("credits/payments", {
  student_id: students[0],
  amount: 500.1,
  paid_at: "2026-11-02",
  method: "转账",
});
const pastDate = new Date(Date.parse(current + "T12:00:00Z") - 86400000)
  .toISOString()
  .slice(0, 10);
const pastId = await seed("lessons", {
  start_at: pastDate + "T14:00",
  teacher_id: teacher,
  course_type_id: course,
  location_id: room,
  duration: 45,
  units: 1,
  student_ids: students,
});
const firstLesson = await r.businessGet("lessons", pastId);
await previewCredit("credits/lessons/" + firstLesson.id + "/status", {
  lesson_version: firstLesson.version,
  status: "completed",
});

await r.saveSetting("teacher_self_checkin", true, { id: u.id, name: u.name });
await r.saveSetting(
  "student_view_balance",
  process.env.PREVIEW_HIDE_FINANCE !== "1",
  { id: u.id, name: u.name },
);
await r.saveSetting(
  "student_view_payments",
  process.env.PREVIEW_HIDE_FINANCE !== "1",
  { id: u.id, name: u.name },
);
let liveStart = new Date(Date.now() + 8 * 3600000 - 5 * 60000)
  .toISOString()
  .slice(0, 16);
if (liveStart.slice(11) > "23:00")
  liveStart = liveStart.slice(0, 10) + "T23:00";
const liveLesson = await seed("lessons", {
  start_at: liveStart,
  teacher_id: teacher,
  course_type_id: course,
  location_id: room,
  duration: 45,
  units: 1,
  student_ids: students,
  force: true,
});
const previewReview = await (
  await f.request(
    "http://localhost:4173/preview-school/api/lessons/" +
      firstLesson.id +
      "/review",
    { headers: { Cookie: "channel_session=" + token } },
  )
).json();
await previewCredit(
  "lessons/" + firstLesson.id + "/comments",
  {
    comment_fingerprint: previewReview.comment_fingerprint,
    public_text: "本节练习节奏与视唱，注意保持稳定拍速。",
    homework: "每天练习十五分钟，完成本周练习曲。",
    people: previewReview.participants.map((p) => ({
      participant_id: p.id,
      student_id: p.student_id,
      comment: "节奏更加稳定，继续练习连贯性。",
    })),
  },
  "PUT",
);
async function previewPerson(previewRole) {
  const role = previewRole,
    phone = role === "teacher" ? "13900000002" : "13900000003";
  const person = {
    id: "preview_" + role,
    name: role === "teacher" ? "预览教师" : "预览学员 1",
    roles: JSON.stringify([role]),
    phone_hmac: await phoneIndex(f.env, t.id, phone),
    phone_enc: await encrypt(f.env, phone, t.id + ":phone"),
    phone_last4: phone.slice(-4),
    teacher_id: role === "teacher" ? teacher : null,
    student_id: role === "student" ? students[0] : null,
    ...(await newPassword(f.env, b64(bytes(32)))),
  };
  await r.createUser(person, { id: u.id, name: u.name });
  f.db.raw
    .prepare("UPDATE users SET must_change=0 WHERE tenant_id=? AND id=?")
    .run(t.id, person.id);
  const personToken = b64(bytes(32));
  await r.createSession(await sha(personToken), await r.user(person.id), {
    ip: "local",
    ua: "mobile-preview",
  });
  return personToken;
}
let activeToken = token;
if (["teacher", "student"].includes(process.env.PREVIEW_ROLE))
  activeToken = await previewPerson(process.env.PREVIEW_ROLE);
if (process.env.PREVIEW_PENDING === "1") {
  const teacherSession =
    process.env.PREVIEW_ROLE === "teacher"
      ? activeToken
      : await previewPerson("teacher");
  const endpoint =
    "http://localhost:4173/preview-school/api/lessons/" +
    liveLesson +
    "/review";
  const draft = await (
    await f.request(endpoint, {
      headers: { Cookie: "channel_session=" + teacherSession },
    })
  ).json();
  const response = await f.request(endpoint, {
    method: "POST",
    headers: {
      Origin: "http://localhost:4173",
      Cookie: "channel_session=" + teacherSession,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      operation_id: "preview_pending_attendance",
      kind: "attendance",
      previous_id: null,
      comment_fingerprint: draft.comment_fingerprint,
      public_text: "本节完成节奏训练与视唱练习。",
      homework: "课后练习十五分钟。",
      people: draft.participants.map((p, i) => ({
        participant_id: p.id,
        student_id: p.student_id,
        attendance: "attended",
        comment: i % 2 ? "节奏稳定，继续练习。" : "",
      })),
    }),
  });
  if (!response.ok) throw Error(await response.text());
}
if (
  process.env.PREVIEW_ROLE !== "student" &&
  process.env.PREVIEW_ROLE !== "teacher"
) {
  const cls = await previewCredit("tools/classes", {
    name: "基础集训班",
    teacher_id: teacher,
    course_type_id: course,
    location_id: room,
    date_from: current,
    date_to: current.slice(0, 4) + "-12-31",
  });
  await previewCredit("tools/classes/" + cls.id + "/members", {
    student_ids: students,
  });
  await previewCredit("tools/leads", {
    name: "咨询学员",
    phone: "13900000006",
    source: "转介绍",
    stage: "trial",
    next_followup: current,
    trial_at: current + "T10:00",
    note: "了解课程安排，待回访。",
  });
  await previewCredit("tools/followup_tasks", {
    student_id: students[0],
    title: "沟通下阶段学习安排",
    due_date: current,
    assignee_id: u.id,
  });
  await previewCredit("tools/followup_notes", {
    student_id: students[0],
    at: current + "T09:00",
    content: "已沟通本周练习计划，后续跟进学习节奏。",
  });
  await repo(f.env, null).publishAnnouncement(
    {
      id: "msg_preview",
      title: "课程安排提醒",
      content: "请及时核对本周课程与教师提交。",
      roles: ["supervisor", "academic", "finance", "teacher", "student"],
      starts_at: Date.now() - 1000,
      ends_at: null,
    },
    [t.id],
    { id: "adm_fixture" },
  );
}
let promoTokens = {};
if (process.env.PREVIEW_PROMO === "1") {
  await seedPromoDemo(f, t, token);
  promoTokens = await seedPromoBrands(f, t, token);
}
// 员工角色预览只改变此本机内存夹具，所有请求仍经过真实权限入口。
if (["academic", "finance"].includes(process.env.PREVIEW_ROLE)) {
  f.db.raw
    .prepare("UPDATE users SET roles=? WHERE tenant_id=? AND id=?")
    .run(JSON.stringify([process.env.PREVIEW_ROLE]), t.id, u.id);
  await r.createSession(await sha(token), await r.user(u.id), {
    ip: "local",
    ua: "preview",
  });
}
// 清理本机夹具初始化的请求计数，生产代码没有此入口。
f.db.raw.exec("DELETE FROM security_limits");
if (process.env.PREVIEW_BACKUP === "1") {
  await startBackup(f.env);
  while (!(await continueBackup(f.env)).done) {}
}
const server = http.createServer(async (req, res) => {
  try {
    const host = req.headers.host || "localhost:4173",
      isConsole = host.startsWith("127.0.0.1"),
      url = "http://" + host + req.url;
    let chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const headers = { ...req.headers };
    if (isConsole) {
      headers["cf-access-jwt-assertion"] = f.access;
      headers.cookie = f.adminCookie;
    } else if (
      req.url.startsWith("/preview-school/app") ||
      (req.url.startsWith("/preview-school/api/") &&
        !req.url.includes("/public/"))
    )
      headers.cookie = "channel_session=" + activeToken;
    for (const [slug, session] of Object.entries(promoTokens))
      if (
        req.url.startsWith("/" + slug + "/app") ||
        req.url.startsWith("/" + slug + "/api/")
      )
        headers.cookie = "channel_session=" + session;
    const response = await f.request(url, {
      method: req.method,
      headers,
      body: ["GET", "HEAD"].includes(req.method)
        ? undefined
        : Buffer.concat(chunks),
    });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (e) {
    res.writeHead(500);
    res.end("preview error");
  }
});
server.listen(Number(process.env.PREVIEW_PORT || 4173), "127.0.0.1", () =>
  console.log(
    "本地预览（测试夹具，不是生产部署）：http://localhost:4173/preview-school/login\n工作台：http://localhost:4173/preview-school/app/\n控制台：http://127.0.0.1:4173/",
  ),
);
process.on("SIGINT", () => {
  server.close();
  f.restore();
  process.exit();
});
