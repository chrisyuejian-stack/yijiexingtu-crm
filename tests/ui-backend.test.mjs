import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { sha } from "../src/server/core.js";
import { fixture } from "./support.mjs";
import {
  setup,
  request,
  pack,
  lesson,
  status,
  accountToken,
  mutate,
  details,
} from "./fixtures-credit.mjs";
import { adminCall } from "./fixtures-admin.mjs";

function ok(response, code = 200) {
  assert.equal(response.status, code, response.text);
  assert.ok(response.queries <= 40);
  return response.body;
}
async function withSchool(run) {
  const f = await fixture();
  const RealDate = Date;
  const fixed = Date.parse("2026-11-04T20:00:00+08:00");
  globalThis.Date = class extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : [fixed]));
    }
    static now() {
      return fixed;
    }
  };
  try {
    const s = { ...(await setup(f, 2)), f };
    await run(s, f);
  } finally {
    globalThis.Date = RealDate;
    f.restore();
  }
}

test("UI B1：确认收入按消耗及回补，分位精确，锁月冻结，报表裁剪及导出", () =>
  withSchool(async (s, f) => {
    await pack(s, s.students[0], 3);
    const id = await lesson(s, "2026-11-03T14:00", [s.students[0]]);
    ok(await status(s, id, "completed"));
    const path = "c3/report?month=2026-11";
    let report = ok(await request(s, path));
    assert.equal(report.earned_amount, 100);
    assert.equal(report.tuition_amount, 0);
    assert.equal(report.profit_earned, report.profit_cash + 100);
    assert.equal(report.trend.at(-1).earned_amount, 100);
    const academic = await accountToken(s, ["academic"]);
    const projected = ok(
      await request(s, path, "GET", undefined, academic.token),
    );
    for (const k of ["earned_amount", "profit_cash", "profit_earned"])
      assert.ok(!(k in projected));
    ok(
      await mutate(s, "credits/lessons/" + id + "/undo", {
        lesson_version: (await details(s, id)).version,
      }),
    );
    assert.equal(ok(await request(s, path)).earned_amount, 0);
    ok(await status(s, id, "completed"));
    const finance = await accountToken(s, ["finance"]);
    ok(
      await mutate(
        s,
        "finance/settlements/submit",
        { month: "2026-11", version: 0 },
        "POST",
        finance.token,
      ),
    );
    ok(
      await mutate(s, "finance/settlements/approve", {
        month: "2026-11",
        version: 1,
      }),
    );
    report = ok(await request(s, path));
    assert.equal(report.earned_amount, 100);
    assert.equal(report.locked, true);
    f.db.raw
      .prepare("UPDATE packages SET unit_price=700 WHERE tenant_id=?")
      .run(s.t.id);
    assert.equal(ok(await request(s, path)).earned_amount, 100);
    const exportResponse = await s.f.request(
      "https://school.test/" +
        s.t.slug +
        "/api/export?kind=report&scope=occurred&month=2026-11",
      { headers: { Cookie: "channel_session=" + s.token } },
    );
    assert.equal(exportResponse.status, 200);
    const bytes = Buffer.from(await exportResponse.arrayBuffer());
    assert.ok(bytes.includes(Buffer.from("确认收入")));
    assert.equal(
      ok(await request(s, "logs?module=exports&action=export")).total,
      1,
    );
  }));

test("UI B2：同范围提醒落库及审计，拒绝其他学员/机构和无权账号", () =>
  withSchool(async (s, f) => {
    const id = await pack(s, s.students[0], 2);
    const other = { ...(await setup(f, 1, "b")), f };
    const foreign = await pack(other, other.students[0], 1);
    const payload = {
      student_id: s.students[0],
      course_type_id: s.type,
      package_ids: [id],
      channel: "image",
    };
    ok(
      await request(s, "renewals/remind", "POST", {
        ...payload,
        package_ids: [foreign],
      }),
      404,
    );
    ok(
      await request(s, "renewals/remind", "POST", {
        ...payload,
        student_id: s.students[1],
      }),
      404,
    );
    const learner = await accountToken(s, ["student"], s.students[0]);
    ok(
      await request(s, "renewals/remind", "POST", payload, learner.token),
      403,
    );
    const written = ok(await request(s, "renewals/remind", "POST", payload));
    assert.equal(written.sent_at, "2026-11-04T20:00:00+08:00");
    const row = ok(await request(s, "renewals")).items.find(
      (r) => r.student_id === s.students[0],
    );
    assert.equal(row.reminded_count, 1);
    assert.equal(row.last_reminded_at, written.sent_at);
    assert.equal(
      ok(await request(s, "logs?module=packages&action=remind")).total,
      1,
    );
  }));

test("UI B3：原始100人JSON导入后，续费和待办均为6个用完组", () =>
  withSchool(async (s, f) => {
    // Import requires a genuinely empty tenant.
    const { schoolFixture } = await import("./fixtures-school.mjs");
    const target = { ...(await schoolFixture(f, "real")), f };
    const raw = JSON.parse(
      await readFile(
        new URL("../dev/mock/教务模拟数据_100人.json", import.meta.url),
      ),
    );
    const tables = Object.entries(raw).filter(
      ([, rows]) => Array.isArray(rows) && rows.length,
    );
    f.env.ACCESS_MODE = "off";

    const admin = async (path, data) =>
      ok(
        await adminCall(f, "tenants/" + target.t.id + "/" + path, "POST", data),
      );
    const job = await admin("jobs", {
      kind: "legacy",
      counts: Object.fromEntries(
        tables.map(([key, rows]) => [key, rows.length]),
      ),
      settings: raw.settings,
      reason: "原始100人续费复核",
    });
    for (const [table, rows] of tables)
      for (let i = 0; i < rows.length; i += 200)
        await admin("jobs/" + job.id + "/page", {
          table,
          rows: rows.slice(i, i + 200),
        });
    assert.equal(
      (await admin("jobs/" + job.id + "/preview", {})).counts.students,
      100,
    );
    await admin("jobs/" + job.id + "/commit", {});
    await target.r.createSession(await sha(target.token), target.user, {
      ip: "fixture",
      ua: "fixture",
    });
    const renewals = ok(await request(target, "c2/renewals?group=zero"));
    assert.equal(renewals.total, 6);
    assert.deepEqual(
      renewals.items.map((r) => r.student_name).sort(),
      ["王小明", "王芷若", "卢雨桐", "武熙然", "龚俊杰", "戴熙然"].sort(),
    );
    for (const row of renewals.items)
      assert.ok(row.package_ids.length && row.balance <= 0);
    for (const filter of ["zero", "low"]) {
      const rows =
        filter === "zero"
          ? renewals
          : ok(await request(target, "c2/renewals?group=low"));
      const expected = [
        ...new Set(rows.items.map((row) => row.student_id)),
      ].sort();
      const page = ok(await request(target, "c2/students?balance=" + filter));
      assert.equal(page.total, expected.length);
      assert.deepEqual(page.items.map((row) => row.id).sort(), expected);
      const beyond = ok(
        await request(target, "c2/students?offset=50&balance=" + filter),
      );
      assert.equal(beyond.total, expected.length);
      assert.deepEqual(beyond.items, []);
    }
    const summary = ok(await request(target, "todo/summary"));
    assert.deepEqual(
      [summary.renewal_zero, summary.renewal_low, summary.renewal_expiring],
      [6, 12, 6],
    );
    assert.equal(ok(await request(target, "c2/home")).counts.renewal_zero, 6);
    const report = ok(await request(target, "c3/report?month=2026-11"));
    assert.equal(report.earned_amount, 10540);
    assert.equal(report.tuition_amount, 4000);
    if (process.env.UI_BACKEND_SAMPLE === "1") {
      const { teachers, courses, students, ...totals } = report;
      console.log(
        "UI_SAMPLE",
        JSON.stringify({
          report: totals,
          renewal: renewals.items.find((row) => row.student_name === "王小明"),
          todo: summary,
        }),
      );
    }

    assert.equal(
      report.trend.find((r) => r.month === "2026-09").earned_amount,
      null,
    );
  }));

test("UI B6：班级名单余额批量读取，出勤按班级限制，跨机构与个人范围拒绝", () =>
  withSchool(async (s, f) => {
    const cls = ok(
      await request(s, "tools/classes", "POST", {
        name: "班",
        teacher_id: s.teacher,
        course_type_id: s.type,
        location_id: s.room,
        date_from: "2026-11-01",
        date_to: "2026-12-31",
      }),
    );
    ok(
      await request(s, "tools/class_members", "POST", {
        class_id: cls.id,
        student_id: s.students[0],
      }),
    );
    await pack(s, s.students[0], 2);
    const id = await lesson(s, "2026-11-03T14:00", [s.students[0]]);
    f.db.raw
      .prepare("UPDATE lessons SET class_id=? WHERE tenant_id=? AND id=?")
      .run(cls.id, s.t.id, id);
    ok(await status(s, id, "completed"));
    await lesson(s, "2026-11-04T14:00", [s.students[0]]);
    const path = "c3/classes/" + cls.id + "/roster";
    const row = ok(await request(s, path)).items[0];
    assert.equal(row.balance, 1);
    assert.deepEqual(
      row.recent_attendance.map((x) => [x.lesson_id, x.attendance]),
      [[id, "attended"]],
    );
    const learner = await accountToken(s, ["student"], s.students[0]);
    ok(await request(s, path, "GET", undefined, learner.token), 403);
    const other = { ...(await setup(f, 1, "b")), f };
    ok(await request(other, path), 404);
  }));

test("UI B7：教师开关仅过滤对外图，默认显示，修改资料后保留课表", () =>
  withSchool(async (s) => {
    const id = await lesson(s, "2026-11-03T14:00");
    const path = "brand-timetable?from=2026-11-02&student_id=" + s.students[0];
    assert.equal(ok(await request(s, path)).items.length, 1);
    const detail = ok(await request(s, "data/teachers/" + s.teacher)).record;
    assert.equal(detail.show_in_timetable, 1);
    ok(
      await request(s, "data/teachers/" + s.teacher, "PATCH", {
        version: detail.version,
        show_in_timetable: 0,
      }),
    );
    assert.equal(ok(await request(s, path)).items.length, 0);
    assert.equal(ok(await request(s, "data/lessons/" + id)).record.id, id);
  }));

test("UI B8：日志模块与操作精确组合，导出事件可筛选，财务边界不扩大", () =>
  withSchool(async (s) => {
    await s.r.audit(
      { id: "fixture", name: "测试人" },
      "tuition",
      "export",
      null,
      "测试导出",
    );
    await s.r.audit(
      { id: "fixture", name: "测试人" },
      "students",
      "export",
      null,
      "学员导出",
    );
    assert.equal(
      ok(await request(s, "logs?module=tuition&action=export")).total,
      1,
    );
    assert.equal(
      ok(await request(s, "logs?module=tuition&action=delete")).total,
      0,
    );
    const finance = await accountToken(s, ["finance"]);
    assert.equal(
      ok(
        await request(
          s,
          "logs?module=students&action=export",
          "GET",
          undefined,
          finance.token,
        ),
      ).total,
      0,
    );
    assert.equal(
      ok(
        await request(
          s,
          "logs?module=tuition&action=export",
          "GET",
          undefined,
          finance.token,
        ),
      ).total,
      1,
    );
  }));

test("UI B2/B7：续费提醒与教师对外课表设置可从加密快照按机构恢复", () =>
  withSchool(async (s, f) => {
    const { startBackup, continueBackup } =
      await import("../src/server/backup.js");
    const pkg = await pack(s, s.students[0], 2);
    const record = ok(await request(s, "data/teachers/" + s.teacher)).record;
    ok(
      await request(s, "data/teachers/" + s.teacher, "PATCH", {
        version: record.version,
        show_in_timetable: 0,
      }),
    );
    const payload = {
      student_id: s.students[0],
      course_type_id: s.type,
      package_ids: [pkg],
      channel: "text",
    };
    ok(await request(s, "renewals/remind", "POST", payload));
    const backup = await startBackup(f.env);
    while (!(await continueBackup(f.env)).done) {}
    ok(await request(s, "renewals/remind", "POST", payload));
    const current = ok(await request(s, "data/teachers/" + s.teacher)).record;
    ok(
      await request(s, "data/teachers/" + s.teacher, "PATCH", {
        version: current.version,
        show_in_timetable: 1,
      }),
    );
    f.env.ACCESS_MODE = "off";
    const admin = async (path, data) =>
      ok(await adminCall(f, "tenants/" + s.t.id + "/" + path, "POST", data));
    const job = await admin("jobs", {
      kind: "restore",
      backup_id: backup.id,
      reason: "复核 UI 新字段备份恢复",
    });
    for (const page of job.manifest.required)
      await admin("jobs/" + job.id + "/page", page);
    await admin("jobs/" + job.id + "/commit", {});
    assert.equal(
      (await s.r.businessGet("teachers", s.teacher)).show_in_timetable,
      0,
    );
    const reminders = f.db.raw
      .prepare(
        "SELECT channel,package_ids_json FROM renewal_reminders WHERE tenant_id=?",
      )
      .all(s.t.id);
    assert.deepEqual(
      reminders.map((r) => [r.channel, JSON.parse(r.package_ids_json)]),
      [["text", [pkg]]],
    );
  }));

test("UI B3/B6：同类包合并，不混入已过期和其他作用范围的课时包", () =>
  withSchool(async (s) => {
    const type = await s.create("course_types", {
      name: "同类课程",
      category_id: s.cat,
      format: "group",
      capacity: 40,
    });
    const student_id = s.students[0];
    const make = (course_type_id, units_total, scope_kind, valid_to) =>
      mutate(s, "credits/packages", {
        student_id,
        course_type_id,
        units_total,
        scope_kind,
        purchase_date: "2026-10-01",
        valid_from: "2026-10-01",
        valid_to,
      });
    const a = ok(await make(s.type, 1, "category", "2026-12-01"));
    const b = ok(await make(type, 2, "category", "2026-12-02"));
    ok(await make(type, 5, "category", "2026-10-31"));
    ok(await make(type, 1, "type", "2026-12-01"));
    const low = ok(await request(s, "c2/students?balance=low"));
    assert.equal(low.total, 1);
    assert.equal(low.items[0].id, student_id);
    assert.equal(low.items[0].balance, 9); // Existing overall balance and sorting field remain unchanged.
    const zero = ok(await request(s, "c2/students?balance=zero"));
    assert.equal(zero.total, 0); // The second student has no packages.
    const detail = ok(await request(s, "c2/students/" + student_id));
    const group = detail.renewal_groups.find(
      (row) => row.scope_kind === "category",
    );
    assert.equal(group.balance, 3);
    assert.equal(group.state, "low");
    assert.deepEqual(group.package_ids.sort(), [a.id, b.id].sort());
    const receipts = ok(
      await request(s, "c3/receipts?student_id=" + student_id),
    );
    assert.deepEqual(receipts.renewal_groups, detail.renewal_groups);
  }));

test("UI 待补课近30天：保留全量计数，按北京时间零点截断且纳入未来课程", () =>
  withSchool(async (s, f) => {
    const older = await lesson(s, "2026-10-04T14:00", [s.students[0]]);
    const recent = await lesson(s, "2026-11-01T14:00", [s.students[0]]);
    for (const id of [older, recent]) ok(await status(s, id, "student_leave"));
    const summary = async () => {
      const { makeup_pending, makeup_recent } = ok(
        await request(s, "todo/summary"),
      );
      return [makeup_pending, makeup_recent];
    };
    assert.deepEqual(await summary(), [2, 1]);
    const move = f.db.raw.prepare(
      "UPDATE lessons SET start_at=? WHERE tenant_id=? AND id=?",
    );
    move.run("2026-10-04T23:59:00+08:00", s.t.id, older);
    assert.deepEqual(await summary(), [2, 1]);
    move.run("2026-10-05T00:00:00+08:00", s.t.id, older);
    assert.deepEqual(await summary(), [2, 2]);
    move.run("2026-11-07T14:00:00+08:00", s.t.id, older);
    assert.deepEqual(await summary(), [2, 2]);
  }));

test("UI B8：登录日志支持主管按人和日期筛选，财务仍返回空列表", () =>
  withSchool(async (s) => {
    await s.r.authEvent(s.user.id, "2222", "login_success", {
      ip: "192.0.2.1",
      ua: "登录日志回归测试",
    });
    for (const filter of [
      "",
      "&actor=" + encodeURIComponent("主管"),
      "&from=2026-11-04&to=2026-11-04",
    ]) {
      const page = ok(await request(s, "logs?kind=login" + filter));
      assert.equal(page.total, 1);
      assert.equal(page.items[0]?.event, "login_success");
      assert.equal(page.items[0]?.user_id, s.user.id);
    }
    const finance = await accountToken(s, ["finance"]);
    const page = ok(
      await request(s, "logs?kind=login", "GET", undefined, finance.token),
    );
    assert.deepEqual(page, { items: [], total: 0, next_offset: null });
  }));
