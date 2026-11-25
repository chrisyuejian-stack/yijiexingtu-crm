import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { fixture } from "./support.mjs";
import {
  setup,
  request,
  mutate,
  pack,
  lesson,
  details,
  status,
  balance,
  accountToken,
} from "./fixtures-credit.mjs";
import { randomId, sha, b64, bytes } from "../src/server/core.js";
async function write(s, path, d = {}, method = "POST", token = s.token) {
  return mutate(s, "finance/" + path, d, method, token);
}
async function check(res, code = 200) {
  assert.equal(res.status, code, res.text);
  return res.body;
}
async function rate(s, rate = 100, basis = "legacy", extra = {}) {
  return (
    await check(
      await write(s, "rates", {
        teacher_id: s.teacher,
        course_type_id: s.type,
        rate,
        rate_basis: basis,
        effective_from: "2026-01-01",
        effective_to: "2026-12-31",
        ...extra,
      }),
    )
  ).id;
}
async function resume(s, accounts = []) {
  for (const person of [{ token: s.token, id: s.user.id }, ...accounts])
    await s.r.createSession(
      await sha(person.token),
      await s.r.user(person.id),
      { ip: "test", ua: "finance" },
    );
}
test("修复：INTEGER分迁移、0.1+0.2精确合计、金额和课时小数限制、归属触发器", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    for (const file of [
      "0001_foundation.sql",
      "0003_scheduling.sql",
      "0004_credits.sql",
    ])
      db.exec(
        await readFile(
          new URL("../migrations/" + file, import.meta.url),
          "utf8",
        ),
      );
    db.exec(
      "INSERT INTO tenants(id,slug,name,type,city,status,staff_seat_limit,student_seat_limit,created_at,created_by,updated_at,updated_by) VALUES('t','t','测试','其他','','active',10,100,1,'a',1,'a')",
    );
    db.exec(
      "INSERT INTO students(tenant_id,id,name,created_at,created_by,updated_at,updated_by) VALUES('t','s','学员',1,'a',1,'a'); INSERT INTO course_categories(tenant_id,id,name,created_at,created_by,updated_at,updated_by) VALUES('t','c','课程',1,'a',1,'a');INSERT INTO course_types(tenant_id,id,name,category_id,created_at,created_by,updated_at,updated_by) VALUES('t','type','课程','c',1,'a',1,'a');INSERT INTO packages(tenant_id,id,student_id,course_type_id,unit_price,amount,created_at,created_by,updated_at,updated_by) VALUES('t','p','s','type',0.1,0.1+0.2,1,'a',1,'a');INSERT INTO student_payments(tenant_id,id,student_id,amount,paid_at,created_at,created_by,updated_at,updated_by) VALUES('t','pay','s',0.1+0.2,'2026-11-02',1,'a',1,'a')",
    );
    db.exec(
      await readFile(
        new URL("../migrations/0005_integer_money.sql", import.meta.url),
        "utf8",
      ),
    );
    const row = db
      .prepare("SELECT unit_price,amount,typeof(amount) typ FROM packages")
      .get();
    assert.equal(row.unit_price, 10);
    assert.equal(row.amount, 30);
    assert.equal(row.typ, "integer");
    assert.equal(
      db.prepare("SELECT amount FROM student_payments").get().amount,
      30,
    );
    assert.equal(
      db
        .prepare(
          "SELECT type FROM pragma_table_info('student_payments') WHERE name='amount'",
        )
        .get().type,
      "INTEGER",
    );
  } finally {
    db.close();
  }
  const f = await fixture();
  try {
    const s = { ...(await setup(f, 2)), f },
      p = await pack(s);
    for (const amount of [0.1, 0.2])
      await check(
        await mutate(s, "credits/payments", {
          student_id: s.students[0],
          amount,
        }),
      );
    assert.equal(
      f.db.raw
        .prepare("SELECT SUM(amount) n FROM student_payments WHERE tenant_id=?")
        .get(s.t.id).n,
      30,
    );
    assert.equal(
      (await request(s, "credits/payments")).body.items.reduce(
        (sum, p) => sum + Math.round(p.amount * 100),
        0,
      ),
      30,
    );
    await check(
      await mutate(s, "credits/payments", {
        student_id: s.students[0],
        amount: 0.001,
      }),
      400,
    );
    await check(
      await mutate(s, "credits/packages", {
        student_id: s.students[0],
        course_type_id: s.type,
        units_total: 0.0001,
      }),
      400,
    );
    await check(
      await s.call("data/lessons", "POST", {
        start_at: "2026-11-18T09:00",
        teacher_id: s.teacher,
        course_type_id: s.type,
        location_id: s.room,
        duration: 45,
        units: 0.0001,
        student_ids: s.students,
      }),
      400,
    );
    await check(
      await mutate(s, "credits/adjust", {
        package_id: p,
        delta: 0.0001,
        reason: "精度拒绝",
      }),
      400,
    );
    const stamp = Date.now(),
      insert =
        "INSERT INTO package_transactions(tenant_id,id,package_id,student_id,delta,type,date,created_at,created_by,updated_at,updated_by) VALUES(?,?,?,?,?,?,?,?,?,?,?)";
    assert.throws(
      () =>
        f.db.raw
          .prepare(insert)
          .run(
            s.t.id,
            "bad",
            p,
            s.students[1],
            1,
            "adjustment",
            "2026-11-02",
            stamp,
            "x",
            stamp,
            "x",
          ),
      /invalid_package_student/,
    );
    assert.throws(
      () =>
        f.db.raw
          .prepare(
            "INSERT INTO student_payments(tenant_id,id,student_id,package_id,amount,paid_at,created_at,created_by,updated_at,updated_by) VALUES(?,?,?,?,?,?,?,?,?,?)",
          )
          .run(
            s.t.id,
            "badpay",
            s.students[1],
            p,
            100,
            "2026-11-02",
            stamp,
            "x",
            stamp,
            "x",
          ),
      /invalid_payment_student/,
    );
  } finally {
    f.restore();
  }
});
test("修复：教务默认不能调整或转换；单独授权；参考比例20%边界和原因", async () => {
  const f = await fixture();
  try {
    const s = { ...(await setup(f, 1)), f },
      p = await pack(s),
      type2 = await s.create("course_types", {
        name: "课程二",
        category_id: s.cat,
        format: "group",
        capacity: 40,
      }),
      target = (
        await check(
          await mutate(s, "credits/packages", {
            student_id: s.students[0],
            course_type_id: type2,
            units_total: 0,
            unit_price: 50,
          }),
        )
      ).id,
      academic = await accountToken(s, ["academic"]);
    await check(
      await mutate(
        s,
        "credits/adjust",
        { package_id: p, delta: 1, reason: "非法" },
        "POST",
        academic.token,
      ),
      403,
    );
    await check(
      await mutate(
        s,
        "credits/transfer",
        {
          from_package_id: p,
          to_package_id: target,
          from_units: 1,
          to_units: 2,
        },
        "POST",
        academic.token,
      ),
      403,
    );
    await s.r.saveRights("academic", "packages", "transfer", true, {
      id: s.user.id,
      name: "主管",
    });
    await resume(s, [academic]);
    const preview = await request(
      s,
      "credits/transfer?from_package_id=" + p + "&to_package_id=" + target,
      "GET",
      undefined,
      academic.token,
    );
    await check(preview);
    assert.equal(preview.body.reference_ratio, 2);
    assert.ok(!/unit_price|amount/.test(preview.text));
    await check(
      await mutate(
        s,
        "credits/transfer",
        {
          from_package_id: p,
          to_package_id: target,
          from_units: 1,
          to_units: 2.4,
        },
        "POST",
        academic.token,
      ),
    );
    await check(
      await mutate(
        s,
        "credits/transfer",
        {
          from_package_id: p,
          to_package_id: target,
          from_units: 1,
          to_units: 2.41,
        },
        "POST",
        academic.token,
      ),
      400,
    );
    await check(
      await mutate(
        s,
        "credits/transfer",
        {
          from_package_id: p,
          to_package_id: target,
          from_units: 1,
          to_units: 3,
          reason: "调整兑换安排",
        },
        "POST",
        academic.token,
      ),
    );
    await check(
      await mutate(
        s,
        "credits/adjust",
        { package_id: p, delta: 1, reason: "仍未授权" },
        "POST",
        academic.token,
      ),
      403,
    );
    await s.r.saveRights("academic", "packages", "adjust", true, {
      id: s.user.id,
      name: "主管",
    });
    await resume(s, [academic]);
    await check(
      await mutate(
        s,
        "credits/adjust",
        { package_id: p, delta: 0.01, reason: "已单独授权" },
        "POST",
        academic.token,
      ),
    );
  } finally {
    f.restore();
  }
});
test("第四阶段：三种新增计费模式与旧按课时并存、生效日期、单课覆盖和助教不计酬", async () => {
  const f = await fixture();
  try {
    const s = { ...(await setup(f, 2)), f };
    for (const st of s.students) await pack(s, st);
    const id = await lesson(s);
    await status(s, id, "completed");
    const rid = await rate(s, 125.5);
    let data = await check(await request(s, "finance/payroll?month=2026-11"));
    assert.equal(
      data.items.find((t) => t.teacher_id === s.teacher).accrued_amount,
      125.5,
    );
    let row = await s.r.businessGet("teacher_rates", rid);
    await check(
      await write(
        s,
        "rates/" + rid,
        { version: row.version, rate_basis: "lesson", rate: 90 },
        "PATCH",
      ),
    );
    data = await check(await request(s, "finance/payroll?month=2026-11"));
    assert.equal(data.items[0].accrued_amount, 90);
    row = await s.r.businessGet("teacher_rates", rid);
    await check(
      await write(
        s,
        "rates/" + rid,
        { version: row.version, rate_basis: "person", rate: 30 },
        "PATCH",
      ),
    );
    data = await check(await request(s, "finance/payroll?month=2026-11"));
    assert.equal(data.items[0].accrued_amount, 60);
    let l = await details(s, id);
    await check(
      await write(s, "lessons/" + id + "/rate", {
        version: l.version,
        override_rate: 77.77,
        override_basis: "legacy",
      }),
    );
    data = await check(await request(s, "finance/payroll?month=2026-11"));
    assert.equal(data.items[0].accrued_amount, 77.77);
    assert.equal(
      f.db.raw
        .prepare("SELECT override_rate FROM lessons WHERE tenant_id=? AND id=?")
        .get(s.t.id, id).override_rate,
      7777,
    );
    await check(
      await write(s, "rates", {
        teacher_id: s.teacher,
        course_type_id: s.type,
        rate: 1,
        effective_from: "2026-11-01",
        effective_to: "2026-12-01",
      }),
      409,
    );
    const assistant = await s.create("teachers", { name: "助教" }),
      second = await s.call("data/lessons", "POST", {
        start_at: "2026-11-19T09:00",
        teacher_id: s.teacher,
        assistant_id: assistant,
        course_type_id: s.type,
        location_id: s.room,
        duration: 45,
        units: 1,
        student_ids: s.students,
      });
    await status(s, second.body.id, "completed");
    data = await check(await request(s, "finance/payroll?month=2026-11"));
    assert.equal(
      data.items.find((r) => r.teacher_id === assistant).total_amount,
      0,
    );
  } finally {
    f.restore();
  }
});
test("第四阶段：收款、课酬调整付款、其他成本、利润及按领域裁剪", async () => {
  const f = await fixture();
  try {
    const s = { ...(await setup(f, 1)), f };
    await pack(s);
    const id = await lesson(s);
    await status(s, id, "completed");
    await rate(s, 100);
    await check(
      await write(s, "adjustments", {
        teacher_id: s.teacher,
        month: "2026-11",
        amount: -10.25,
        reason: "课酬修订",
      }),
    );
    await check(
      await write(s, "payments", {
        teacher_id: s.teacher,
        month: "2026-11",
        amount: 50.1,
        paid_at: "2026-11-02",
      }),
    );
    await check(
      await write(s, "costs", {
        date: "2026-11-02",
        category: "教室",
        amount: 12.35,
      }),
    );
    await check(
      await mutate(s, "credits/payments", {
        student_id: s.students[0],
        amount: 200.2,
        paid_at: "2026-11-02",
      }),
    );
    const payroll = await check(
      await request(s, "finance/payroll?month=2026-11"),
    );
    assert.equal(payroll.items[0].total_amount, 89.75);
    assert.equal(payroll.items[0].unpaid_amount, 39.65);
    const report = await check(
      await request(s, "finance/report?month=2026-11"),
    );
    assert.equal(report.profit_amount, 98.1);
    const academic = await accountToken(s, ["academic"]);
    const safe = await check(
      await request(
        s,
        "finance/report?month=2026-11",
        "GET",
        undefined,
        academic.token,
      ),
    );
    assert.ok(!/amount|rate|unit_price/.test(JSON.stringify(safe)));
    await check(
      await request(
        s,
        "finance/payroll?month=2026-11",
        "GET",
        undefined,
        academic.token,
      ),
      403,
    );
    await check(
      await request(s, "finance/costs", "GET", undefined, academic.token),
      403,
    );
    const r = (await request(s, "credits/payments")).body.items[0];
    await check(
      await write(
        s,
        "tuition/" + r.id,
        { version: r.version, amount: 201.21 },
        "PATCH",
      ),
    );
    assert.equal(
      (await request(s, "credits/payments/" + r.id)).body.record.amount,
      201.21,
    );
  } finally {
    f.restore();
  }
});
async function teacherAccount(s, teacherId = s.teacher) {
  const made = await check(
    await s.call("accounts", "POST", {
      name: "教师账号",
      phone: "137" + String(Math.floor(Math.random() * 1e8)).padStart(8, "0"),
      roles: ["teacher"],
      teacher_id: teacherId,
    }),
    201,
  );
  s.f.db.raw
    .prepare("UPDATE users SET must_change=0 WHERE tenant_id=? AND id=?")
    .run(s.t.id, made.id);
  const token = b64(bytes(32));
  await s.r.createSession(await sha(token), await s.r.user(made.id), {
    ip: "test",
    ua: "payroll",
  });
  return { token, id: made.id };
}
test("第四阶段：财务提交主管批准、提交后变更重提、锁月阻断、解锁原因及教师确认状态", async () => {
  const f = await fixture();
  try {
    const s = { ...(await setup(f, 1)), f };
    await pack(s);
    const id = await lesson(s);
    await status(s, id, "completed");
    await rate(s, 100);
    const finance = await accountToken(s, ["finance"]),
      teacher = await teacherAccount(s),
      payload = { month: "2026-11", version: 0 };
    await check(await write(s, "settlements/submit", payload), 403);
    await check(
      await write(s, "settlements/submit", payload, "POST", finance.token),
    );
    await check(
      await write(
        s,
        "settlements/approve",
        { month: "2026-11", version: 1 },
        "POST",
        finance.token,
      ),
      403,
    );
    await check(
      await write(s, "costs", {
        date: "2026-11-02",
        category: "费用",
        amount: 0.1,
      }),
    );
    await check(
      await write(s, "settlements/approve", { month: "2026-11", version: 1 }),
      409,
    );
    await check(
      await write(
        s,
        "settlements/submit",
        { month: "2026-11", version: 1 },
        "POST",
        finance.token,
      ),
    );
    await check(
      await write(s, "settlements/approve", { month: "2026-11", version: 2 }),
    );
    let own = await check(
      await request(
        s,
        "finance/payroll?month=2026-11",
        "GET",
        undefined,
        teacher.token,
      ),
    );
    assert.equal(own.confirmation_status, "confirmed");
    assert.equal(own.items[0].accrued_amount, 100);
    const d = await details(s, id);
    await check(
      await mutate(s, "credits/lessons/" + id + "/undo", {
        lesson_version: d.version,
      }),
      409,
    );
    await check(
      await write(s, "payments", {
        teacher_id: s.teacher,
        month: "2026-11",
        amount: 1,
        paid_at: "2026-11-02",
      }),
      200,
    );
    await check(
      await write(s, "adjustments", {
        teacher_id: s.teacher,
        month: "2026-11",
        amount: 1,
        reason: "锁月应计保护",
      }),
      409,
    );
    await check(
      await mutate(s, "credits/payments", {
        student_id: s.students[0],
        amount: 1,
        paid_at: "2026-11-02",
      }),
      409,
    );
    await check(
      await write(
        s,
        "settlements/unlock",
        { month: "2026-11", version: 3, reason: "财务不能解锁" },
        "POST",
        finance.token,
      ),
      403,
    );
    await check(
      await write(s, "settlements/unlock", {
        month: "2026-11",
        version: 3,
        reason: "",
      }),
      400,
    );
    await check(
      await write(s, "settlements/unlock", {
        month: "2026-11",
        version: 3,
        reason: "核对课酬后重提",
      }),
    );
    own = await check(
      await request(
        s,
        "finance/payroll?month=2026-11",
        "GET",
        undefined,
        teacher.token,
      ),
    );
    assert.equal(own.confirmation_status, "unconfirmed");
    await check(
      await write(s, "settlements/approve", { month: "2026-11", version: 4 }),
      409,
    );
    await check(
      await write(
        s,
        "settlements/submit",
        { month: "2026-11", version: 4 },
        "POST",
        finance.token,
      ),
    );
    await check(
      await write(s, "settlements/approve", { month: "2026-11", version: 5 }),
    );
    const logs = await s.r.logs("audit", 0);
    assert.ok(
      logs.some(
        (l) => l.action === "unlock" && l.after_json.includes("核对课酬后重提"),
      ),
    );
    assert.throws(
      () => f.db.raw.exec("UPDATE payroll_snapshots SET amount=999"),
      /append only/,
    );
  } finally {
    f.restore();
  }
});
test("第四阶段：教师只读本人课酬、跨机构财务ID拒绝、真实XLSX文本防注入与导出预算", async () => {
  const f = await fixture();
  try {
    const s = { ...(await setup(f, 1)), f },
      foreign = { ...(await setup(f, 1, "other")), f };
    await pack(s);
    const id = await lesson(s);
    await status(s, id, "completed");
    const rid = await rate(s, 55.55),
      otherTeacher = await s.create("teachers", { name: "其他教师" }),
      teacher = await teacherAccount(s),
      academic = await accountToken(s, ["academic"]);
    await check(
      await request(
        s,
        "finance/payroll?month=2026-11&teacher_id=" + otherTeacher,
        "GET",
        undefined,
        teacher.token,
      ),
      404,
    );
    await check(await request(foreign, "finance/rates/" + rid), 404);
    await check(
      await write(
        { ...s, token: foreign.token, t: foreign.t },
        "rates/" + rid,
        { version: 1, rate: 1 },
        "PATCH",
      ),
      404,
    );
    const safe = await check(
      await request(
        s,
        "finance/payroll?month=2026-11",
        "GET",
        undefined,
        teacher.token,
      ),
    );
    assert.equal(safe.items.length, 1);
    assert.equal(safe.items[0].teacher_id, s.teacher);
    assert.ok(!JSON.stringify(safe).includes(otherTeacher));
    let student = await s.r.businessGet("students", s.students[0]);
    await check(
      await s.call("data/students/" + student.id, "PATCH", {
        version: student.version,
        name: "<img src=x onerror=alert(1)>",
      }),
    );
    const exported = await f.request(
      "https://school.test/" +
        s.t.slug +
        "/api/export?kind=report&month=2026-11",
      { headers: { Cookie: "channel_session=" + s.token } },
    );
    assert.equal(exported.status, 200);
    assert.ok(Number(exported.headers.get("x-test-d1-queries")) <= 40);
    const bytes = new Uint8Array(await exported.arrayBuffer()),
      view = new DataView(bytes.buffer);
    let at = 0,
      xml = "";
    while (view.getUint32(at, true) === 0x04034b50) {
      const len = view.getUint32(at + 18, true),
        n = view.getUint16(at + 26, true),
        extra = view.getUint16(at + 28, true),
        name = new TextDecoder().decode(bytes.slice(at + 30, at + 30 + n)),
        start = at + 30 + n + extra;
      if (name === "xl/worksheets/sheet1.xml")
        xml = new TextDecoder().decode(bytes.slice(start, start + len));
      at = start + len;
    }
    assert.ok(xml.includes("&lt;img src=x onerror=alert(1)&gt;"));
    assert.ok(!xml.includes("<f>"));
    assert.ok(!xml.includes("<img "));
    await mkdir("work/reports", { recursive: true });
    await writeFile("work/reports/finance-export-proof.xlsx", bytes);
    const denied = await f.request(
      "https://school.test/" +
        s.t.slug +
        "/api/export?kind=finance&month=2026-11",
      { headers: { Cookie: "channel_session=" + academic.token } },
    );
    assert.equal(denied.status, 403);
  } finally {
    f.restore();
  }
});
test("第四阶段：同一份旧版导出形状数据对照 rate/teacherCost/financeItems/paidTeacher", async () => {
  const { legacyFinanceOracle } = await import("./fixtures-legacy-finance.mjs"),
    f = await fixture();
  try {
    const s = { ...(await setup(f, 2)), f };
    for (const st of s.students) await pack(s, st, 30);
    await s.r.saveSetting(
      "absence_policies",
      {
        student_leave: { deduct: false, teacherPaid: true },
        student_no_show: { deduct: true, teacherPaid: true },
        teacher_leave: { deduct: false, teacherPaid: false },
        cancelled: { deduct: false, teacherPaid: false },
      },
      { id: s.user.id, name: "主管" },
    );
    const rid = await rate(s, 88.5),
      lessons = [];
    for (const [i, state] of [
      "completed",
      "student_leave",
      "student_no_show",
      "teacher_leave",
      "cancelled",
      "planned",
    ].entries()) {
      const id = await lesson(
        s,
        "2026-11-" + String(10 + i).padStart(2, "0") + "T09:00",
      );
      await status(s, id, state);
      lessons.push({
        id,
        start: "2026-11-" + String(10 + i).padStart(2, "0") + "T09:00",
        units: 1,
        teacherId: s.teacher,
        courseTypeId: s.type,
        format: "group",
        status: state,
        locationId: s.room,
      });
    }
    const d = await details(s, lessons[0].id);
    await check(
      await write(s, "lessons/" + d.id + "/rate", {
        version: d.version,
        override_rate: 99.99,
      }),
    );
    lessons[0].overrideRate = 99.99;
    const payment = await check(
      await write(s, "payments", {
        teacher_id: s.teacher,
        month: "2026-11",
        amount: 50.05,
        paid_at: "2026-11-02",
      }),
    );
    const legacy = {
        lessons,
        teachers: [{ id: s.teacher, name: "教师" }],
        courseTypes: [{ id: s.type, name: "班课", categoryId: s.cat }],
        categories: [{ id: s.cat, name: "基础" }],
        students: s.students.map((id, i) => ({ id, name: "学员" + i })),
        locations: [{ id: s.room, name: "教室" }],
        teacherRates: [
          {
            id: rid,
            teacherId: s.teacher,
            courseTypeId: s.type,
            format: "group",
            rate: 88.5,
          },
        ],
        lessonParticipants: lessons.flatMap((l) =>
          s.students.map((studentId) => ({
            id: randomId("legacy"),
            lessonId: l.id,
            studentId,
            attendance:
              { completed: "attended", student_no_show: "no_show" }[l.status] ||
              l.status,
          })),
        ),
        teacherPayments: [
          {
            id: payment.id,
            teacherId: s.teacher,
            month: "2026-11",
            amount: 50.05,
          },
        ],
        settlements: [],
        settings: {
          absencePolicies: {
            student_leave: { teacherPaid: true },
            student_no_show: { teacherPaid: true },
            teacher_leave: { teacherPaid: false },
            cancelled: { teacherPaid: false },
          },
        },
      },
      ui = { month: "2026-11", financeMode: "teacher" },
      oracle = legacyFinanceOracle(legacy, ui),
      actual = await check(await request(s, "finance/payroll?month=2026-11"));
    for (const row of actual.lessons)
      assert.equal(
        Math.round(row.amount * 100),
        Math.round(
          oracle.teacherCost(legacy.lessons.find((l) => l.id === row.id)) * 100,
        ),
      );
    assert.equal(
      Math.round(actual.items[0].paid_amount * 100),
      Math.round(oracle.paidTeacher(s.teacher, "2026-11") * 100),
    );
    await writeFile("work/reports/legacy-fixture.json", JSON.stringify(legacy));
    const report = await check(
      await request(s, "finance/report?month=2026-11"),
    );
    for (const [mode, key] of [
      ["teacher", "teachers"],
      ["type", "courses"],
      ["student", "students"],
    ]) {
      ui.financeMode = mode;
      for (const expected of oracle.financeItems()) {
        const found = report[key].find((row) => row.id === expected.id);
        assert.equal(
          Math.round(found.teacher_pay_amount * 100),
          Math.round(expected.amount * 100),
        );
      }
    }
    await mkdir("work/reports", { recursive: true });
    await writeFile(
      "work/reports/legacy-finance-comparison.json",
      JSON.stringify(
        {
          source: "old edu/app.js final functions",
          fixture: "同一份虚构旧版导出形状数据；非真实机构导出",
          expected_total: oracle
            .financeItems()
            .reduce((s, r) => s + r.amount, 0),
          actual_total: report.teachers.reduce(
            (s, r) => s + r.teacher_pay_amount,
            0,
          ),
          status: "PASS",
        },
        null,
        2,
      ),
    );
  } finally {
    f.restore();
  }
});
test("第四阶段：按课时保留旧版月合计并分配尾差；新增按课次独立逐节入分", async () => {
  const f = await fixture();
  try {
    const s = { ...(await setup(f, 1)), f };
    await pack(s);
    for (const date of ["2026-11-21T09:00", "2026-11-22T09:00"]) {
      const id = (
        await s.call("data/lessons", "POST", {
          start_at: date,
          teacher_id: s.teacher,
          course_type_id: s.type,
          location_id: s.room,
          duration: 30,
          units: 1,
          student_ids: s.students,
        })
      ).body.id;
      // Test-only seed of a grandfathered pre-upgrade record. Production APIs never permit this.
      const trigger = f.db.raw
        .prepare(
          "SELECT sql FROM sqlite_master WHERE name='course_limits_lessons_update'",
        )
        .get().sql;
      f.db.raw.exec("DROP TRIGGER course_limits_lessons_update");
      f.db.raw
        .prepare("UPDATE lessons SET units=0.5 WHERE tenant_id=? AND id=?")
        .run(s.t.id, id);
      f.db.raw.exec(trigger);
      await status(s, id, "completed");
    }
    const rid = await rate(s, 0.01);
    let payroll = await check(
      await request(s, "finance/payroll?month=2026-11"),
    );
    assert.equal(payroll.items[0].accrued_amount, 0.01);
    assert.equal(payroll.items[0].lesson_count, 2);
    assert.equal(
      payroll.lessons.reduce((s, r) => s + Math.round(r.amount * 100), 0),
      1,
    );
    assert.ok(payroll.lessons.some((e) => e.rounding_note));
    const report = await check(
      await request(s, "finance/report?month=2026-11"),
    );
    assert.equal(report.teachers[0].teacher_pay_amount, 0.01);
    const finance = await accountToken(s, ["finance"]);
    await check(
      await write(
        s,
        "settlements/submit",
        { month: "2026-11", version: 0 },
        "POST",
        finance.token,
      ),
    );
    await check(
      await write(s, "settlements/approve", { month: "2026-11", version: 1 }),
    );
    assert.equal(
      f.db.raw
        .prepare(
          "SELECT SUM(amount) n FROM payroll_snapshots WHERE tenant_id=?",
        )
        .get(s.t.id).n,
      1,
    );
    assert.equal(
      f.db.raw
        .prepare("SELECT total_amount FROM settlements WHERE tenant_id=?")
        .get(s.t.id).total_amount,
      1,
    );
    assert.equal(
      (await request(s, "finance/payroll?month=2026-11")).body.items[0]
        .accrued_amount,
      0.01,
    );
    await check(
      await write(s, "settlements/unlock", {
        month: "2026-11",
        version: 2,
        reason: "更换计费模式复核",
      }),
    );

    await check(
      await write(
        s,
        "rates/" + rid,
        { version: 1, rate_basis: "lesson" },
        "PATCH",
      ),
    );
    payroll = await check(await request(s, "finance/payroll?month=2026-11"));
    assert.equal(payroll.items[0].accrued_amount, 0.02);
  } finally {
    f.restore();
  }
});
test("第四阶段：主管审批不可委派、机构缺勤规则不可借历史授权改写、并发锁月只提交一次", async () => {
  const f = await fixture();
  try {
    const s = { ...(await setup(f, 1)), f };
    await pack(s);
    const id = await lesson(s);
    await status(s, id, "completed");
    await rate(s, 10);
    const finance = await accountToken(s, ["finance"]),
      academic = await accountToken(s, ["academic"]);
    await s.r.saveRights("finance", "settlements", "approve", true, {
      id: s.user.id,
      name: "主管",
    });
    await s.r.saveRights("academic", "settings", "update", true, {
      id: s.user.id,
      name: "主管",
    });
    await s.r.saveRights("academic", "settings", "configure_absence", true, {
      id: s.user.id,
      name: "主管",
    });
    await resume(s, [finance, academic]);
    await check(
      await request(
        s,
        "absence-policies",
        "PUT",
        {
          policies: {
            student_leave: { deduct: true, teacherPaid: true },
            student_no_show: { deduct: true, teacherPaid: true },
            teacher_leave: { deduct: true, teacherPaid: true },
            cancelled: { deduct: true, teacherPaid: true },
          },
        },
        academic.token,
      ),
      403,
    );
    await check(
      await write(
        s,
        "settlements/submit",
        { month: "2026-11", version: 0 },
        "POST",
        finance.token,
      ),
    );
    await check(
      await write(
        s,
        "settlements/approve",
        { month: "2026-11", version: 1 },
        "POST",
        finance.token,
      ),
      403,
    );
    const data = { month: "2026-11", version: 1, operation_id: randomId("op") },
      results = await Promise.all([
        request(s, "finance/settlements/approve", "POST", data),
        request(s, "finance/settlements/approve", "POST", data),
      ]);
    for (const res of results) await check(res);
    assert.equal(
      f.db.raw
        .prepare("SELECT COUNT(*) n FROM payroll_snapshots WHERE tenant_id=?")
        .get(s.t.id).n,
      1,
    );
    assert.equal(
      f.db.raw
        .prepare(
          "SELECT SUM(amount) n FROM payroll_snapshots WHERE tenant_id=?",
        )
        .get(s.t.id).n,
      1000,
    );
    const logs = await request(s, "logs");
    assert.ok(!logs.text.includes("lesson_json"));
  } finally {
    f.restore();
  }
});
test("第四阶段：未来标准日期调整不改变锁月；财务引用阻止教师/课程删除", async () => {
  const f = await fixture();
  try {
    const s = { ...(await setup(f, 1)), f },
      rid = await rate(s, 10),
      finance = await accountToken(s, ["finance"]);
    await check(
      await write(
        s,
        "settlements/submit",
        { month: "2026-11", version: 0 },
        "POST",
        finance.token,
      ),
    );
    await check(
      await write(s, "settlements/approve", { month: "2026-11", version: 1 }),
    );
    await check(
      await write(
        s,
        "rates/" + rid,
        { version: 1, effective_to: "2026-11-30" },
        "PATCH",
      ),
    );
    await check(
      await write(s, "rates", {
        teacher_id: s.teacher,
        course_type_id: s.type,
        rate: 20,
        effective_from: "2026-12-01",
        effective_to: "2026-12-31",
      }),
    );
    await check(
      await write(s, "rates/" + rid, { version: 2, rate: 11 }, "PATCH"),
      409,
    );
    await check(
      await s.call("data/teachers/" + s.teacher, "DELETE", { version: 1 }),
      409,
    );
    await check(
      await s.call("data/course_types/" + s.type, "DELETE", { version: 1 }),
      409,
    );
    assert.equal((await s.r.businessGet("teacher_rates", rid)).rate, 1000);
  } finally {
    f.restore();
  }
});
test("第四阶段补充：新课程、模板及默认值限30/45/60分钟且至少1课时，改排和SQL不能绕过", async () => {
  const f = await fixture();
  try {
    const s = { ...(await setup(f, 1)), f };
    const base = {
      teacher_id: s.teacher,
      course_type_id: s.type,
      location_id: s.room,
      duration: 45,
      units: 1,
      student_ids: s.students,
    };
    for (const invalid of [
      { duration: 15 },
      { duration: 90 },
      { units: 0.5 },
      { units: 0.9999 },
    ]) {
      await check(
        await s.call("data/lessons", "POST", {
          ...base,
          start_at: "2026-11-23T09:00",
          ...invalid,
        }),
        400,
      );
      await check(
        await s.call("data/schedule_templates", "POST", {
          ...base,
          name: "固定课",
          weekday: 1,
          start_time: "09:00",
          ...invalid,
        }),
        400,
      );
      const courseInvalid = invalid.duration
        ? { default_minutes: invalid.duration }
        : { units_per_lesson: invalid.units };
      await check(
        await s.call("data/course_types", "POST", {
          name: "新课",
          category_id: s.cat,
          ...courseInvalid,
        }),
        400,
      );
    }
    for (const [i, duration] of [30, 45, 60].entries()) {
      const created = await check(
        await s.call("data/lessons", "POST", {
          ...base,
          duration,
          units: 1.25,
          start_at: `2026-11-${23 + i}T09:00`,
        }),
      );
      const row = await details(s, created.id);
      await check(
        await s.call("data/lessons/" + created.id, "PATCH", {
          version: row.version,
          duration: 90,
        }),
        400,
      );
      await check(
        await s.call("data/lessons/" + created.id, "PATCH", {
          version: row.version,
          units: 0.5,
        }),
        400,
      );
      assert.throws(
        () =>
          f.db.raw
            .prepare("UPDATE lessons SET units=0.5 WHERE tenant_id=? AND id=?")
            .run(s.t.id, created.id),
        /course_duration_or_units/,
      );
      assert.throws(
        () =>
          f.db.raw
            .prepare(
              "UPDATE lessons SET duration=90 WHERE tenant_id=? AND id=?",
            )
            .run(s.t.id, created.id),
        /course_duration_or_units/,
      );
    }
    assert.throws(
      () =>
        f.db.raw
          .prepare(
            "UPDATE course_types SET default_minutes=90 WHERE tenant_id=? AND id=?",
          )
          .run(s.t.id, s.type),
      /course_duration_or_units/,
    );
    const template = await check(
      await s.call("data/schedule_templates", "POST", {
        ...base,
        weekday: 1,
        start_time: "09:00",
        date_from: "2026-11-01",
        date_to: "2026-11-30",
      }),
    );
    for (const bad of [{ duration: 90 }, { units: 0.5 }]) {
      await check(
        await s.call("data/schedule_templates/" + template.id, "PATCH", {
          version: 1,
          ...bad,
        }),
        400,
      );
    }
    assert.throws(
      () =>
        f.db.raw
          .prepare(
            "UPDATE schedule_templates SET units=0.5 WHERE tenant_id=? AND id=?",
          )
          .run(s.t.id, template.id),
      /course_duration_or_units/,
    );
    const course = await check(
      await s.call("data/course_types", "POST", {
        name: "30分钟课",
        category_id: s.cat,
        default_minutes: 30,
        units_per_lesson: 1.25,
      }),
    );
    for (const bad of [{ default_minutes: 90 }, { units_per_lesson: 0.5 }]) {
      await check(
        await s.call("data/course_types/" + course.id, "PATCH", {
          version: 1,
          ...bad,
        }),
        400,
      );
    }
    // Wallet quantities remain fractional: the minimum applies to each lesson, not balances.
    await pack(s, s.students[0], 1.25);
  } finally {
    f.restore();
  }
});
