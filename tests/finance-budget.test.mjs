import { effectivePolicies } from "../src/server/absence.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fixture } from "./support.mjs";
import { setup, request, mutate, accountToken } from "./fixtures-credit.mjs";
import { randomId } from "../src/server/core.js";
test("第四阶段查询预算：30教师、30人班课、900参与记录，所有新财务接口≤40", async () => {
  const f = await fixture();
  try {
    const s = { ...(await setup(f, 30)), f },
      changes = [];
    for (let i = 0; i < 30; i++) {
      const teacher = randomId("tea"),
        id = randomId("lesson");
      changes.push({
        resource: "teachers",
        data: {
          id: teacher,
          name: "预算教师" + i,
          subjects: "[]",
          employment: "part_time",
          status: "active",
          sort_order: i,
          deleted_at: null,
        },
      });
      changes.push({
        resource: "lessons",
        data: {
          id,
          start_at: "2026-11-10T09:00+08:00",
          duration: 45,
          units: 1,
          teacher_id: teacher,
          assistant_id: null,
          course_type_id: s.type,
          location_id: s.room,
          mode: "offline",
          status: "completed",
          format: "group",
          template_id: null,
          occurrence_date: null,
          note: "",
          deleted_at: null,
        },
      });
      for (const student of s.students)
        changes.push({
          resource: "lesson_participants",
          data: {
            id: randomId("part"),
            lesson_id: id,
            student_id: student,
            attendance: "attended",
            deducted: 1,
            package_id: null,
            makeup_for: null,
            deleted_at: null,
          },
        });
      changes.push({
        resource: "teacher_rates",
        data: {
          id: randomId("rate"),
          teacher_id: teacher,
          course_type_id: s.type,
          format: "group",
          rate_basis: "legacy",
          rate: 10000,
          effective_from: "2026-01-01",
          effective_to: "2026-12-31",
          deleted_at: null,
        },
      });
    }
    await s.r.commitBusiness(
      await s.r.dataVersion(),
      changes,
      { id: s.user.id, name: "主管" },
      "teacher_pay",
      "fixture",
    );
    const results = [];
    const call = async (name, path, method = "GET", data, token = s.token) => {
      const res = await request(
        s,
        path,
        method,
        data === undefined
          ? undefined
          : { operation_id: randomId("op"), ...data },
        token,
      );
      assert.equal(res.status, 200, name + " " + res.text);
      assert.ok(res.queries <= 40);
      results.push({
        name,
        path,
        method,
        queries: res.queries,
        statements: res.statements,
      });
      return res.body;
    };
    await call("读取统一默认缺勤规则", "absence-policies");
    await call("保存缺勤规则（含并发版本触发器）", "absence-policies", "PUT", {
      policies: effectivePolicies({}),
    });
    const inputs = {
      rates: {
        teacher_id: s.teacher,
        course_type_id: s.type,
        rate_basis: "legacy",
        rate: 80,
        effective_from: "2026-01-01",
        effective_to: "2026-12-31",
      },
      payments: {
        teacher_id: s.teacher,
        month: "2026-11",
        amount: 50,
        paid_at: "2026-11-02",
      },
      adjustments: {
        teacher_id: s.teacher,
        month: "2026-11",
        amount: -1,
        reason: "核对",
      },
      costs: { date: "2026-11-02", category: "预算", amount: 10 },
    };
    for (const [kind, data] of Object.entries(inputs)) {
      const made = await call("新增 " + kind, "finance/" + kind, "POST", data);
      await call("列表 " + kind, "finance/" + kind);
      await call("详情 " + kind, "finance/" + kind + "/" + made.id);
      await call("修改 " + kind, "finance/" + kind + "/" + made.id, "PATCH", {
        ...data,
        version: 1,
      });
      await call("删除 " + kind, "finance/" + kind + "/" + made.id, "DELETE", {
        version: 2,
      });
    }
    await call("月度课酬", "finance/payroll?month=2026-11");
    await call("月度报表", "finance/report?month=2026-11");
    await call("结算状态", "finance/settlement?month=2026-11");
    const first = changes.find((c) => c.resource === "lessons").data;
    await call(
      "单课课酬覆盖",
      "finance/lessons/" + first.id + "/rate",
      "POST",
      { version: 1, override_rate: 90 },
    );
    const pay = await call("缴费登记", "credits/payments", "POST", {
      student_id: s.students[0],
      amount: 0.3,
      paid_at: "2026-11-02",
    });
    await call("缴费修改", "finance/tuition/" + pay.id, "PATCH", {
      version: 1,
      amount: 0.4,
    });
    await call("缴费删除", "finance/tuition/" + pay.id, "DELETE", {
      version: 2,
    });
    const finance = await accountToken(s, ["finance"]);
    await call(
      "财务提交",
      "finance/settlements/submit",
      "POST",
      { month: "2026-11", version: 0 },
      finance.token,
    );
    await call("主管退回", "finance/settlements/reject", "POST", {
      month: "2026-11",
      version: 1,
      reason: "复核后重提",
    });
    await call(
      "重新提交",
      "finance/settlements/submit",
      "POST",
      { month: "2026-11", version: 2 },
      finance.token,
    );
    await call("主管批准900参与记录", "finance/settlements/approve", "POST", {
      month: "2026-11",
      version: 3,
    });
    await call("已锁定月度课酬", "finance/payroll?month=2026-11");
    await call("主管解锁", "finance/settlements/unlock", "POST", {
      month: "2026-11",
      version: 4,
      reason: "修订依据",
    });
    for (const kind of ["lessons", "packages", "finance", "report", "logs"]) {
      const res = await f.request(
        "https://school.test/" +
          s.t.slug +
          "/api/export?kind=" +
          kind +
          "&month=2026-11",
        { headers: { Cookie: "channel_session=" + s.token } },
      );
      assert.equal(res.status, 200, await res.clone().text());
      const queries = Number(res.headers.get("x-test-d1-queries"));
      assert.ok(queries <= 40);
      results.push({
        name: "Excel导出 " + kind,
        path: "export?kind=" + kind,
        method: "GET",
        queries,
        statements: Number(res.headers.get("x-test-d1-statements")),
      });
    }
    const report = {
      budget: 40,
      scale: "30教师 × 30人班课（900参与记录）",
      build:
        process.env.TEST_BUNDLE === "1"
          ? "dist/_worker.js"
          : "src/server/worker.js",
      max: Math.max(...results.map((r) => r.queries)),
      results,
    };
    await mkdir("work/reports", { recursive: true });
    await writeFile(
      "work/reports/finance-budget" +
        (process.env.TEST_BUNDLE === "1" ? "-bundle" : "") +
        ".json",
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report));
  } finally {
    f.restore();
  }
});
