import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { totp } from "../src/server/crypto.js";
import { schoolFixture } from "./fixtures-school.mjs";
import { fixture } from "./support.mjs";
import { setup, request, accountToken } from "./fixtures-credit.mjs";
import { adminCall } from "./fixtures-admin.mjs";
import { repo } from "../src/server/repo.js";
import { sha, b64, bytes } from "../src/server/core.js";
const ok = (r, status = 200) => {
  assert.equal(r.status, status, r.text);
  assert.ok(r.queries <= 40);
  return r.body;
};
function seedLongImage(f) {
  const id = "img_" + Buffer.from(bytes(12)).toString("hex");
  f.db.raw
    .prepare(
      "INSERT INTO promo_images(id,tenant_id,owner_id,kind,mime,width,height,ready,created_at) VALUES(?,'platform','fixture','detail','image/png',750,1000,1,?)",
    )
    .run(id, Date.now());
  return id;
}
export async function promoFixture(f, n = 2) {
  const a = { ...(await setup(f, n)), f },
    b = { ...(await setup(f, 1, "b")), f };
  const detailImage = seedLongImage(f);
  a.detailImage = b.detailImage = detailImage;
  return { a, b };
}
const start = () =>
  new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10) + "T10:00";
const courseData = (a, extra = {}) => ({
  type: "course",
  title: "合作课程测试",
  body: "<img src=x onerror=alert(1)>",
  audience: "selected",
  tenant_ids: [a.t.id],
  status: "published",
  publish_at: Date.now() - 1000,
  lecturer: "合作讲师",
  seat_price: 123,
  detail_image_key: a.detailImage || seedLongImage(a.f),
  suggested_price: 200,
  min_size: 2,
  apply_deadline: Date.now() + 86400000,
  sessions: [
    {
      start_at: start(),
      duration: 45,
      meeting_no: "123456",
      meeting_url: "https://meeting.tencent.com/example",
    },
  ],
  ...extra,
});
test("第八阶段：指定机构/类型/显示时间与promo角色硬隔离；申请跨机构及价格tuition裁剪", async () => {
  const f = await fixture();
  try {
    const { a, b } = await promoFixture(f);
    const id = ok(await adminCall(f, "promo", "POST", courseData(a))).id;
    ok(await request(a, "promo/" + id));
    ok(await request(b, "promo/" + id), 404);
    const academic = await accountToken(a, ["academic"]),
      finance = await accountToken(a, ["finance"]),
      student = await accountToken(a, ["student"], a.students[0]);
    const academicGet = ok(
      await request(a, "promo/" + id, "GET", undefined, academic.token),
    );
    assert.ok(!JSON.stringify(academicGet).includes("seat_price"));
    assert.ok(!JSON.stringify(academicGet).includes("suggested_price"));
    assert.equal(ok(await request(a, "promo/" + id)).campaign.seat_price, 123);
    for (const token of [finance.token, student.token])
      ok(await request(a, "promo", "GET", undefined, token), 403);
    ok(
      await request(a, "rights", "PUT", {
        role: "academic",
        module: "tuition",
        action: "read",
        allowed: true,
      }),
    );
    for (const x of [
      { id: academic.id, token: academic.token },
      { id: a.user.id, token: a.token },
    ])
      await a.r.createSession(await sha(x.token), await a.r.user(x.id), {
        ip: "test",
        ua: "relogin",
      });
    assert.equal(
      ok(await request(a, "promo/" + id, "GET", undefined, academic.token))
        .campaign.seat_price,
      123,
    );
    ok(
      await request(a, "promo/" + id + "/application", "POST", {
        est_size: 2,
        unsure: false,
        note: "申请",
        contact_user_id: b.user.id,
      }),
      400,
    );
    ok(
      await request(
        a,
        "promo/" + id + "/application",
        "POST",
        { est_size: 2, unsure: false, note: "申请" },
        academic.token,
      ),
    );
    const app = ok(await request(a, "promo/" + id)).application;
    assert.equal(app.contact_user_id, academic.id);
    assert.ok(!("tenant_id" in app) || app.tenant_id === a.t.id);
    const hidden = ok(
      await adminCall(f, "promo", "POST", {
        type: "message",
        title: "未来消息",
        audience: "all",
        status: "published",
        publish_at: Date.now() + 86400000,
      }),
    ).id;
    ok(await request(a, "promo/" + hidden), 404);
  } finally {
    f.restore();
  }
});
test("第八阶段：确认人数/开班/名单限制、学生范围及会议私密；普通接口拒绝改课销课；改期同步且不进月结指纹", async () => {
  const f = await fixture();
  try {
    const { a, b } = await promoFixture(f);
    const id = ok(
      await adminCall(f, "promo", "POST", courseData(a, { audience: "all" })),
    ).id;
    for (const s of [a, b])
      ok(
        await request(s, "promo/" + id + "/application", "POST", {
          est_size: 2,
          unsure: false,
        }),
      );
    let d = ok(await adminCall(f, "promo/" + id));
    ok(
      await adminCall(f, "promo/" + id + "/open", "POST", {
        version: d.course.version,
      }),
      409,
    );
    for (const app of d.applications)
      ok(
        await adminCall(f, "promo/" + id + "/applications/" + app.id, "PUT", {
          version: app.version,
          status: "confirmed",
          confirmed_size: 2,
          consultant: "顾问",
          consultant_note: "已电话联系",
        }),
      );
    d = ok(await adminCall(f, "promo/" + id));
    ok(
      await adminCall(f, "promo/" + id + "/open", "POST", {
        version: d.course.version,
      }),
    );
    let view = ok(await request(a, "promo/" + id)),
      app = view.application;
    ok(
      await request(a, "promo/" + id + "/roster", "PUT", {
        version: app.version,
        student_ids: [b.students[0]],
      }),
      400,
    );
    ok(
      await request(a, "promo/" + id + "/roster", "PUT", {
        version: app.version,
        student_ids: a.students,
      }),
    );
    const rows = f.db.raw
      .prepare("SELECT * FROM lessons WHERE tenant_id=? AND source_course_id=?")
      .all(a.t.id, d.course.id);
    assert.equal(rows.length, 1);
    const l = rows[0];
    const student = await accountToken(a, ["student"], a.students[0]),
      other = await accountToken(a, ["student"], a.students[1]);
    const detail = ok(
      await request(a, "data/lessons/" + l.id, "GET", undefined, student.token),
    );
    assert.equal(detail.record.participants.length, 1);
    assert.ok(!JSON.stringify(detail).includes("meeting.tencent.com"));
    assert.ok(!JSON.stringify(detail).includes("123456"));
    ok(
      await request(a, "data/lessons/" + l.id, "PATCH", {
        version: l.version,
        note: "越权",
      }),
      403,
    );
    ok(
      await request(a, "credits/lessons/" + l.id + "/status", "POST", {
        operation_id: "op_partner_test",
        lesson_version: l.version,
        status: "completed",
      }),
      403,
    );
    ok(
      await request(a, "finance/adjustments", "POST", {
        operation_id: "op_" + crypto.randomUUID(),
        teacher_id: l.teacher_id,
        month: l.start_at.slice(0, 7),
        amount: 1,
        reason: "不得计酬",
      }),
      403,
    );
    ok(
      await request(a, "finance/lessons/" + l.id + "/rate", "POST", {
        operation_id: "op_" + crypto.randomUUID(),
        version: l.version,
        override_rate: 1,
        override_basis: "lesson",
      }),
      403,
    );
    const ctx = await a.r.financeContext(l.start_at.slice(0, 7));
    assert.ok(!ctx.lessons.some((x) => x.id === l.id));
    assert.equal(
      f.db.raw
        .prepare(
          "SELECT COUNT(*) n FROM package_transactions WHERE tenant_id=?",
        )
        .get(a.t.id).n,
      0,
    );
    d = ok(await adminCall(f, "promo/" + id));
    const ss = d.sessions[0];
    ok(
      await adminCall(f, "promo/" + id + "/sessions/" + ss.id, "PUT", {
        version: ss.version,
        start_at: ss.start_at.slice(0, 11) + "11:00",
        duration: 60,
        meeting_no: "999",
        meeting_url: "https://meeting.tencent.com/new",
      }),
    );
    const synced = f.db.raw
      .prepare(
        "SELECT start_at,duration FROM lessons WHERE source_session_id=?",
      )
      .all(ss.id);
    assert.equal(synced.length, 2);
    assert.ok(
      synced.every((x) => x.start_at.includes("T11:00") && x.duration === 60),
    );
  } finally {
    f.restore();
  }
});

import { deflateSync } from "node:zlib";
import { startBackup, continueBackup } from "../src/server/backup.js";
function png(width = 1080, height = 1080) {
  const crc = (b) => {
      let c = 0xffffffff;
      for (const v of b) {
        c ^= v;
        for (let j = 0; j < 8; j++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
      }
      return (c ^ 0xffffffff) >>> 0;
    },
    chunk = (t, b) => {
      const head = Buffer.alloc(4),
        tail = Buffer.alloc(4),
        name = Buffer.from(t);
      head.writeUInt32BE(b.length);
      tail.writeUInt32BE(crc(Buffer.concat([name, b])));
      return Buffer.concat([head, name, b, tail]);
    },
    ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const bytes = Buffer.alloc((width * 3 + 1) * height, 220);
  for (let y = 0; y < height; y++) bytes[y * (width * 3 + 1)] = 0;
  return (
    "data:image/png;base64," +
    Buffer.concat([
      Buffer.from("89504e470d0a1a0a", "hex"),
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(bytes)),
      chunk("IEND", Buffer.alloc(0)),
    ]).toString("base64")
  );
}
async function upload(call, data, kind = "poster") {
  const id = ok(await call("promo/images", "POST", { kind })).id;
  for (let i = 0; i < data.length; i += 500000)
    ok(
      await call("promo/images/" + id + "/part", "POST", {
        index: i / 500000,
        data: data.slice(i, i + 500000),
      }),
    );
  ok(await call("promo/images/" + id + "/complete", "POST", {}));
  return id;
}
const posterSlots = {
  logo: { x: 20, y: 20, width: 120, height: 100 },
  qr: { x: 850, y: 850, width: 180, height: 180 },
  text: {
    x: 20,
    y: 1020,
    width: 1000,
    height: 40,
    font_size: 24,
    color: "#222222",
    align: "center",
  },
};
test("第八阶段：R2图片分片/类型/尺寸/作用域、海报框校验，品牌独立且不漏其他机构，效果统计真实事件", async () => {
  const f = await fixture();
  try {
    const { a, b } = await promoFixture(f),
      con = (...args) => adminCall(f, ...args),
      id = ok(
        await con("promo", "POST", {
          type: "material",
          title: "测试物料",
          audience: "selected",
          tenant_ids: [a.t.id],
          status: "published",
        }),
      ).id;
    const image = await upload(con, png());
    ok(
      await con("promo/" + id + "/posters", "POST", {
        image_key: image,
        slots: {
          ...posterSlots,
          qr: { x: 1000, y: 1000, width: 200, height: 200 },
        },
      }),
      400,
    );
    const p = ok(
      await con("promo/" + id + "/posters", "POST", {
        image_key: image,
        slots: posterSlots,
      }),
    ).id;
    const template = ok(await con("promo/" + id)).posters.find(
      (x) => x.id === p,
    );
    ok(
      await con("promo/" + id + "/posters", "POST", {
        id: p,
        version: template.version,
        image_key: image,
        slots: { ...posterSlots, logo: { ...posterSlots.logo, x: 80 } },
      }),
    );
    ok(
      await con("promo/" + id + "/posters", "POST", {
        id: p,
        version: template.version,
        image_key: image,
        slots: posterSlots,
      }),
      409,
    );
    ok(await request(a, "promo/images/" + image));
    ok(await request(b, "promo/images/" + image), 404);
    const own = await upload((...args) => request(a, ...args), png(200, 100));
    ok(
      await request(a, "promo/assets", "PUT", { logo_key: own, qr_key: null }),
    );
    const v = ok(await request(a, "promo/assets")).assets;
    assert.equal(v.logo_key, own);
    const brand = await a.r.brand();
    assert.equal(brand.logo, null);
    ok(await request(b, "promo/images/" + own), 404);
    ok(
      await request(b, "promo/assets", "PUT", { logo_key: own, qr_key: null }),
      400,
    );
    const job = ok(await request(a, "promo/images", "POST", {})).id;
    ok(
      await request(b, "promo/images/" + job + "/part", "POST", {
        index: 0,
        data: "bad",
      }),
      404,
    );
    ok(
      await request(a, "promo/images/" + job + "/part", "POST", {
        index: 2,
        data: "bad",
      }),
      400,
    );
    ok(
      await request(a, "promo/images/" + job + "/part", "POST", {
        index: 0,
        data: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
      }),
    );
    ok(await request(a, "promo/images/" + job + "/complete", "POST", {}), 400);
    for (const action of ["view", "download", "save"])
      ok(
        await request(a, "promo/" + id + "/posters/" + p + "/event", "POST", {
          action,
        }),
      );
    ok(await request(a, "promo/" + id + "/read", "POST", {}));
    const stats = ok(await con("promo/" + id)).stats;
    assert.equal(stats.viewed, 1);
    assert.equal(stats.downloads, 2);
    assert.equal(stats.delivered, 1);
    ok(
      await request(
        a,
        "promo/" + id + "/posters/poster_000000000000000000000000/event",
        "POST",
        { action: "view" },
      ),
      404,
    );
  } finally {
    f.restore();
  }
});
async function openCourse(f, a, data = {}) {
  const id = ok(await adminCall(f, "promo", "POST", courseData(a, data))).id;
  ok(
    await request(a, "promo/" + id + "/application", "POST", {
      est_size: 2,
      unsure: false,
    }),
  );
  let d = ok(await adminCall(f, "promo/" + id));
  const app = d.applications[0];
  ok(
    await adminCall(f, "promo/" + id + "/applications/" + app.id, "PUT", {
      version: app.version,
      status: "confirmed",
      confirmed_size: 2,
      consultant: "顾问",
    }),
  );
  d = ok(await adminCall(f, "promo/" + id));
  ok(
    await adminCall(f, "promo/" + id + "/open", "POST", {
      version: d.course.version,
    }),
  );
  const app2 = ok(await request(a, "promo/" + id)).application;
  ok(
    await request(a, "promo/" + id + "/roster", "PUT", {
      version: app2.version,
      student_ids: a.students.slice(0, 2),
    }),
  );
  return { id, ...ok(await adminCall(f, "promo/" + id)) };
}
test("第八阶段：未成班只取消未来课次，已开始记录与审计保留；已开课机构撤回只提示联系平台", async () => {
  const f = await fixture(),
    real = Date.now;
  try {
    const { a } = await promoFixture(f),
      at = Date.now(),
      bj = (t) => new Date(t + 8 * 3600000).toISOString().slice(0, 16),
      d = await openCourse(f, a, {
        apply_deadline: at + 120000,
        sessions: [
          { start_at: bj(at + 600000), duration: 30 },
          { start_at: bj(at + 86400000), duration: 60 },
        ],
      });
    Date.now = () => at + 1200000;
    const app = ok(await request(a, "promo/" + d.id)).application;
    const withdraw = await request(a, "promo/" + d.id + "/withdraw", "POST", {
      version: app.version,
    });
    ok(withdraw, 409);
    assert.equal(withdraw.body.error, "请联系平台处理");
    ok(
      await adminCall(f, "promo/" + d.id + "/fail", "POST", {
        version: d.course.version,
        reason: "合作课程调整安排",
      }),
    );
    const rows = f.db.raw
      .prepare(
        "SELECT * FROM lessons WHERE tenant_id=? AND source_course_id=? ORDER BY start_at",
      )
      .all(a.t.id, d.course.id);
    assert.equal(rows[0].deleted_at, null);
    assert.ok(rows[1].deleted_at);
    assert.equal(
      f.db.raw
        .prepare(
          "SELECT COUNT(*) n FROM lesson_participants WHERE tenant_id=? AND lesson_id=?",
        )
        .get(a.t.id, rows[0].id).n,
      2,
    );
    assert.ok(
      f.db.raw
        .prepare(
          "SELECT COUNT(*) n FROM platform_audit WHERE action='推广中心'",
        )
        .get().n > 0,
    );
  } finally {
    Date.now = real;
    f.restore();
  }
});
async function restoreJob(f, a, backupId) {
  const path = "tenants/" + a.t.id + "/jobs",
    created = ok(
      await adminCall(f, path, "POST", {
        kind: "restore",
        backup_id: backupId,
        reason: "合作课恢复回归",
      }),
    );
  let d = ok(await adminCall(f, path + "/" + created.id));
  for (const p of d.manifest.required)
    ok(
      await adminCall(f, path + "/" + created.id + "/page", "POST", {
        table: p.table,
        offset: p.offset,
      }),
    );
  return { path: path + "/" + created.id, id: created.id };
}
test("第八阶段：恢复普通业务保留当前合作课改期、名单、讲师和来源；缺少参课学员先阻止恢复", async () => {
  const f = await fixture();
  try {
    const { a } = await promoFixture(f);
    const first = await startBackup(f.env);
    while (!(await continueBackup(f.env)).done) {}
    const d = await openCourse(f, a);
    let ss = d.sessions[0];
    ok(
      await adminCall(f, "promo/" + d.id + "/sessions/" + ss.id, "PUT", {
        version: ss.version,
        start_at: ss.start_at.slice(0, 11) + "12:00",
        duration: 60,
        meeting_no: "888",
      }),
    );
    const before = f.db.raw
      .prepare("SELECT * FROM lessons WHERE tenant_id=? AND source_course_id=?")
      .get(a.t.id, d.course.id);
    const job = await restoreJob(f, a, first.id);
    ok(await adminCall(f, job.path + "/commit", "POST", {}));
    const after = f.db.raw
      .prepare("SELECT * FROM lessons WHERE tenant_id=? AND id=?")
      .get(a.t.id, before.id);
    assert.equal(after.start_at, before.start_at);
    assert.equal(after.source_course_id, d.course.id);
    assert.equal(after.duration, 60);
    assert.equal(
      f.db.raw
        .prepare(
          "SELECT COUNT(*) n FROM lesson_participants WHERE tenant_id=? AND lesson_id=?",
        )
        .get(a.t.id, before.id).n,
      2,
    );
    // New student introduced after the backup must block restoring the old archive.
    const fresh = b64(bytes(32));
    await a.r.createSession(await sha(fresh), await a.r.user(a.user.id), {
      ip: "test",
      ua: "restore",
    });
    a.token = fresh;
    const child = ok(
      await request(a, "data/students", "POST", { name: "备份后参课学员" }),
    ).id;
    const app = ok(await request(a, "promo/" + d.id)).application;
    ok(
      await request(a, "promo/" + d.id + "/roster", "PUT", {
        version: app.version,
        student_ids: [child],
      }),
    );
    const job2 = await restoreJob(f, a, first.id);
    const blocked = await adminCall(f, job2.path + "/commit", "POST", {});
    ok(blocked, 409);
    assert.ok(blocked.body.error.includes("备份后参课学员"));
  } finally {
    f.restore();
  }
});

const evidence = (key, data) => {
  if (process.env.PROMO_EVIDENCE === "1")
    console.log("PROMO_EVIDENCE " + JSON.stringify({ key, data }));
};
test("推广改版 P1/P4/P5/P9：真实100人导入和第二机构，顾问权限、跟进、收款、开班及财务不变", async () => {
  const f = await fixture();
  try {
    const a = { ...(await schoolFixture(f, "promo100")), f },
      b = { ...(await setup(f, 1, "promo-other")), f };
    const raw = JSON.parse(
      await readFile(
        new URL("../dev/mock/教务模拟数据_100人.json", import.meta.url),
      ),
    );
    const tables = Object.entries(raw).filter(
      ([, rows]) => Array.isArray(rows) && rows.length,
    );
    const jobPath = "tenants/" + a.t.id + "/jobs";
    const job = ok(
      await adminCall(f, jobPath, "POST", {
        kind: "legacy",
        counts: Object.fromEntries(
          tables.map(([key, rows]) => [key, rows.length]),
        ),
        settings: raw.settings,
        reason: "推广改版100人原数据验收",
      }),
    );
    for (const [table, rows] of tables)
      for (let i = 0; i < rows.length; i += 200)
        ok(
          await adminCall(f, jobPath + "/" + job.id + "/page", "POST", {
            table,
            rows: rows.slice(i, i + 200),
          }),
        );
    assert.equal(
      ok(await adminCall(f, jobPath + "/" + job.id + "/preview", "POST", {}))
        .counts.students,
      100,
    );
    ok(await adminCall(f, jobPath + "/" + job.id + "/commit", "POST", {}));
    await a.r.createSession(await sha(a.token), a.user, {
      ip: "fixture",
      ua: "fixture",
    });
    a.students = f.db.raw
      .prepare(
        "SELECT id FROM students WHERE tenant_id=? AND status='active' ORDER BY sort_order,id LIMIT 2",
      )
      .all(a.t.id)
      .map((x) => x.id);
    a.detailImage = seedLongImage(f);

    const prep = ok(
      await adminCall(f, "platform/accounts/prepare", "POST", {}),
    );
    const credentials = {
      username: "consultant-fixture",
      password: "PromoFixtureSecure95",
    };
    const step = Math.floor(Date.now() / 30000);
    const account = ok(
      await adminCall(f, "platform/accounts", "POST", {
        ...credentials,
        ...prep,
        totp: await totp(prep.secret, step - 1),
      }),
    );
    assert.equal(account.role, "consultant");
    evidence("owner.accounts", ok(await adminCall(f, "platform/accounts")));
    evidence("owner.consultant_created", account);
    ok(
      await adminCall(f, "login", "POST", {
        ...credentials,
        totp: await totp(prep.secret, step - 1),
      }),
      401,
    );
    const login = await f.request("https://console.school.test/api/login", {
      method: "POST",
      headers: {
        Origin: "https://console.school.test",
        "Cf-Access-Jwt-Assertion": f.access,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...credentials,
        totp: await totp(prep.secret, step),
      }),
    });
    assert.equal(login.status, 200);
    assert.equal((await login.json()).role, "consultant");
    const consultant = {
      ...f,
      adminCookie: login.headers.get("set-cookie").split(";")[0],
    };
    const con = (...args) => adminCall(consultant, ...args);
    evidence("consultant.me", ok(await con("me")));
    for (const endpoint of [
      "tenants",
      "tenants/" + a.t.id,
      "tenants/" + a.t.id + "/overview",
      "tenants/" + a.t.id + "/business",
      "tenants/" + a.t.id + "/accounts",
      "tenants/" + a.t.id + "/jobs",
      "tenants/" + a.t.id + "/export-schema",
      "announcements",
      "alerts",
      "logs",
      "overview",
      "backups",
      "referrals",
      "platform/accounts",
      "platform/features/referrals",
    ])
      ok(await con(endpoint), 403);
    ok(
      await con("platform/features/referrals", "PUT", { enabled: false }),
      403,
    );
    ok(await con("platform/accounts/prepare", "POST", {}), 403);

    const campaign = ok(
      await con("promo", "POST", courseData(a, { audience: "all" })),
    ).id;
    await request(b, "promo/" + campaign + "/read", "POST", {});
    const applied = ok(
      await request(a, "promo/" + campaign + "/application", "POST", {
        est_size: 2,
      }),
    );
    assert.equal(applied.ok, true);
    let detail = ok(await con("promo/" + campaign));
    const app = detail.applications[0],
      endpoint = "promo/" + campaign + "/applications/" + app.id;
    assert.equal(detail.application_summary.viewed_not_applied, 1);
    assert.equal(detail.application_summary.unviewed, 1);
    assert.equal(app.contact_phone, "13911112222");
    const note = ok(
      await con("promo/" + campaign + "/followups", "POST", {
        tenant_id: a.t.id,
        text: "已与机构确认两位学员",
      }),
    );
    const notes = ok(
      await con("promo/" + campaign + "/followups?tenant_id=" + a.t.id),
    );
    assert.equal(notes.items[0].admin_name, credentials.username);
    evidence("consultant.followup_create", note);
    evidence("consultant.followups", notes);
    ok(
      await con(endpoint, "PUT", {
        version: app.version,
        status: "confirmed",
        confirmed_size: 2,
      }),
    );
    detail = ok(await con("promo/" + campaign));
    assert.equal(
      detail.applications[0].last_followup_summary,
      "已与机构确认两位学员",
    );
    assert.equal(detail.applications[0].amount_due, 246);
    const financePaths = [
      "c3/report?month=2026-11",
      "c3/receipts?month=2026-11",
      "c3/costs-summary?month=2026-11",
    ];
    const readFinance = async () =>
      Promise.all(financePaths.map(async (path) => ok(await request(a, path))));
    const before = await readFinance();
    const paid = ok(
      await con(endpoint + "/paid", "PUT", {
        version: detail.applications[0].version,
        paid: true,
      }),
    );
    assert.deepEqual(await readFinance(), before);
    assert.equal(paid.paid, 1);
    const own = ok(await request(a, "promo/" + campaign));
    assert.equal(own.application.amount_due, 246);
    assert.equal(own.application.paid, 1);
    assert.equal("paid_by" in own.application, false);
    evidence("consultant.paid", paid);
    evidence("tenant.course_detail", own);
    const adminList = ok(await con("promo"));
    assert.equal(adminList.summary.unpaid_institutions, 0);
    assert.equal(adminList.items[0].confirmed_seats, 2);
    assert.equal(adminList.items[0].delivered, 2);
    evidence("consultant.campaign_list", adminList);
    detail = ok(await con("promo/" + campaign));
    const opened = ok(
      await con("promo/" + campaign + "/open", "POST", {
        version: detail.course.version,
      }),
    );
    evidence("consultant.open", opened);
    const current = ok(await request(a, "promo/" + campaign));
    ok(
      await request(a, "promo/" + campaign + "/roster", "PUT", {
        version: current.application.version,
        student_ids: a.students,
      }),
    );
    const academic = await accountToken(a, ["academic"]);
    const student = await accountToken(a, ["student"], a.students[0]);
    const from = detail.sessions[0].start_at.slice(0, 10);
    const to = new Date(Date.parse(from) + 86400000).toISOString().slice(0, 10);
    const sched = "schedule?from=" + from + "&to=" + to;
    const employeeLesson = ok(
      await request(a, sched, "GET", undefined, academic.token),
    ).items.find((row) => row.source_course_id === detail.course.id);
    assert.equal(employeeLesson.meeting_no, "123456");
    assert.equal(
      employeeLesson.meeting_url,
      "https://meeting.tencent.com/example",
    );
    for (const row of [
      ok(await request(a, sched, "GET", undefined, student.token)).items.find(
        (row) => row.id === employeeLesson.id,
      ),
      ok(
        await request(
          a,
          "data/lessons/" + employeeLesson.id,
          "GET",
          undefined,
          student.token,
        ),
      ).record,
    ]) {
      assert.equal("meeting_no" in row, false);
      assert.equal("meeting_url" in row, false);
    }
    for (const pattern of [
      "发布合作内容",
      "确认合作课席位",
      "标记合作课已收款",
    ])
      assert.ok(
        f.db.raw
          .prepare(
            "SELECT 1 FROM platform_audit WHERE admin_id=? AND instr(detail,?)>0",
          )
          .get(account.id, pattern),
      );
    const owner = ok(await adminCall(f, "platform/accounts")).items.find(
      (row) => row.role === "owner",
    );
    ok(
      await adminCall(f, "platform/accounts/" + owner.id, "PATCH", {
        active: false,
      }),
      409,
    );
    ok(
      await adminCall(f, "platform/accounts/" + account.id, "PATCH", {
        active: false,
      }),
    );
    ok(await con("promo"), 401);
    evidence(
      "owner.account_active",
      ok(
        await adminCall(f, "platform/accounts/" + account.id, "PATCH", {
          active: true,
        }),
      ),
    );
  } finally {
    f.restore();
  }
});

test("推广改版 P2/P3/P6：免费讲座、整数元兼容旧价格、750px 长图物料及二维码文字", async () => {
  const f = await fixture();
  try {
    const { a } = await promoFixture(f);
    const create = (extra) =>
      adminCall(f, "promo", "POST", courseData(a, extra));
    assert.match(
      (await create({ detail_image_key: null })).text,
      /请上传课程详情长图/,
    );
    const invalid = seedLongImage(f);
    f.db.raw
      .prepare("UPDATE promo_images SET width=749 WHERE id=?")
      .run(invalid);
    ok(await create({ detail_image_key: invalid }), 400);
    assert.match((await create({ seat_price: 12.34 })).text, /请填写整数元/);
    const id = ok(
      await create({
        format: "lecture",
        is_free: 1,
        seat_price: null,
        suggested_price: null,
      }),
    ).id;
    ok(
      await request(a, "promo/" + id + "/application", "POST", { est_size: 2 }),
    );
    let admin = ok(await adminCall(f, "promo/" + id));
    const target = "promo/" + id + "/applications/" + admin.applications[0].id;
    ok(
      await adminCall(f, target, "PUT", {
        version: admin.applications[0].version,
        status: "confirmed",
        confirmed_size: 2,
      }),
    );
    admin = ok(await adminCall(f, "promo/" + id));
    ok(
      await adminCall(f, target + "/paid", "PUT", {
        version: admin.applications[0].version,
        paid: true,
      }),
      409,
    );
    const updated = ok(
      await adminCall(f, "promo/" + id, "PATCH", {
        version: admin.campaign.version,
        course_version: admin.course.version,
        title: "免费讲座",
      }),
    );
    evidence("consultant.campaign_patch", updated);
    ok(await request(a, "promo/assets", "PUT", { qr_caption: "扫码联系老师" }));
    const assets = ok(await request(a, "promo/assets"));
    assert.equal(assets.assets.qr_caption, "扫码联系老师");
    evidence("tenant.assets", assets);
    ok(
      await request(a, "promo/assets", "PUT", {
        version: assets.assets.version,
        qr_caption: "一".repeat(13),
      }),
      400,
    );
    const detail = ok(await request(a, "promo/" + id));
    assert.equal(detail.campaign.format, "lecture");
    assert.equal(detail.campaign.is_free, 1);
    assert.equal(detail.application.amount_due, null);
    assert.equal(detail.materials.at(-1).kind, "long_image");
    assert.equal(detail.assets.qr_caption, "扫码联系老师");
    const listed = ok(await request(a, "promo"));
    assert.equal(listed.items[0].format, "lecture");
    assert.equal(listed.items[0].is_free, 1);
    evidence("tenant.free_lecture", detail);
    const old = ok(await create({})).id;
    f.db.raw
      .prepare(
        "UPDATE partner_courses SET seat_price=12345 WHERE campaign_id=?",
      )
      .run(old);
    assert.equal(
      ok(await request(a, "promo/" + old)).campaign.seat_price,
      123.45,
    );
  } finally {
    f.restore();
  }
});

test("推广改版 P7：未读、新内容、个人不再提示和截止提醒的原子一次性", async () => {
  const f = await fixture();
  try {
    const { a, b } = await promoFixture(f);
    const message = ok(
      await adminCall(f, "promo", "POST", {
        type: "message",
        title: "合作提醒",
        status: "published",
        audience: "selected",
        tenant_ids: [a.t.id],
        cover: a.detailImage,
      }),
    ).id;
    assert.equal(ok(await request(a, "promo")).unread_count, 1);
    const first = ok(await request(a, "promo/recommend"));
    assert.equal(first.item.id, message);
    assert.equal(first.item.reason, "new");
    assert.equal(ok(await request(b, "promo/recommend")).item, null);
    const bells = ok(await request(a, "system-messages"));
    assert.equal(bells.items[0].source, "fengqin");
    assert.equal(bells.items[0].thumbnail_key, a.detailImage);
    assert.equal(bells.items[0].is_read, 0);
    evidence("tenant.bell", bells);
    ok(await request(a, "system-messages/" + message + "/read", "POST", {}));
    assert.equal(ok(await request(a, "promo")).unread_count, 0);
    const course = ok(
      await adminCall(
        f,
        "promo",
        "POST",
        courseData(a, { apply_deadline: Date.now() + 4 * 86400000 }),
      ),
    ).id;
    assert.equal(ok(await request(a, "promo/recommend")).item.id, course);
    ok(await request(a, "promo/" + course + "/dismiss", "POST", {}));
    assert.equal(ok(await request(a, "promo/recommend")).item, null);
    f.db.raw
      .prepare(
        "UPDATE partner_courses SET apply_deadline=? WHERE campaign_id=?",
      )
      .run(Date.now() + 86400000, course);
    const both = await Promise.all([
      request(a, "promo/recommend"),
      request(a, "promo/recommend"),
    ]);
    const reminders = both.map((r) => ok(r).item).filter(Boolean);
    assert.equal(reminders.length, 1);
    assert.equal(reminders[0].reason, "deadline");
    evidence("tenant.recommend_deadline", { item: reminders[0] });
    evidence("tenant.recommend_empty", ok(await request(a, "promo/recommend")));
    const finance = await accountToken(a, ["finance"]);
    ok(
      await request(a, "promo/recommend", "GET", undefined, finance.token),
      403,
    );
  } finally {
    f.restore();
  }
});
