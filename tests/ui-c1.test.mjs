import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fixture } from "./support.mjs";
import { setup, request, accountToken, pack } from "./fixtures-credit.mjs";
import { schoolFixture } from "./fixtures-school.mjs";
import { addStudentSummaries } from "../src/server/scheduling.js";
import {
  viewFormat as fmt,
  packageStatus,
  stageStatus,
  studentDisplay,
  VIEW_DEFAULTS,
  personStatus,
} from "../src/shared/view.js";
import { randomId, bytes, b64, sha } from "../src/server/core.js";
import { renewalSettings } from "../src/server/tools.js";
const ok = (x) => {
  assert.equal(x.status, 200, x.text);
  return x.body;
};
function insert(f, table, row) {
  const keys = Object.keys(row);
  f.db.raw
    .prepare(
      `INSERT INTO ${table}(${keys.join(",")}) VALUES(${keys.map(() => "?").join(",")})`,
    )
    .run(...Object.values(row));
}
async function person(s, role, association) {
  const created = ok201(
    await s.call("accounts", "POST", {
      name: role,
      phone: "138" + String(Math.floor(Math.random() * 1e8)).padStart(8, "0"),
      roles: [role],
      ...association,
    }),
  );
  const user = await s.r.user(created.id);
  s.f.db.raw
    .prepare("UPDATE users SET must_change=0 WHERE tenant_id=?")
    .run(s.t.id);
  const token = b64(bytes(32));
  await s.r.createSession(await sha(token), user, { ip: "c1", ua: "test" });
  return token;
}
function ok201(x) {
  assert.equal(x.status, 201, x.text);
  return x.body;
}
test("C1格式：金额边界、表格零值、北京时间日期/星期/时间段、课时和同名区分", () => {
  assert.equal(fmt.money(-5), "-¥5");
  assert.equal(fmt.money(-6700), "-¥6,700");
  assert.equal(fmt.receivable(24440, 8), "¥24,440 · 另有 8 笔待核对");
  const displayedContact = fmt.date("2026-10-30T16:32:00+08:00");
  assert.equal(displayedContact, "2026-10-30");
  assert.doesNotMatch(displayedContact, /T.*\+08:00/);
  for (const [v, w] of [
    [0, "¥0"],
    [12.3, "¥12.30"],
    [188.5, "¥188.50"],
    [4000, "¥4,000"],
    [-5, "-¥5"],
    [null, "未填写"],
  ])
    assert.equal(fmt.money(v), w);
  assert.equal(personStatus({ status: "active" }, "teachers"), "在职");
  assert.equal(personStatus({ status: "paused" }, "teachers"), "离职");
  assert.equal(fmt.date("2026-11-03T17:00:00Z"), "2026-11-04");
  assert.equal(fmt.time("2026-11-03T17:00:00Z"), "01:00");
  assert.equal(fmt.time("2026-11-04T14:17"), "14:17");
  assert.equal(fmt.moneyCell(0), "—");
  assert.equal(fmt.moneyCell(null), "未填写");
  assert.equal(fmt.day("2026-11-08"), "11-08 周日");
  assert.equal(fmt.date(Date.parse("2026-11-03T17:00Z")), "2026-11-04");
  assert.equal(fmt.range("2026-11-04T14:00+08:00", 45), "14:00–14:45");
  assert.equal(fmt.units(6.5), "6.5 课时");
  const people = [
    { name: "王小明", grade: "三年级", parent_name: "王妈妈" },
    { name: "王小明", grade: "三年级", parent_name: "王爸爸" },
  ];
  assert.equal(studentDisplay(people[0], people), "王小明 · 三年级 · 王妈妈");
  assert.equal(studentDisplay(people[0], [people[0]]), "王小明");
});
test("C1状态：从未保存设置逐项回落、保留机构阈值，暂停/到期/零/低优先级与阶段到期", () => {
  assert.equal(VIEW_DEFAULTS.low_balance_threshold, 3);
  assert.equal(renewalSettings({}).low_balance_threshold, 3);
  assert.equal(
    renewalSettings({ low_balance_threshold: 8 }).low_balance_threshold,
    8,
  );
  const p = { status: "active", balance: 2, valid_to: "2026-11-20" };
  for (const [row, want] of [
    [p, "low"],
    [{ ...p, status: "paused", valid_to: "2026-01-01" }, "paused"],
    [{ ...p, balance: 0, valid_to: "2026-01-01" }, "expired"],
    [{ ...p, balance: 0 }, "empty"],
    [{ ...p, balance: 4 }, "active"],
  ])
    assert.equal(packageStatus(row, {}, "2026-11-04").code, want);
  assert.equal(
    packageStatus(
      { ...p, balance: 4 },
      { low_balance_threshold: 5 },
      "2026-11-04",
    ).code,
    "low",
  );
  assert.equal(
    stageStatus({ status: "active", date_to: "2026-11-03" }, "2026-11-04").text,
    "已到期",
  );
  assert.equal(
    stageStatus({ status: "completed", date_to: "2026-11-03" }, "2026-11-04")
      .text,
    "已完成",
  );
});
test("C1摘要：85节两次业务往返、整次HTTP≤40、班课前三姓名、学员仅本人且跨机构不串", async () => {
  const f = await fixture();
  try {
    const s = { ...(await setup(f, 4)), f },
      other = await schoolFixture(f, "c1-other");
    const base = {
      tenant_id: s.t.id,
      created_at: Date.now(),
      updated_at: Date.now(),
      created_by: "fixture",
      updated_by: "fixture",
    };
    for (let n = 0; n < 85; n++) {
      const id = randomId("les");
      insert(f, "lessons", {
        ...base,
        id,
        teacher_id: s.teacher,
        course_type_id: s.type,
        location_id: s.room,
        start_at: "2026-11-04T14:00+08:00",
        duration: 45,
        units: 1,
        status: "planned",
      });
      for (const sid of s.students)
        insert(f, "lesson_participants", {
          ...base,
          id: randomId("par"),
          lesson_id: id,
          student_id: sid,
        });
    }
    const paths = ["schedule?from=2026-11-02&to=2026-11-09", "data/lessons"];
    for (const path of paths) {
      const data = ok(await request(s, path));
      assert.equal(data.items.length, 85);
      for (const row of data.items) {
        assert.equal(row.participants_summary.count, 4);
        assert.equal(row.participants_summary.names.length, 3);
      }
      assert.ok(f.db.queryReports.at(-1).queries <= 40);
      assert.equal(ok(await other.call(path)).items.length, 0);
    }
    for (const [path, limit] of [
      ["schedule", 2],
      ["data", 2],
    ]) {
      let records = [];
      const measured = await f.db.measure(async () => {
        records =
          path === "schedule"
            ? await s.r.weekPage("2026-11-02", "2026-11-09", 0, {
                roles: ["supervisor"],
              })
            : (await s.r.businessPage("lessons", 0, "")).rows;
        await addStudentSummaries(s.r, records, { roles: ["supervisor"] });
        return new Response();
      });
      assert.equal(Number(measured.headers.get("x-test-d1-queries")), limit);
    }
    const tk = await person(s, "student", { student_id: s.students[0] });
    for (const path of paths) {
      const data = ok(await request(s, path, "GET", undefined, tk));
      assert.equal(data.items.length, 85);
      for (const row of data.items)
        assert.deepEqual(row.participants_summary, {
          count: 1,
          names: ["学员0"],
          class_name: null,
        });
    }
    const teacher = await person(s, "teacher", { teacher_id: s.teacher });
    assert.equal(
      ok(await request(s, paths[0], "GET", undefined, teacher)).items[0]
        .participants_summary.count,
      4,
    );
  } finally {
    f.restore();
  }
});
test("C1权限：纯财务课表/学员只读及联系方式裁剪，主管兼财务保留写权限", async () => {
  const f = await fixture();
  try {
    const s = { ...(await setup(f, 1)), f };
    const finance = (await accountToken(s, ["finance"])).token;
    for (const path of ["data/students", "data/lessons"])
      assert.equal(
        (await request(s, path, "POST", { name: "禁止" }, finance)).status,
        403,
      );
    assert.equal(
      (
        await request(
          s,
          "data/students/" + s.students[0],
          "PATCH",
          { name: "禁止", version: 1 },
          finance,
        )
      ).status,
      403,
    );
    const students = ok(
      await request(s, "data/students", "GET", undefined, finance),
    );
    assert.ok(!JSON.stringify(students).includes("phone_enc"));
    assert.ok(!JSON.stringify(students).includes("phone_hmac"));
    assert.equal(
      (
        await request(
          s,
          "data/students/" + s.students[0] + "/contact",
          "POST",
          {},
          finance,
        )
      ).status,
      403,
    );
    f.db.raw
      .prepare("UPDATE users SET roles=? WHERE tenant_id=? AND id=?")
      .run(JSON.stringify(["supervisor", "finance"]), s.t.id, s.user.id);
    const multi = b64(bytes(32));
    await s.r.createSession(await sha(multi), await s.r.user(s.user.id), {
      ip: "c1",
      ua: "mixed",
    });
    assert.equal(
      (
        await request(
          s,
          "data/students",
          "POST",
          { name: "多角色可新增" },
          multi,
        )
      ).status,
      200,
    );
  } finally {
    f.restore();
  }
});
test("C1搜索：三组各8条、最长中文和字面%_反斜杠、不泄露电话、租户隔离与个人禁止", async () => {
  const f = await fixture();
  try {
    const s = { ...(await setup(f, 1)), f },
      other = await schoolFixture(f, "c1-search");
    const base = {
      tenant_id: s.t.id,
      created_at: Date.now(),
      updated_at: Date.now(),
      created_by: "fixture",
      updated_by: "fixture",
    };
    for (const kind of ["students", "teachers", "leads"])
      for (let n = 0; n < 10; n++)
        insert(f, kind, { ...base, id: randomId("rec"), name: "C1%_\\" + n });
    const data = ok(await request(s, "search?q=" + encodeURIComponent("%_\\")));
    for (const rows of Object.values(data.groups)) {
      assert.equal(rows.length, 8);
      assert.ok(rows.every((r) => r.name.includes("%_\\")));
      assert.ok(
        rows.every((r) => !Object.keys(r).some((k) => k.includes("phone"))),
      );
    }
    assert.deepEqual(
      ok(await request(s, "search?q=" + encodeURIComponent("中".repeat(100))))
        .groups,
      { students: [], teachers: [], leads: [] },
    );
    assert.deepEqual(ok(await other.call("search?q=C1")).groups, {
      students: [],
      teachers: [],
      leads: [],
    });
    assert.equal((await request(s, "search?q=" + "a".repeat(101))).status, 400);
    const tk = await person(s, "student", { student_id: s.students[0] });
    assert.equal(
      (await request(s, "search?q=C1", "GET", undefined, tk)).status,
      403,
    );
  } finally {
    f.restore();
  }
});
test("C1待办：待办字段准确、阶段到期合入今天、保留阈值、角标不含续费、个人不得读取", async () => {
  const f = await fixture();
  try {
    const s = { ...(await setup(f, 1)), f };
    const now = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Asia/Shanghai",
    }).format(new Date());
    const base = {
      tenant_id: s.t.id,
      created_at: Date.now(),
      updated_at: Date.now(),
      created_by: "fixture",
      updated_by: "fixture",
    };
    insert(f, "followup_tasks", {
      ...base,
      id: randomId("fol"),
      title: "逾期",
      due_date: "2000-01-01",
      done: 0,
    });
    insert(f, "followup_tasks", {
      ...base,
      id: randomId("fol"),
      title: "今天",
      due_date: now,
      done: 0,
    });
    insert(f, "student_stages", {
      ...base,
      id: randomId("stg"),
      student_id: s.students[0],
      name: "过期阶段",
      status: "active",
      date_to: "2000-01-01",
    });
    const data = ok(await request(s, "todo/summary"));
    assert.deepEqual(data, {
      unchecked_lessons: 0,
      teacher_submissions: 0,
      makeup_pending: 0,
      makeup_recent: 0,
      followup_overdue: 1,
      followup_today: 2,
      stage_expired: 1,
      renewal_zero: 0,
      renewal_low: 0,
      renewal_expiring: 0,
      renewal_debt: 0,
    });
    const tk = await person(s, "student", { student_id: s.students[0] });
    assert.equal(
      (await request(s, "todo/summary", "GET", undefined, tk)).status,
      403,
    );
  } finally {
    f.restore();
  }
});
test("C1欠费：明确关联应收减实收，缺价/未关联待核对且教务不能读取", async () => {
  const f = await fixture();
  try {
    const s = { ...(await setup(f, 1)), f };
    const id = await pack(s, s.students[0], 10);
    assert.deepEqual(ok(await request(s, "finance/receivable-summary")), {
      amount: 1000,
      unresolved: 0,
    });
    f.db.raw
      .prepare("UPDATE packages SET amount=NULL WHERE tenant_id=? AND id=?")
      .run(s.t.id, id);
    assert.deepEqual(ok(await request(s, "finance/receivable-summary")), {
      amount: 0,
      unresolved: 1,
    });
    const tk = (await accountToken(s, ["academic"])).token;
    assert.equal(
      (await request(s, "finance/receivable-summary", "GET", undefined, tk))
        .status,
      403,
    );
  } finally {
    f.restore();
  }
});
test("C1约束：界面无toFixed(2)、新共享部件齐全、无框架/新增迁移/内联脚本", async () => {
  const app = await readFile("src/tenant/app.js", "utf8"),
    ui = await readFile("src/ui/components.js", "utf8");
  assert.ok(!app.includes("toFixed(2)"));
  for (const name of [
    "page",
    "table",
    "filterBar",
    "drawer",
    "formDialog",
    "status",
    "empty",
    "confirm",
    "monthPicker",
    "datePicker",
    "timePicker",
    "upload",
  ])
    assert.ok(ui.includes("function " + name + "("));
  assert.ok(!/\b(?:alert|prompt|confirm)\(/.test(app));
  assert.ok(!app.includes("innerHTML"));
});
