import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { fixture } from "./support.mjs";
import {
  setup,
  pack,
  lesson,
  status,
  details,
  accountToken,
  request,
  mutate,
  balance,
} from "./fixtures-credit.mjs";
import {
  effectivePolicies,
  DEFAULT_ABSENCE_POLICIES,
} from "../src/server/absence.js";
import { legacyFinanceOracle } from "./fixtures-legacy-finance.mjs";
const sqlFile = (name) =>
  readFile(new URL("../scripts/sql/" + name, import.meta.url), "utf8");
async function ok(result, code = 200) {
  assert.equal(result.status, code, result.text);
  return result.body;
}
const write = (s, path, data, token = s.token, method = "POST") =>
  mutate(s, "finance/" + path, data, method, token);
async function prepared(f) {
  const s = { ...(await setup(f, 1)), f };
  await pack(s);
  s.lid = await lesson(s);
  await status(s, s.lid, "completed");
  s.rid = (
    await ok(
      await write(s, "rates", {
        teacher_id: s.teacher,
        course_type_id: s.type,
        format: "group",
        rate: 200,
        rate_basis: "legacy",
        effective_from: "2026-01-01",
        effective_to: "2026-12-31",
      }),
    )
  ).id;
  s.finance = await accountToken(s, ["finance"]);
  return s;
}
async function submit(s, version = 0) {
  return ok(
    await write(
      s,
      "settlements/submit",
      { month: "2026-11", version },
      s.finance.token,
    ),
  );
}
const approvalBudgets = [];
async function approve(s, version = 1, code = 200) {
  const res = await write(s, "settlements/approve", {
    month: "2026-11",
    version,
  });
  approvalBudgets.push({
    path: "finance/settlements/approve",
    method: "POST",
    status: res.status,
    queries: res.queries,
    statements: res.statements,
  });
  assert.ok(res.queries <= 40);
  return ok(res, code);
}
test("第四阶段复核 P1：其他月份成本/课程、学员档案与本月课酬付款不阻断批准", async () => {
  const f = await fixture();
  try {
    const s = await prepared(f);
    await submit(s);
    await ok(
      await write(s, "costs", {
        date: "2026-12-15",
        category: "其他月",
        amount: 12.34,
      }),
    );
    await lesson(s, "2026-12-15T09:00");
    const student = await s.r.businessGet("students", s.students[0]);
    await ok(
      await s.call("data/students/" + student.id, "PATCH", {
        version: student.version,
        name: "修改档案姓名",
      }),
    );
    await ok(
      await write(s, "payments", {
        teacher_id: s.teacher,
        month: "2026-11",
        amount: 20,
        paid_at: "2026-11-15",
      }),
    );
    await approve(s);
    const payroll = await ok(await request(s, "finance/payroll?month=2026-11"));
    assert.equal(payroll.items[0].total_amount, 200);
    assert.equal(payroll.items[0].paid_amount, 20);
  } finally {
    f.restore();
  }
});
test("第四阶段复核 P1：本月出勤/标准/成本/课程/调整/学费变化均使指纹失效", async (t) => {
  // Keep the added Nov 15 lesson in the future so fingerprint checks run before pending-lesson validation.
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-14T12:00:00+08:00") });
  for (const change of [
    "attendance",
    "rate",
    "cost",
    "lesson",
    "adjustment",
    "tuition",
  ]) {
    const f = await fixture();
    try {
      const s = await prepared(f);
      await submit(s);
      if (change === "attendance") await status(s, s.lid, "student_no_show");
      if (change === "rate")
        await ok(
          await write(
            s,
            "rates/" + s.rid,
            { version: 1, rate: 201 },
            s.token,
            "PATCH",
          ),
        );
      if (change === "cost")
        await ok(
          await write(s, "costs", {
            date: "2026-11-15",
            category: "本月",
            amount: 1,
          }),
        );
      if (change === "lesson") await lesson(s, "2026-11-15T09:00");
      if (change === "adjustment")
        await ok(
          await write(s, "adjustments", {
            teacher_id: s.teacher,
            month: "2026-11",
            amount: 1,
            reason: "复核",
          }),
        );
      if (change === "tuition")
        await ok(
          await mutate(s, "credits/payments", {
            student_id: s.students[0],
            amount: 1,
            paid_at: "2026-11-15",
          }),
        );
      const denied = await approve(s, 1, 409);
      assert.match(denied.error, /本月结算数据已变更/);
      assert.equal(
        f.db.raw.prepare("SELECT COUNT(*) n FROM payroll_snapshots").get().n,
        0,
      );
    } finally {
      f.restore();
    }
  }
});
test("第四阶段复核 P1：缺勤规则变化拒批，保存等价默认规则不误拦", async () => {
  for (const changed of [true, false]) {
    const f = await fixture();
    try {
      const s = await prepared(f);
      await submit(s);
      const policies = effectivePolicies({});
      policies.student_no_show.teacherPaid = !changed;
      await ok(await request(s, "absence-policies", "PUT", { policies }));
      await approve(s, 1, changed ? 409 : 200);
    } finally {
      f.restore();
    }
  }
});
test("第四阶段复核 P1：指纹校验后到 batch 提交前改本月成本或缺勤规则不能穿透；其他月并发可重试", async () => {
  for (const change of ["cost", "policies", "other_month"]) {
    const f = await fixture();
    try {
      const s = await prepared(f);
      const cost = (
        await ok(
          await write(s, "costs", {
            date: change === "other_month" ? "2026-12-15" : "2026-11-15",
            category: "竞态",
            amount: 1,
          }),
        )
      ).id;
      await ok(
        await request(s, "absence-policies", "PUT", {
          policies: effectivePolicies({}),
        }),
      );
      await submit(s);
      const original = f.db.batch.bind(f.db);
      let injected = false;
      f.db.batch = async (statements) => {
        if (
          !injected &&
          statements.some((q) =>
            q.query.includes("INSERT INTO mutation_guards"),
          )
        ) {
          injected = true;
          if (change === "policies") {
            const policies = effectivePolicies({});
            policies.student_no_show.teacherPaid = false;
            f.db.raw
              .prepare(
                "UPDATE tenant_settings SET value=? WHERE tenant_id=? AND id='absence_policies'",
              )
              .run(JSON.stringify(policies), s.t.id);
          } else {
            f.db.raw
              .prepare(
                "UPDATE other_costs SET amount=200 WHERE tenant_id=? AND id=?",
              )
              .run(s.t.id, cost);
            f.db.raw
              .prepare(
                "UPDATE tenant_data_versions SET version=version+1 WHERE tenant_id=?",
              )
              .run(s.t.id);
          }
        }
        return original(statements);
      };
      await approve(s, 1, change === "other_month" ? 200 : 409);
      assert.equal(injected, true);
      assert.equal(
        f.db.raw.prepare("SELECT COUNT(*) n FROM payroll_snapshots").get().n,
        change === "other_month" ? 1 : 0,
      );
    } finally {
      f.restore();
    }
  }
});
test("第四阶段复核 P2：未保存及部分缺失规则逐项回落，GET/扣课/teacher_paid/课酬一致；锁定历史不静默改写", async () => {
  const f = await fixture();
  try {
    const s = await prepared(f);
    assert.equal(
      f.db.raw
        .prepare(
          "SELECT COUNT(*) n FROM tenant_settings WHERE id='absence_policies'",
        )
        .get().n,
      0,
    );
    const shown = (await ok(await request(s, "absence-policies"))).policies;
    assert.deepEqual(shown, DEFAULT_ABSENCE_POLICIES);
    const second = await lesson(s, "2026-11-11T09:00");
    await status(s, second, "student_no_show");
    assert.equal((await s.r.businessGet("lessons", second)).teacher_paid, 1);
    assert.equal(
      await balance(s, (await request(s, "credits/packages")).body.items[0].id),
      8,
    );
    assert.equal(
      (await ok(await request(s, "finance/payroll?month=2026-11"))).items[0]
        .accrued_amount,
      400,
    );
    await s.r.saveSetting(
      "absence_policies",
      { student_leave: { deduct: true } },
      s.user,
    );
    const partial = (await ok(await request(s, "absence-policies"))).policies;
    assert.equal(partial.student_leave.deduct, true);
    assert.equal(partial.student_leave.teacherPaid, false);
    assert.deepEqual(partial.student_no_show, shown.student_no_show);
    assert.deepEqual(
      effectivePolicies({
        absence_policies: { student_no_show: { deduct: false } },
      }).student_no_show,
      { deduct: false, teacherPaid: true },
    );
    assert.equal(
      (await ok(await request(s, "finance/payroll?month=2026-11"))).items[0]
        .accrued_amount,
      400,
    );
    // Original final teacherCost with a completely absent policy pays completed only.
    const old = {
      settings: {},
      settlements: [],
      teacherRates: [
        { teacherId: "t", courseTypeId: "c", format: "group", rate: 200 },
      ],
    };
    const oracle = legacyFinanceOracle(old, {});
    assert.equal(
      oracle.teacherCost({
        teacherId: "t",
        courseTypeId: "c",
        format: "group",
        units: 1,
        start: "2026-11-10",
        status: "completed",
      }) +
        oracle.teacherCost({
          teacherId: "t",
          courseTypeId: "c",
          format: "group",
          units: 1,
          start: "2026-11-11",
          status: "student_no_show",
        }),
      200,
    );
    await submit(s);
    await approve(s);
    f.db.raw
      .prepare("UPDATE lessons SET teacher_paid=0 WHERE tenant_id=? AND id=?")
      .run(s.t.id, second);
    const rows = f.db.raw
      .prepare(await sqlFile("teacher_paid_audit.sql"))
      .all();
    assert.ok(
      rows.some(
        (r) =>
          r.id === second &&
          r.teacher_paid === 0 &&
          r.expected_teacher_paid === 1 &&
          r.locked === 1,
      ),
    );
    assert.equal(
      (await ok(await request(s, "finance/payroll?month=2026-11"))).items[0]
        .accrued_amount,
      400,
    );
    assert.equal(
      f.db.raw
        .prepare("SELECT teacher_paid FROM lessons WHERE tenant_id=? AND id=?")
        .get(s.t.id, second).teacher_paid,
      0,
    ); // Read operations never rewrite history.
  } finally {
    f.restore();
  }
});
async function oldMoneyDb() {
  const db = new DatabaseSync(":memory:");
  for (const file of [
    "0001_foundation.sql",
    "0003_scheduling.sql",
    "0004_credits.sql",
  ])
    db.exec(
      await readFile(new URL("../migrations/" + file, import.meta.url), "utf8"),
    );
  db.exec(
    "INSERT INTO tenants(id,slug,name,type,city,status,staff_seat_limit,student_seat_limit,created_at,created_by,updated_at,updated_by) VALUES('t','t','测试','其他','','active',10,100,1,'a',1,'a'); INSERT INTO students(tenant_id,id,name,created_at,created_by,updated_at,updated_by) VALUES('t','s','学员',1,'a',1,'a'); INSERT INTO course_categories(tenant_id,id,name,created_at,created_by,updated_at,updated_by) VALUES('t','c','课程',1,'a',1,'a');INSERT INTO course_types(tenant_id,id,name,category_id,created_at,created_by,updated_at,updated_by) VALUES('t','type','课程','c',1,'a',1,'a');INSERT INTO packages(tenant_id,id,student_id,course_type_id,unit_price,amount,created_at,created_by,updated_at,updated_by) VALUES('t','p','s','type',0.1,0.1+0.2,1,'a',1,'a');INSERT INTO student_payments(tenant_id,id,student_id,amount,paid_at,created_at,created_by,updated_at,updated_by) VALUES('t','pay','s',0.1+0.2,'2026-11-02',1,'a',1,'a')",
  );
  return db;
}
test("第四阶段复核 P3：迁移预检检出负数与三位小数；只读识别未迁移/已迁移/半迁移", async () => {
  const precheck = (await sqlFile("0005_money_precheck.sql"))
    .split(";")
    .filter((s) => s.trim());
  const state = await sqlFile("0005_money_state.sql");
  for (const [table, field, value] of [
    ["student_payments", "amount", -100],
    ["student_payments", "amount", 12.345],
    ["packages", "unit_price", -1],
    ["packages", "unit_price", 12.345],
    ["packages", "amount", -100],
    ["packages", "amount", 12.345],
  ]) {
    const db = await oldMoneyDb();
    try {
      assert.equal(db.prepare(state).get().migration_state, "未迁移");
      assert.deepEqual(
        precheck.map((q) => Object.values(db.prepare(q).get())[0]),
        [0, 0],
      );
      db.prepare(`UPDATE ${table} SET ${field}=?`).run(value);
      const before = db.prepare("SELECT total_changes() n").get().n;
      const counts = precheck.map((q) => Object.values(db.prepare(q).get())[0]);
      assert.deepEqual(counts, table === "packages" ? [0, 1] : [1, 0]);
      const details = (await sqlFile("0005_money_details.sql"))
        .split(";")
        .filter((q) => q.trim())
        .flatMap((q) => db.prepare(q).all());
      assert.equal(details.length, 1);
      assert.equal(db.prepare("SELECT total_changes() n").get().n, before);
    } finally {
      db.close();
    }
  }
  const clean = await oldMoneyDb();
  try {
    clean.exec(
      await readFile(
        new URL("../migrations/0005_integer_money.sql", import.meta.url),
        "utf8",
      ),
    );
    assert.equal(clean.prepare(state).get().migration_state, "已迁移");
  } finally {
    clean.close();
  }
  const broken = await oldMoneyDb();
  try {
    broken.exec("UPDATE student_payments SET amount=-100");
    assert.throws(() => broken.exec(awaitedMigration), /CHECK constraint/);
    assert.match(broken.prepare(state).get().migration_state, /半迁移/);
  } finally {
    broken.close();
  }
});
const awaitedMigration = await readFile(
  new URL("../migrations/0005_integer_money.sql", import.meta.url),
  "utf8",
);
function zipXml(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    result = {};
  let at = 0;
  while (view.getUint32(at, true) === 0x04034b50) {
    const len = view.getUint32(at + 18, true),
      n = view.getUint16(at + 26, true),
      extra = view.getUint16(at + 28, true),
      start = at + 30 + n + extra;
    result[new TextDecoder().decode(bytes.slice(at + 30, at + 30 + n))] =
      new TextDecoder().decode(bytes.slice(start, start + len));
    at = start + len;
  }
  return result;
}
async function excel(s, kind) {
  const res = await s.f.request(
    "https://school.test/" +
      s.t.slug +
      "/api/export?kind=" +
      kind +
      "&month=2026-11",
    { headers: { Cookie: "channel_session=" + s.token } },
  );
  assert.equal(res.status, 200);
  assert.ok(Number(res.headers.get("x-test-d1-queries")) <= 40);
  const bytes = new Uint8Array(await res.arrayBuffer());
  await mkdir("work/reports", { recursive: true });
  await writeFile("work/reports/stage4-review-" + kind + ".xlsx", bytes);
  return zipXml(bytes);
}
test("第四阶段复核 Excel：状态/维度中文、调整付款教师姓名、日志北京时间、所有金额数字类型两位小数", async (t) => {
  // The planned Nov 12 row below tests export labels, not overdue checkout.
  // Keep it in the future so settlement validation is independent of wall time.
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-10T12:00:00+08:00") });
  const f = await fixture();
  try {
    const s = await prepared(f);
    await ok(
      await s.call("data/teachers/" + s.teacher, "PATCH", {
        version: 1,
        name: "课酬回归教师甲",
      }),
    );
    await ok(
      await write(s, "adjustments", {
        teacher_id: s.teacher,
        month: "2026-11",
        amount: -3.5,
        reason: "回归调整",
      }),
    );
    await ok(
      await write(s, "payments", {
        teacher_id: s.teacher,
        month: "2026-11",
        amount: 77.5,
        paid_at: "2026-11-15",
        note: "回归付款",
      }),
    );
    await ok(
      await write(s, "costs", {
        date: "2026-11-15",
        category: "回归成本",
        amount: 2.5,
      }),
    );
    await ok(
      await mutate(s, "credits/payments", {
        student_id: s.students[0],
        amount: 1234.5,
        paid_at: "2026-11-15",
      }),
    );
    const pay = await excel(s, "finance"),
      xml = pay["xl/worksheets/sheet1.xml"];
    assert.ok(xml.includes("未确认"));
    assert.ok(!xml.includes("unconfirmed"));
    assert.ok(!xml.includes("教师ID"));
    for (const heading of ["课酬调整", "课酬付款"]) {
      const section = xml.split(heading)[1];
      assert.ok(section.includes(">课酬回归教师甲<"));
      assert.ok(!section.includes(s.teacher));
    }
    assert.match(xml, /<c r="[A-Z]+\d+" s="1"><v>1234\.5<\/v><\/c>/);
    assert.match(xml, /<c r="[A-Z]+\d+" s="1"><v>-3\.5<\/v><\/c>/);
    assert.match(
      pay["xl/styles.xml"],
      /numFmtId="2"[^>]*applyNumberFormat="1"/,
    );
    assert.ok(pay["[Content_Types].xml"].includes("/xl/styles.xml"));
    assert.ok(
      pay["xl/_rels/workbook.xml.rels"].includes("relationships/styles"),
    );
    const packXml = (await excel(s, "packages"))["xl/worksheets/sheet1.xml"];
    assert.match(packXml, /<c r="E\d+" s="1"><v>100<\/v><\/c>/);
    const report = (await excel(s, "report"))["xl/worksheets/sheet1.xml"];
    for (const name of ["教师", "课程", "学员"])
      assert.ok(report.includes(">" + name + "<"));
    assert.ok(!/>(teachers|courses|students)</.test(report));
    assert.match(report, /s="1"><v>/);
    for (const [i, code] of [
      "planned",
      "student_no_show",
      "student_leave",
      "teacher_leave",
      "cancelled",
      "rescheduled",
    ].entries()) {
      const id = await lesson(s, `2026-11-${12 + i}T09:00`);
      f.db.raw
        .prepare("UPDATE lessons SET status=? WHERE tenant_id=? AND id=?")
        .run(code, s.t.id, id);
    }
    const lessons = (await excel(s, "lessons"))["xl/worksheets/sheet1.xml"];
    for (const name of [
      "已销课",
      "待上课",
      "学员旷课",
      "学员请假",
      "教师请假",
      "机构取消",
      "已调课",
    ])
      assert.ok(lessons.includes(name));
    assert.ok(
      !/>(completed|planned|student_no_show|student_leave|teacher_leave|cancelled|rescheduled)</.test(
        lessons,
      ),
    );
    const log = await s.r.logs("audit", 0, false),
      entry = log[0];
    const expected = new Date(entry.at + 8 * 3600000)
      .toISOString()
      .slice(0, 19)
      .replace("T", " ");
    const logs = (await excel(s, "logs"))["xl/worksheets/sheet1.xml"];
    assert.ok(logs.includes(expected));
    assert.ok(!/\d{2}:\d{2}:\d{2}\.\d{3}Z/.test(logs));
    await submit(s);
    await approve(s);
    assert.ok(
      (await excel(s, "finance"))["xl/worksheets/sheet1.xml"].includes(
        "已确认",
      ),
    );
  } finally {
    f.restore();
  }
});

test("第四阶段复核查询预算：批准成功/指纹拒绝/并发重试均≤40", async () => {
  assert.ok(approvalBudgets.length >= 10);
  await mkdir("work/reports", { recursive: true });
  await writeFile(
    "work/reports/stage4-review-budget" +
      (process.env.TEST_BUNDLE === "1" ? "-bundle" : "") +
      ".json",
    JSON.stringify(
      {
        budget: 40,
        max: Math.max(...approvalBudgets.map((r) => r.queries)),
        results: approvalBudgets,
      },
      null,
      2,
    ),
  );
});
