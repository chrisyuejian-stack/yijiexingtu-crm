import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./support.mjs";
import {
  setup,
  request,
  pack,
  lesson,
  mutate,
  status,
  accountToken,
} from "./fixtures-credit.mjs";
import { schoolFixture } from "./fixtures-school.mjs";
import { repo } from "../src/server/repo.js";
import { b64, bytes, sha, now } from "../src/server/core.js";
import { occurredReport } from "../src/server/finance.js";
import { effectivePolicies } from "../src/server/absence.js";
const ok = (r) => {
  assert.equal(r.status, 200, r.text);
  return r.body;
};
async function teacherToken(s, id) {
  const r = await s.call("accounts", "POST", {
    name: "教师验收",
    phone: "138" + String(Math.floor(Math.random() * 1e8)).padStart(8, "0"),
    roles: ["teacher"],
    teacher_id: id,
  });
  assert.equal(r.status, 201, r.text);
  s.f.db.raw
    .prepare("UPDATE users SET must_change=0 WHERE tenant_id=? AND id=?")
    .run(s.t.id, r.body.id);
  const token = b64(bytes(32));
  await s.r.createSession(await sha(token), await s.r.user(r.body.id), {
    ip: "c3",
    ua: "c3",
  });
  return token;
}
const maximum = (f) =>
  assert.ok(
    f.db.queryReports.every((r) => r.queries <= 40),
    JSON.stringify(f.db.queryReports.filter((r) => r.queries > 40)),
  );
test("C3教师余额：未保存默认无余额；仅当前主讲本人课程；历史/助教不返回，关闭或模块停用不能注入授权", async () => {
  const f = await fixture();
  try {
    const s = { ...(await setup(f, 2)), f };
    await pack(s, s.students[0], 5);
    await pack(s, s.students[1], 6);
    const second = await s.create("teachers", { name: "其他教师" });
    const futureLesson = await lesson(s, "2098-11-01T14:00");
    const past = await lesson(s, "2020-11-01T14:00");
    const d = ok(await request(s, "data/lessons/" + past)).record;
    ok(
      await request(s, "data/lessons/" + past, "PATCH", {
        version: d.version,
        teacher_id: second,
        assistant_id: s.teacher,
        participants: [{ student_id: s.students[1] }],
      }),
    );
    const token = await teacherToken(s, s.teacher);
    let rows = ok(
      await request(s, "c3/teacher-students", "GET", undefined, token),
    ).items;
    assert.equal(
      rows.some((r) => "balance" in r),
      false,
    );
    ok(
      await request(s, "settings", "PUT", {
        key: "teacher_view_student_balance",
        value: true,
      }),
    );
    rows = ok(
      await request(s, "c3/teacher-students", "GET", undefined, token),
    ).items;
    assert.equal(
      ok(await request(s, "schedule-next", "GET", undefined, token)).record
        .participants_summary.count,
      2,
    );
    assert.equal(rows.find((r) => r.student_id === s.students[0]).balance, 5);
    assert.equal(rows.find((r) => r.student_id === s.students[1]).balance, 6); // both enrolled in future main class
    const otherType = await s.create("course_types", {
      name: "其他课程",
      category_id: s.cat,
      format: "group",
      capacity: 40,
    });
    await pack(s, s.students[0], 9, otherType);
    await s.create("lessons", {
      start_at: "2098-11-02T18:00",
      teacher_id: second,
      assistant_id: s.teacher,
      course_type_id: otherType,
      location_id: s.room,
      duration: 45,
      units: 1,
      student_ids: [s.students[0]],
    });
    rows = ok(
      await request(s, "c3/teacher-students", "GET", undefined, token),
    ).items;
    assert.equal(
      rows.find(
        (r) => r.student_id === s.students[0] && r.course_name === "班课",
      ).balance,
      5,
    );
    assert.equal(
      "balance" in
        rows.find(
          (r) => r.student_id === s.students[0] && r.course_name === "其他课程",
        ),
      false,
    );
    const future = f.db.raw
      .prepare("SELECT id,version FROM lessons WHERE tenant_id=? AND id=?")
      .get(s.t.id, futureLesson);
    ok(
      await request(s, "data/lessons/" + future.id, "PATCH", {
        version: future.version,
        teacher_id: second,
        assistant_id: s.teacher,
      }),
    );
    rows = ok(
      await request(s, "c3/teacher-students", "GET", undefined, token),
    ).items;
    assert.equal(
      rows.some((r) => "balance" in r),
      false,
    );
    assert.ok(
      !JSON.stringify(rows).match(/amount|price|phone|parent_name|category_id/),
    );
    const enrolled = await s.create("students", { name: "仅固定排课关联" });
    await pack(s, enrolled, 7);
    const template = await s.create("schedule_templates", {
      teacher_id: s.teacher,
      course_type_id: s.type,
      location_id: s.room,
      weekday: 0,
      start_time: "10:00",
      duration: 45,
      units: 1,
      date_from: "2098-01-01",
      date_to: "2098-12-31",
    });
    await s.create("schedule_enrollments", {
      template_id: template,
      student_id: enrolled,
      date_from: "2098-01-01",
      date_to: "2098-12-31",
    });
    rows = ok(
      await request(s, "c3/teacher-students", "GET", undefined, token),
    ).items;
    assert.equal(rows.find((r) => r.student_id === enrolled).balance, 7);
    ok(
      await request(s, "data/schedule_templates/" + template, "PATCH", {
        version: 1,
        active: false,
      }),
    );
    rows = ok(
      await request(s, "c3/teacher-students", "GET", undefined, token),
    ).items;
    assert.equal(
      rows.some((r) => r.student_id === enrolled),
      false,
    );

    ok(
      await request(s, "settings", "PUT", {
        key: "teacher_view_student_balance",
        value: false,
      }),
    );
    assert.equal(
      ok(
        await request(s, "c3/teacher-students", "GET", undefined, token),
      ).items.some((r) => "balance" in r),
      false,
    );
    maximum(f);
  } finally {
    f.restore();
  }
});
test("C3个人隔离：教师历史只含本人参与课程，跨机构/无关联学生404；学员点评仅公共与本人，员工专用403", async () => {
  const f = await fixture();
  try {
    const s = { ...(await setup(f, 2)), f },
      other = await schoolFixture(f, "c3-other");
    const id = await lesson(s, "2020-11-01T14:00"),
      teacher = await teacherToken(s, s.teacher),
      student = (await accountToken(s, ["student"], s.students[0])).token;
    const unrelated = await s.create("students", { name: "无关学生" });
    assert.equal(
      (
        await request(
          s,
          "c3/teacher-students/" + unrelated,
          "GET",
          undefined,
          teacher,
        )
      ).status,
      404,
    );
    const foreign = ok(
      await other.call("data/students", "POST", { name: "其他机构学生" }),
    ).id;
    assert.equal(
      (
        await request(
          s,
          "c3/teacher-students/" + foreign,
          "GET",
          undefined,
          teacher,
        )
      ).status,
      404,
    );
    const history = ok(
      await request(
        s,
        "c3/teacher-students/" + s.students[0],
        "GET",
        undefined,
        teacher,
      ),
    );
    assert.equal(history.items.length, 1);
    assert.equal(history.items[0].id, id);
    for (const [cid, sid, text] of [
      ["pub", null, "全班公开"],
      ["own", s.students[0], "本人秘密"],
      ["peer", s.students[1], "同学秘密"],
    ])
      f.db.raw
        .prepare(
          "INSERT INTO lesson_comments(tenant_id,id,lesson_id,student_id,text,published_by,created_at,created_by,updated_at,updated_by) VALUES(?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          s.t.id,
          cid,
          id,
          sid,
          text,
          s.user.id,
          now(),
          s.user.id,
          now(),
          s.user.id,
        );
    const comments = ok(
      await request(s, "c3/student-comments", "GET", undefined, student),
    );
    assert.ok(JSON.stringify(comments).includes("全班公开"));
    assert.ok(JSON.stringify(comments).includes("本人秘密"));
    assert.equal(JSON.stringify(comments).includes("同学秘密"), false);
    f.db.raw
      .prepare(
        "UPDATE tenant_modules SET enabled=0 WHERE tenant_id=? AND id='comments'",
      )
      .run(s.t.id);
    const hiddenComments = ok(
      await request(s, "c3/teacher-students", "GET", undefined, teacher),
    );
    assert.ok(hiddenComments.items.every((x) => !("last_comment" in x)));
    assert.equal(
      (await request(s, "c3/student-comments", "GET", undefined, student))
        .status,
      403,
    );

    for (const token of [teacher, student])
      for (const path of [
        "c3/report?month=2026-11",
        "c3/teachers",
        "c3/leads-summary",
        "c3/receipts",
        "c3/costs-summary",
      ])
        assert.equal(
          (await request(s, path, "GET", undefined, token)).status,
          403,
        );
    assert.equal(
      (await request(s, "c3/teacher-students", "GET", undefined, student))
        .status,
      403,
    );
    maximum(f);
  } finally {
    f.restore();
  }
});
test("C3报表：已发生/待销课/已排未上分列；未保存缺勤按默认，取消不计，未来成本不进利润，原课酬算法不变", () => {
  const base = {
      id: "one",
      teacher_id: "t",
      teacher_name: "教师",
      course_type_id: "c",
      course_name: "钢琴",
      category_id: "cat",
      start_at: "2026-11-01T14:00+08:00",
      duration: 45,
      units: 1,
      status: "completed",
      override_rate: null,
      format: "individual",
    },
    ctx = {
      lessons: [
        base,
        { ...base, id: "no", status: "student_no_show" },
        { ...base, id: "wait", status: "planned" },
        {
          ...base,
          id: "tonight",
          start_at: "2026-11-04T21:00+08:00",
          status: "planned",
        },
        {
          ...base,
          id: "future",
          start_at: "2026-11-28T14:00+08:00",
          status: "planned",
        },
        { ...base, id: "cancel", status: "cancelled" },
      ],
      participants: [
        {
          id: "p",
          lesson_id: "one",
          student_id: "s",
          student_name: "学员",
          attendance: "attended",
          deducted: 1,
        },
        {
          id: "q",
          lesson_id: "no",
          student_id: "s",
          student_name: "学员",
          attendance: "no_show",
          deducted: 1,
        },
      ],
      rates: [
        {
          teacher_id: "t",
          course_type_id: "c",
          format: "individual",
          rate: 20000,
          rate_basis: "unit",
          effective_from: "2000-01-01",
          effective_to: "2100-01-01",
        },
      ],
      teachers: [{ id: "t", name: "教师" }],
      settlements: [],
      snapshots: [],
      payments: [],
      adjustments: [],
      costs: [
        { date: "2026-11-01", amount: 10000 },
        { date: "2026-11-28", amount: 90000 },
      ],
      tuition: [{ paid_at: "2026-11-01", amount: 100000 }],
    };
  const reportAt = Date.parse("2026-11-04T20:00+08:00");
  const out = occurredReport(
    ctx,
    effectivePolicies({}),
    "2026-11-04",
    reportAt,
  );
  assert.equal(out.lesson_count, 2);
  assert.equal(out.participant_count, 2);
  assert.equal(out.pending_count, 1);
  assert.equal(out.scheduled_count, 2);
  assert.equal(out.teacher_pay_amount, 40000);
  assert.equal(out.cost_amount, 10000);
  assert.equal(out.profit_amount, 50000);
  const cancellation = occurredReport(
    ctx,
    effectivePolicies({
      absence_policies: { cancelled: { deduct: false, teacherPaid: true } },
    }),
    "2026-11-04",
    reportAt,
  );
  assert.equal(cancellation.lesson_count, 2);
  assert.equal(cancellation.participant_count, 2);
  assert.equal(cancellation.teacher_pay_amount, 60000);
  assert.equal(cancellation.teachers[0].teacher_pay_amount, 60000);
  assert.equal(cancellation.teachers[0].lesson_count, 2);

  ctx.settlements = [{ locked: 1 }];
  ctx.snapshots = [
    {
      lesson_json: JSON.stringify(ctx.lessons[0]),
      teacher_id: "t",
      rate: 12345,
      rate_basis: "unit",
      quantity: 1,
      amount: 12345,
    },
    {
      lesson_json: JSON.stringify(ctx.lessons[1]),
      teacher_id: "t",
      rate: 12345,
      rate_basis: "unit",
      quantity: 1,
      amount: 12345,
    },
  ];
  const before = JSON.stringify(ctx);
  assert.equal(
    occurredReport(ctx, effectivePolicies({}), "2026-11-04").teacher_pay_amount,
    24690,
  );
  assert.equal(JSON.stringify(ctx), before);
});
test("C3报表HTTP：六个月固定批量读取≤40；教务分领域裁剪，财务可读，跨机构无他人名字", async () => {
  const savedClock = Date.now;
  Date.now = () => Date.parse("2026-11-04T20:00:00+08:00");
  const f = await fixture();
  try {
    const s = { ...(await setup(f, 2)), f };
    for (const student of s.students) await pack(s, student, 10);
    ok(
      await mutate(s, "finance/rates", {
        teacher_id: s.teacher,
        course_type_id: s.type,
        rate: 100,
        rate_basis: "unit",
        effective_from: "2026-01-01",
        effective_to: "2026-12-31",
      }),
    );
    const occurred = await lesson(s, "2026-11-01T14:00");
    ok(await status(s, occurred, "completed"));
    const absence = await lesson(s, "2026-11-02T14:00");
    ok(await status(s, absence, "student_no_show"));
    await lesson(s, "2026-11-03T14:00");
    await lesson(s, "2026-11-28T14:00");
    for (const [date, amount] of [
      ["2026-11-01", 15],
      ["2026-11-28", 999],
    ])
      ok(
        await mutate(s, "finance/costs", {
          date,
          category: "其他",
          amount,
          note: "截至报告日成本",
        }),
      );
    for (const [paid_at, amount] of [
      ["2026-11-01", 1000],
      ["2026-11-28", 99],
    ])
      ok(
        await mutate(s, "credits/payments", {
          student_id: s.students[0],
          paid_at,
          amount,
          method: "转账",
        }),
      );
    const admin = ok(await request(s, "c3/report?month=2026-11"));
    assert.equal(admin.trend.length, 6);
    assert.equal(admin.lesson_count, 2);
    assert.equal(admin.participant_count, 4);
    assert.equal(admin.pending_count, 1);
    assert.equal(admin.scheduled_count, 1);
    assert.equal(admin.tuition_amount, 1000);
    assert.equal(admin.teacher_pay_amount, 200);
    assert.equal(admin.cost_amount, 15);
    assert.equal(admin.profit_amount, 785);
    const cancelled = await lesson(s, "2026-11-02T16:00");
    ok(await status(s, cancelled, "cancelled"));
    ok(
      await request(s, "absence-policies", "PUT", {
        policies: effectivePolicies({
          absence_policies: { cancelled: { deduct: false, teacherPaid: true } },
        }),
      }),
    );
    const paidCancellation = ok(await request(s, "c3/report?month=2026-11"));
    assert.equal(paidCancellation.lesson_count, 2);
    assert.equal(paidCancellation.participant_count, 4);
    assert.equal(paidCancellation.teacher_pay_amount, 300);
    assert.equal(paidCancellation.profit_amount, 685);
    assert.equal(paidCancellation.teachers[0].lesson_count, 2);
    assert.equal(paidCancellation.teachers[0].teacher_pay_amount, 300);
    const micro = await s.create("students", { name: "小额核对" }),
      microPack = ok(
        await mutate(s, "credits/packages", {
          student_id: micro,
          course_type_id: s.type,
          units_total: 1,
          unit_price: 0.8,
          amount: 0.8,
          purchase_date: "2026-11-01",
        }),
      ).id;
    for (const amount of [0.1, 0.7])
      ok(
        await mutate(s, "credits/payments", {
          student_id: micro,
          package_id: microPack,
          amount,
          paid_at: "2026-11-01",
          method: "转账",
        }),
      );
    const receipts = ok(
      await request(s, "c3/receipts?month=2026-11&student_id=" + micro),
    );
    assert.equal(receipts.metrics.total_amount, 0.8);
    assert.equal(receipts.metrics.due_amount, 0);
    assert.equal(receipts.metrics.payment_count, 2);
    assert.equal(receipts.metrics.unresolved, 0);
    assert.equal(receipts.total, 0);
    assert.deepEqual(receipts.items, []);
    for (const amount of [0.1, 0.7])
      ok(
        await mutate(s, "finance/costs", {
          date: "2026-11-01",
          category: "小额核对",
          amount,
          note: "",
        }),
      );
    assert.equal(
      ok(await request(s, "c3/costs-summary?month=2026-11")).cost_amount,
      1014.8,
    );
    const foreign = await schoolFixture(f, "c3-receipt-other"),
      foreignStudent = ok(
        await foreign.call("data/students", "POST", { name: "另一机构" }),
      ).id;
    assert.equal(
      (await request(s, "c3/receipts?student_id=" + foreignStudent)).status,
      404,
    );
    assert.equal((await request(s, "c3/receipts?month=bad")).status, 400);

    assert.equal(
      (await request(s, "export?kind=report&scope=occurred&month=2026-11"))
        .status,
      200,
    );
    const academic = (await accountToken(s, ["academic"])).token,
      a = ok(
        await request(s, "c3/report?month=2026-11", "GET", undefined, academic),
      );
    assert.equal("tuition_amount" in a, false);
    assert.equal("teacher_pay_amount" in a, false);
    assert.equal("profit_amount" in a, false);
    for (const path of [
      "c3/receipts?month=2026-11",
      "c3/costs-summary?month=2026-11",
    ])
      assert.equal(
        (await request(s, path, "GET", undefined, academic)).status,
        403,
      );

    assert.equal((await request(s, "c3/report?month=__proto__")).status, 400);
    ok(await request(s, "c3/teachers"));
    ok(await request(s, "c3/leads-summary"));
    maximum(f);
  } finally {
    f.restore();
    Date.now = savedClock;
  }
});
test("C3固定排课只读预览：复用原冲突计划，不写课程流水；确认时仍重新校验；所有请求≤40", async () => {
  const f = await fixture();
  try {
    const s = { ...(await setup(f, 2)), f };
    const t = await s.create("schedule_templates", {
      teacher_id: s.teacher,
      course_type_id: s.type,
      location_id: s.room,
      weekday: 0,
      start_time: "14:00",
      duration: 45,
      units: 1,
      date_from: "2098-01-01",
      date_to: "2098-12-31",
    });
    await s.create("schedule_enrollments", {
      template_id: t,
      student_id: s.students[0],
      date_from: "2098-01-01",
      date_to: "2098-12-31",
    });
    const before = f.db.raw
        .prepare("SELECT COUNT(*) n FROM lessons WHERE tenant_id=?")
        .get(s.t.id).n,
      p = ok(
        await request(s, "c3/templates/preview", "POST", {
          from: "2098-11-01",
          to: "2098-11-28",
        }),
      );
    assert.equal(p.preview, true);
    assert.ok(p.generated > 0);
    assert.equal(
      f.db.raw
        .prepare("SELECT COUNT(*) n FROM lessons WHERE tenant_id=?")
        .get(s.t.id).n,
      before,
    );
    ok(
      await request(s, "templates/generate", "POST", {
        from: "2098-11-01",
        to: "2098-11-28",
      }),
    );
    const after = ok(
      await request(s, "c3/templates/preview", "POST", {
        from: "2098-11-01",
        to: "2098-11-28",
      }),
    );
    assert.equal(after.generated, 0);
    assert.ok(after.skipped > 0);
    maximum(f);
  } finally {
    f.restore();
  }
});
test("C3线索汇总：统计整机构而非页面，转正不出看板；模板预览权限和设置枚举失败关闭", async () => {
  const f = await fixture();
  try {
    const s = { ...(await setup(f, 1)), f };
    ok(
      await request(s, "tools/leads", "POST", {
        name: "线索",
        phone: "13812345678",
        parent_phone: "",
        stage: "trial",
        direction: "声乐",
      }),
    );
    const m = ok(await request(s, "c3/leads-summary"));
    assert.equal(m.added, 1);
    assert.equal(m.trial, 1);
    assert.equal(m.converted, 0);
    const task = ok(
      await request(s, "tools/followup_tasks", "POST", {
        student_id: s.students[0],
        title: "历史任务",
        due_date: "2026-11-01",
        assignee_id: s.user.id,
      }),
    ).id;
    f.db.raw
      .prepare(
        "UPDATE followup_tasks SET assignee_id=NULL,legacy_owner=? WHERE tenant_id=? AND id=?",
      )
      .run("旧负责人", s.t.id, task);
    ok(
      await request(s, "tools/followup_tasks/" + task, "PATCH", {
        version: 1,
        done: true,
      }),
    );
    const completed = f.db.raw
      .prepare(
        "SELECT done,assignee_id,legacy_owner FROM followup_tasks WHERE tenant_id=? AND id=?",
      )
      .get(s.t.id, task);
    assert.equal(completed.done, 1);
    assert.equal(completed.assignee_id, null);
    assert.equal(completed.legacy_owner, "旧负责人");
    assert.equal(
      (
        await request(s, "tools/followup_tasks/" + task, "PATCH", {
          version: 2,
          title: "改其他信息",
        })
      ).status,
      404,
    );

    assert.equal(
      (
        await request(s, "settings", "PUT", {
          key: "default_schedule_view",
          value: "__proto__",
        })
      ).status,
      400,
    );
    ok(
      await request(s, "settings", "PUT", {
        key: "default_schedule_view",
        value: "teacher",
      }),
    );
    const finance = (await accountToken(s, ["finance"])).token;
    assert.equal(
      (
        await request(
          s,
          "c3/templates/preview",
          "POST",
          { from: "2098-01-01", to: "2098-01-07" },
          finance,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await request(
          s,
          "settings",
          "PUT",
          { key: "teacher_view_student_balance", value: true },
          finance,
        )
      ).status,
      403,
    );
    maximum(f);
  } finally {
    f.restore();
  }
});
test("C3余额授权不能被历史角色授权注入，线索相邻拖动且流失仅重新跟进；财务日志入口可见", async () => {
  const { can } = await import("../src/server/permissions.js"),
    { leadMoveAllowed } = await import("../src/shared/view.js");
  const u = { roles: ["teacher"], teacher_id: "own" },
    p = {
      modules: { students: true, packages: true, schedule: true },
      settings: { teacher_view_student_balance: true },
      rights: [
        {
          role: "teacher",
          module: "students",
          action: "read_balance",
          allowed: 1,
        },
      ],
    };
  assert.equal(
    can(u, p, "students", "read_balance", {
      teacher_id: "other",
      current_main: true,
    }),
    false,
  );
  assert.equal(
    can(u, p, "students", "read_balance", {
      teacher_id: "own",
      current_main: false,
    }),
    false,
  );
  assert.equal(
    can(u, p, "students", "read_balance", {
      teacher_id: "own",
      current_main: true,
    }),
    true,
  );
  p.modules.packages = false;
  assert.equal(
    can(u, p, "students", "read_balance", {
      teacher_id: "own",
      current_main: true,
    }),
    false,
  );
  assert.equal(leadMoveAllowed("new", "contacted"), true);
  for (const pair of [
    ["new", "trial"],
    ["trial", "enrolled"],
    ["lost", "trial"],
    ["new", "lost"],
  ])
    assert.equal(leadMoveAllowed(...pair), false);
  const f = await fixture();
  try {
    const s = { ...(await setup(f, 1)), f },
      token = (await accountToken(s, ["finance"])).token;
    const me = ok(await request(s, "me", "GET", undefined, token));
    assert.equal(me.capabilities.logs.read_finance, true);
    assert.equal(me.labels.modules.tuition, "学费收款");
    assert.deepEqual(
      ok(await request(s, "logs?actor=" + encodeURIComponent("不存在的操作人")))
        .items,
      [],
    );
    assert.equal((await request(s, "logs?from=2026-02-30")).status, 400);
    const filtered = ok(
      await request(
        s,
        "logs?from=2026-01-01&to=2026-12-31",
        "GET",
        undefined,
        token,
      ),
    );
    assert.ok(
      filtered.items.every((x) =>
        ["tuition", "teacher_pay", "settlements"].includes(x.module),
      ),
    );
  } finally {
    f.restore();
  }
});
test("C3预览查询预算：30个模板×30人×一个月，预览无写入，单请求≤40", async () => {
  const f = await fixture();
  try {
    const s = { ...(await setup(f, 30)), f };
    const id = await s.create("schedule_templates", {
      teacher_id: s.teacher,
      course_type_id: s.type,
      location_id: s.room,
      weekday: 0,
      start_time: "08:00",
      duration: 45,
      units: 1,
      date_from: "2098-01-01",
      date_to: "2098-12-31",
    });
    await s.create("schedule_enrollments", {
      template_id: id,
      student_id: s.students[0],
      date_from: "2098-01-01",
      date_to: "2098-12-31",
    });
    const raw = f.db.raw,
      copy = (table, row) => {
        const keys = Object.keys(row);
        raw
          .prepare(
            "INSERT INTO " +
              table +
              "(" +
              keys.join(",") +
              ") VALUES(" +
              keys.map(() => "?").join(",") +
              ")",
          )
          .run(...Object.values(row));
      },
      tpl = raw
        .prepare("SELECT * FROM schedule_templates WHERE tenant_id=? AND id=?")
        .get(s.t.id, id),
      enr = raw
        .prepare("SELECT * FROM schedule_enrollments WHERE tenant_id=? LIMIT 1")
        .get(s.t.id);
    raw
      .prepare("DELETE FROM schedule_enrollments WHERE tenant_id=?")
      .run(s.t.id);
    for (let i = 0; i < 30; i++) {
      const tid = i === 0 ? id : "tpl_scale_" + i;
      if (i)
        copy("schedule_templates", {
          ...tpl,
          id: tid,
          weekday: i % 6,
          start_time:
            String(8 + Math.floor(i / 6) * 2).padStart(2, "0") + ":00",
        });
      for (let j = 0; j < 30; j++)
        copy("schedule_enrollments", {
          ...enr,
          id: "enr_scale_" + i + "_" + j,
          template_id: tid,
          student_id: s.students[j],
        });
    }
    const response = await request(s, "c3/templates/preview", "POST", {
        from: "2098-11-01",
        to: "2098-11-28",
      }),
      data = ok(response);
    assert.equal(data.preview, true);
    assert.ok(data.generated >= 120);
    assert.deepEqual(data.conflicts, []);
    assert.equal(
      raw
        .prepare("SELECT COUNT(*) n FROM lessons WHERE tenant_id=?")
        .get(s.t.id).n,
      0,
    );
    assert.ok(response.queries <= 40);
    maximum(f);
  } finally {
    f.restore();
  }
});
