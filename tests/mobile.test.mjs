import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fixture } from "./support.mjs";
import {
  request,
  mutate,
  lesson,
  details,
  status,
  accountToken,
  balance,
} from "./fixtures-credit.mjs";
import {
  mobileSetup,
  teacherToken,
  proposal,
  review,
  decide,
  MOBILE_NOW,
} from "./fixtures-mobile.mjs";
import { randomId } from "../src/server/core.js";
const originalNow = Date.now;
async function check(r, code = 200) {
  assert.equal(r.status, code, r.text);
  if (r.queries !== undefined) assert.ok(r.queries <= 40);
  return r.body;
}
async function withMobile(run, count = 2) {
  Date.now = () => MOBILE_NOW;
  const f = await fixture();
  try {
    const s = await mobileSetup(f, count);
    await run(s);
  } finally {
    f.restore();
    Date.now = originalNow;
  }
}
const payroll = (s) => request(s, "finance/payroll?month=2026-11");
async function addRate(s) {
  return check(
    await mutate(s, "finance/rates", {
      teacher_id: s.teacher,
      course_type_id: s.type,
      format: "group",
      rate_basis: "legacy",
      rate: 200,
      effective_from: "2026-01-01",
      effective_to: "2026-12-31",
    }),
  );
}
function txCount(s) {
  return s.f.db.raw
    .prepare("SELECT COUNT(*) n FROM package_transactions WHERE tenant_id=?")
    .get(s.t.id).n;
}
function state(s) {
  return JSON.stringify(
    s.f.db.raw
      .prepare(
        "SELECT id,attendance,deducted FROM lesson_participants WHERE tenant_id=? ORDER BY id",
      )
      .all(s.t.id),
  );
}
test(
  "第五阶段：仅主讲可提交，助教只读，默认关闭；开课前/截止后拒绝且边界可提交",
  async () =>
    withMobile(async (s) => {
      const assistantId = await s.create("teachers", { name: "助教" }),
        assistant = await teacherToken(s, assistantId),
        v = await details(s, s.lid);
      await check(
        await s.call("data/lessons/" + s.lid, "PATCH", {
          version: v.version,
          assistant_id: assistantId,
        }),
      );
      await check(await review(s, s.lid, assistant.token));
      await check(await proposal(s, { token: assistant.token }), 403);
      await check(
        await request(s, "settings", "PUT", {
          key: "teacher_self_checkin",
          value: false,
        }),
      );
      await check(await proposal(s), 403);
      await check(
        await request(s, "settings", "PUT", {
          key: "teacher_self_checkin",
          value: true,
        }),
      );
      Date.now = () => MOBILE_NOW - 1;
      await check(await proposal(s), 403);
      Date.now = () => MOBILE_NOW;
      await check(await proposal(s));
      Date.now = () => MOBILE_NOW + 45 * 60000 + 48 * 3600000;
      // Refresh the supervisor session after time travel; teachers have personal long sessions.
      s.f.db.raw
        .prepare(
          "UPDATE sessions SET expires_at=?,last_seen_at=? WHERE tenant_id=?",
        )
        .run(Date.now() + 7 * 86400000, Date.now(), s.t.id);
      await check(await proposal(s));
      Date.now = () => MOBILE_NOW + 45 * 60000 + 48 * 3600000 + 1;
      await check(await proposal(s), 403);
    }),
  { timeout: 20000 },
);
test(
  "第五阶段：待确认不扣课不计酬，退回无流水，重提确认一次原子生效、重复确认幂等",
  async () =>
    withMobile(async (s) => {
      await addRate(s);
      const before = txCount(s),
        initial = state(s);
      const first = await check(await proposal(s));
      assert.equal(txCount(s), before);
      assert.equal(state(s), initial);
      assert.equal((await check(await payroll(s))).items[0].accrued_amount, 0);
      assert.deepEqual(
        (await check(await review(s, s.lid, s.student.token))).published,
        [],
      );
      await check(await decide(s, first.id, "return"));
      assert.equal(txCount(s), before);
      const second = await check(await proposal(s));
      const confirmOp = randomId("confirm");
      const a = await mutate(s, "submissions/" + second.id + "/confirm", {
        version: 1,
        operation_id: confirmOp,
      });
      await check(a);
      await check(
        await mutate(s, "submissions/" + second.id + "/confirm", {
          version: 1,
          operation_id: confirmOp,
        }),
      );
      assert.equal(txCount(s), before + s.students.length);
      assert.equal(
        (await check(await payroll(s))).items[0].accrued_amount,
        200,
      );
      await check(await proposal(s), 409);
      const student = await check(await review(s, s.lid, s.student.token));
      assert.equal(student.participants.length, 1);
      assert.equal(student.published.length, 2);
      assert.equal(student.people.length, 0);
      assert.equal(student.submission, null);
      const weekly = await check(
        await request(
          s,
          "schedule?from=2026-11-01&to=2026-11-30",
          "GET",
          undefined,
          s.student.token,
        ),
      );
      assert.equal(weekly.items[0].private_comment, "个人点评学员0");
      assert.ok(!JSON.stringify(weekly).includes("个人点评学员1"));
      s.f.db.raw
        .prepare(
          "UPDATE tenant_modules SET enabled=0 WHERE tenant_id=? AND id='comments'",
        )
        .run(s.t.id);
      const hidden = await check(
        await request(
          s,
          "schedule?from=2026-11-01&to=2026-11-30",
          "GET",
          undefined,
          s.student.token,
        ),
      );
      assert.ok(!JSON.stringify(hidden).includes("个人点评"));
      assert.ok(!("private_comment" in hidden.items[0]));
    }),
  { timeout: 20000 },
);
test(
  "第五阶段：点评修订待审/退回保留旧版本；确认替换；员工锁月更正保存前后全文且不改课时课酬",
  async () =>
    withMobile(async (s) => {
      await addRate(s);
      let p = await check(
        await proposal(s, { text: "旧公共", comment: "旧个人" }),
      );
      await check(await decide(s, p.id));
      const beforeTx = txCount(s),
        beforeParts = state(s);
      p = await check(
        await proposal(s, {
          kind: "comments",
          text: "新公共",
          comment: "新个人",
        }),
      );
      let student = await check(await review(s, s.lid, s.student.token));
      assert.ok(student.published.some((c) => c.text === "旧公共"));
      assert.ok(!JSON.stringify(student).includes("新公共"));
      await check(await decide(s, p.id, "return"));
      student = await check(await review(s, s.lid, s.student.token));
      assert.ok(student.published.some((c) => c.text === "旧公共"));
      p = await check(
        await proposal(s, {
          kind: "comments",
          text: "新公共",
          comment: "新个人",
        }),
      );
      await check(await decide(s, p.id));
      student = await check(await review(s, s.lid, s.student.token));
      assert.ok(student.published.some((c) => c.text === "新公共"));
      assert.equal(txCount(s), beforeTx);
      assert.equal(state(s), beforeParts);
      const finance = await accountToken(s, ["finance"]);
      await check(
        await mutate(
          s,
          "finance/settlements/submit",
          { month: "2026-11", version: 0 },
          "POST",
          finance.token,
        ),
      );
      await check(
        await mutate(s, "finance/settlements/approve", {
          month: "2026-11",
          version: 1,
        }),
      );
      const payBefore = (await check(await payroll(s))).items[0].accrued_amount;
      const current = await check(await review(s, s.lid, s.token));
      await check(
        await mutate(
          s,
          "lessons/" + s.lid + "/comments",
          {
            comment_fingerprint: current.comment_fingerprint,
            public_text: "员工更正全文",
            homework: "新版作业",
            people: current.participants.map((p) => ({
              participant_id: p.id,
              student_id: p.student_id,
              comment: "员工私评" + p.name,
            })),
          },
          "PUT",
        ),
      );
      assert.equal(txCount(s), beforeTx);
      assert.equal(state(s), beforeParts);
      assert.equal(
        (await check(await payroll(s))).items[0].accrued_amount,
        payBefore,
      );
      const log = await check(await request(s, "logs"));
      assert.ok(
        log.items.some(
          (l) =>
            JSON.stringify(l).includes("新公共") &&
            JSON.stringify(l).includes("员工更正全文"),
        ),
      );
      await check(await proposal(s, { kind: "comments" }), 409);
    }),
  { timeout: 20000 },
);
test(
  "第五阶段：锁月不能确认；待确认课程阻断提交/批准并列出课程；相关课次变化才拒绝",
  async () =>
    withMobile(async (s) => {
      const finance = await accountToken(s, ["finance"]);
      const p = await check(await proposal(s));
      let res = await mutate(
        s,
        "finance/settlements/submit",
        { month: "2026-11", version: 0 },
        "POST",
        finance.token,
      );
      await check(res, 409);
      assert.match(res.text, /班课/);
      await check(await decide(s, p.id, "return"));
      const submit = () => mutate(s, "finance/settlements/submit",
        { month: "2026-11", version: 0 }, "POST", finance.token);
      assert.equal((await check(await submit(), 409)).code, "PENDING_CHECKOUT");
      // A future planned class may start between submission and approval.
      Date.now = () => Date.parse("2026-11-10T09:59:00+08:00");
      try {
        await check(await submit());
      } finally {
        Date.now = () => MOBILE_NOW;
      }
      const p2 = await check(await proposal(s));
      await check(
        await mutate(s, "finance/settlements/approve", {
          month: "2026-11",
          version: 1,
        }),
        409,
      );
      // Lock is normally impossible with pending work; simulate legacy/external locked state to test the server gate.
      s.f.db.raw
        .prepare(
          "UPDATE settlements SET locked=1,status='locked' WHERE tenant_id=? AND month='2026-11'",
        )
        .run(s.t.id);
      await check(await decide(s, p2.id), 409);
      assert.equal(txCount(s), s.students.length);
      s.f.db.raw
        .prepare(
          "UPDATE settlements SET locked=0,status='draft' WHERE tenant_id=? AND month='2026-11'",
        )
        .run(s.t.id);
      const student = await s.r.businessGet("students", s.students[0]);
      await check(
        await s.call("data/students/" + student.id, "PATCH", {
          version: student.version,
          name: "无关姓名变更",
        }),
      );
      await check(await decide(s, p2.id));
    }),
  { timeout: 20000 },
);
test(
  "第五阶段：禁止欠课且无人可确认时保留提交；出勤改动或点评更正使本课提案过期，不影响其他课",
  async () =>
    withMobile(async (s) => {
      let p = await check(await proposal(s));
      const pack = (await request(s, "credits/packages")).body.items[0];
      await check(
        await mutate(s, "credits/adjust", {
          package_id: pack.id,
          delta: -20,
          reason: "测试余额不足",
        }),
      );
      await check(await s.call("settings", "PUT", { key: "max_debt_units", value: 0 }));
      const before = txCount(s);
      const blocked = await check(await decide(s, p.id));
      assert.equal(blocked.committed, false);
      assert.equal(blocked.blocked.length, 1);
      assert.equal(txCount(s), before);
      assert.equal((await review(s)).body.submission.status, "pending");
      await check(
        await mutate(s, "credits/adjust", {
          package_id: pack.id,
          delta: 20,
          reason: "恢复",
        }),
      );
      const d = await details(s, s.lid);
      await check(
        await s.call("data/lessons/" + s.lid, "PATCH", {
          version: d.version,
          units: 2,
        }),
      );
      await check(await decide(s, p.id), 409);
      await check(await decide(s, p.id, "return"));
      p = await check(await proposal(s));
      const own = await check(await review(s, s.lid, s.token));
      await check(
        await mutate(
          s,
          "lessons/" + s.lid + "/comments",
          {
            comment_fingerprint: own.comment_fingerprint,
            public_text: "并发更正",
            people: own.participants.map((p) => ({
              participant_id: p.id,
              student_id: p.student_id,
              comment: "",
            })),
          },
          "PUT",
        ),
      );
      await check(await decide(s, p.id), 409);
    }, 1),
  { timeout: 20000 },
);
test(
  "第五阶段：超时未提交筛选、员工可直接销课；个人图片/开关/跨机构与跨课关联均强制隔离",
  async () =>
    withMobile(async (s) => {
      const oldId = await lesson(s, "2026-11-07T09:00");
      const overdue = await check(
        await request(
          s,
          "submissions?status=overdue&from=2026-11-01&to=2026-11-30",
        ),
      );
      assert.ok(overdue.items.some((l) => l.lesson_id === oldId));
      await status(s, oldId, "completed");
      assert.equal(
        (
          await check(
            await request(
              s,
              "submissions?status=overdue&from=2026-11-01&to=2026-11-30",
            ),
          )
        ).items.some((l) => l.lesson_id === oldId),
        false,
      );
      const otherTeacher = await s.create("teachers", { name: "其他教师" }),
        other = await teacherToken(s, otherTeacher);
      await check(await review(s, s.lid, other.token), 404);
      const foreign = await mobileSetup(s.f, 1, "foreign");
      await check(await review(s, foreign.lid), 404);
      const cross = await review(s),
        bad = {
          ...cross.body.participants[0],
          participant_id: (await review(foreign)).body.participants[0].id,
        };
      await check(
        await proposal(s, {
          extra: { people: [{ ...bad, attendance: "attended" }] },
        }),
        400,
      ); // missing class members rejects first
      const image = await check(
        await request(
          s,
          "brand-timetable?from=2026-11-09",
          "GET",
          undefined,
          s.student.token,
        ),
      );
      assert.ok(image.items.every((l) => !("student_name" in l)));
      assert.equal(image.owner_name, "学员0");
      await check(
        await request(
          s,
          "brand-timetable?from=2026-11-09&student_id=" + s.students[1],
          "GET",
          undefined,
          s.student.token,
        ),
        404,
      );
      await check(
        await request(
          s,
          "brand-timetable?from=2026-11-09&teacher_id=" + otherTeacher,
          "GET",
          undefined,
          s.teacherAccount.token,
        ),
        404,
      );
      for (const [key, endpoint] of [
        ["student_view_balance", "credits/packages"],
        ["student_view_payments", "credits/payments"],
      ]) {
        await check(await request(s, "settings", "PUT", { key, value: false }));
        await check(
          await request(s, endpoint, "GET", undefined, s.student.token),
          403,
        );
      }
    }),
  { timeout: 20000 },
);
test(
  "第五阶段查询预算：30人班课的读取/提交/退回/确认/更正/队列/图片/财务拦截每请求≤40",
  async () =>
    withMobile(async (s) => {
      const results = [],
        measure = async (
          name,
          path,
          method = "GET",
          data,
          token = s.token,
          expected = 200,
        ) => {
          const res = data
            ? await mutate(s, path, data, method, token)
            : await request(s, path, method, undefined, token);
          await check(res, expected);
          results.push({
            name,
            path,
            method,
            queries: res.queries,
            statements: res.statements,
            status: res.status,
          });
          return res.body;
        };
      await measure(
        "本人下一节课（跨周）",
        "schedule-next",
        "GET",
        null,
        s.student.token,
      );
      const v = await measure(
        "课程及公开点评读取",
        "lessons/" + s.lid + "/review",
        "GET",
        null,
        s.teacherAccount.token,
      );
      const body = {
        kind: "attendance",
        comment_fingerprint: v.comment_fingerprint,
        previous_id: null,
        public_text: "预算公共内容",
        people: v.participants.map((p) => ({
          participant_id: p.id,
          student_id: p.student_id,
          attendance: "attended",
          comment: "预算点评",
        })),
      };
      let p = await measure(
        "30人提交",
        "lessons/" + s.lid + "/review",
        "POST",
        body,
        s.teacherAccount.token,
      );
      await measure("待确认列表", "submissions?from=2026-11-01&to=2026-11-30");
      await measure(
        "逾期未提交列表",
        "submissions?status=overdue&from=2026-11-01&to=2026-11-30",
      );
      await measure("退回无流水", "submissions/" + p.id + "/return", "POST", {
        version: 1,
        reason: "预算退回",
      });
      const current = (await review(s)).body;
      p = await measure(
        "30人重新提交",
        "lessons/" + s.lid + "/review",
        "POST",
        {
          ...body,
          previous_id: current.submission.id,
          previous_version: current.submission.version,
        },
        s.teacherAccount.token,
      );
      const finance = await accountToken(s, ["finance"]);
      await measure(
        "结算待审拦截",
        "finance/settlements/submit",
        "POST",
        { month: "2026-11", version: 0 },
        finance.token,
        409,
      );
      await measure(
        "30人确认原子扣课",
        "submissions/" + p.id + "/confirm",
        "POST",
        { version: 1 },
      );
      const teacherView = (await review(s)).body;
      const revision = await measure(
        "教师仅点评修订",
        "lessons/" + s.lid + "/review",
        "POST",
        {
          ...body,
          kind: "comments",
          previous_id: teacherView.submission.id,
          previous_version: teacherView.submission.version,
          comment_fingerprint: teacherView.comment_fingerprint,
        },
        s.teacherAccount.token,
      );
      await measure(
        "退回点评修订",
        "submissions/" + revision.id + "/return",
        "POST",
        { version: 1, reason: "核对点评" },
      );
      await measure(
        "教师月课酬含调整付款",
        "finance/payroll?month=2026-11",
        "GET",
        null,
        s.teacherAccount.token,
      );
      const pub = (await review(s, s.lid, s.token)).body;
      await measure(
        "员工更正30人点评",
        "lessons/" + s.lid + "/comments",
        "PUT",
        {
          comment_fingerprint: pub.comment_fingerprint,
          public_text: "更正公共",
          people: pub.participants.map((p) => ({
            participant_id: p.id,
            student_id: p.student_id,
            comment: "更正",
          })),
        },
      );
      await measure(
        "学生只读公共及本人",
        "lessons/" + s.lid + "/review",
        "GET",
        null,
        s.student.token,
      );
      await measure(
        "品牌图个人数据",
        "brand-timetable?from=2026-11-09",
        "GET",
        null,
        s.teacherAccount.token,
      );
      await mkdir("work/reports", { recursive: true });
      await writeFile(
        "work/reports/mobile-budget" +
          (process.env.TEST_BUNDLE === "1" ? "-bundle" : "") +
          ".json",
        JSON.stringify(
          {
            budget: 40,
            scale: "30人班课",
            max: Math.max(...results.map((r) => r.queries)),
            results,
          },
          null,
          2,
        ),
      );
    }, 30),
  { timeout: 30000 },
);
test("第五阶段：点评模块关闭仍可提交和确认纯出勤；无草稿内容泄漏", async () =>
  withMobile(async (s) => {
    await s.f.env.CHANNEL_DB.prepare(
      "UPDATE tenant_modules SET enabled=0 WHERE tenant_id=? AND id='comments'",
    )
      .bind(s.t.id)
      .run();
    const v = await check(await review(s));
    assert.deepEqual(v.published, []);
    const p = await check(
      await proposal(s, {
        text: "",
        comment: "",
        extra: {
          homework: "",
          people: v.participants.map((p) => ({
            participant_id: p.id,
            student_id: p.student_id,
            attendance: "attended",
            comment: "",
          })),
        },
      }),
    );
    await check(await decide(s, p.id));
    assert.equal((await details(s, s.lid)).status, "completed");
  }));
test("第五阶段：并发确认同一提案只扣一次；同课跨参与人注入拒绝", async () =>
  withMobile(async (s) => {
    const other = await lesson(s, "2026-11-11T10:00");
    const v = (await review(s)).body,
      otherPart = (await details(s, other)).participants[0];
    const injected = v.participants.map((p) => ({
      participant_id: p.id,
      student_id: p.student_id,
      attendance: "attended",
      comment: "",
    }));
    injected[0] = { ...injected[0], participant_id: otherPart.id };
    await check(await proposal(s, { extra: { people: injected } }), 404);
    await check(
      await proposal(s, {
        extra: { people: Array(v.participants.length).fill(null) },
      }),
      400,
    );
    const proposed = await check(await proposal(s)),
      op = randomId("approve"),
      before = txCount(s);
    const all = await Promise.all([
      mutate(s, "submissions/" + proposed.id + "/confirm", {
        version: 1,
        operation_id: op,
      }),
      mutate(s, "submissions/" + proposed.id + "/confirm", {
        version: 1,
        operation_id: op,
      }),
    ]);
    for (const res of all) await check(res);
    assert.equal(txCount(s), before + s.students.length);
  }));
test("第五阶段：0008预检只读检出异常时间，旧迁移文件保持不变", async () =>
  withMobile(async (s) => {
    const script = await readFile(
        new URL("../scripts/sql/0008_precheck.sql", import.meta.url),
        "utf8",
      ),
      queries = script.split(";").filter((q) => q.trim());
    assert.deepEqual(
      queries
        .slice(0, 2)
        .map((q) => Object.values(s.f.db.raw.prepare(q).get())[0]),
      [0, 0],
    );
    assert.deepEqual(s.f.db.raw.prepare(queries[2]).all(), []);
    const previous = (await details(s, s.lid)).start_at;
    s.f.db.raw
      .prepare("UPDATE lessons SET start_at=? WHERE tenant_id=? AND id=?")
      .run("bad-time", s.t.id, s.lid);
    const changes = s.f.db.raw.prepare("SELECT total_changes() n").get().n;
    assert.equal(Object.values(s.f.db.raw.prepare(queries[1]).get())[0], 1);
    assert.equal(
      s.f.db.raw.prepare("SELECT total_changes() n").get().n,
      changes,
    );
    s.f.db.raw
      .prepare("UPDATE lessons SET start_at=? WHERE tenant_id=? AND id=?")
      .run(previous, s.t.id, s.lid);
  }));
test("第五阶段：未保存缺勤规则，教师旷课提案确认后按GET默认扣课并计酬", async () =>
  withMobile(async (s) => {
    await addRate(s);
    const policies = (await check(await request(s, "absence-policies")))
      .policies;
    assert.equal(
      s.f.db.raw
        .prepare(
          "SELECT COUNT(*) n FROM tenant_settings WHERE tenant_id=? AND id='absence_policies'",
        )
        .get(s.t.id).n,
      0,
    );
    assert.deepEqual(policies.student_no_show, {
      deduct: true,
      teacherPaid: true,
    });
    const before = txCount(s),
      pending = await check(await proposal(s, { attendance: "no_show" }));
    assert.equal(txCount(s), before);
    assert.equal((await check(await payroll(s))).items[0].accrued_amount, 0);
    await check(await decide(s, pending.id));
    assert.equal((await details(s, s.lid)).status, "student_no_show");
    assert.equal((await s.r.businessGet("lessons", s.lid)).teacher_paid, 1);
    assert.equal(txCount(s), before + s.students.length);
    assert.equal((await check(await payroll(s))).items[0].accrued_amount, 200);
    for (const p of (await details(s, s.lid)).participants)
      assert.equal(p.deducted, 1);
  }));

test("第五阶段：课程导出无内部ID和英文状态，时间明确按北京时间显示", async () =>
  withMobile(async (s) => {
    const result = await request(
      s,
      "export?kind=lessons&month=2026-11",
      "GET",
      undefined,
      s.teacherAccount.token,
    );
    await check(result);
    assert.ok(!result.text.includes(s.lid));
    assert.ok(!result.text.includes("课程ID"));
    assert.ok(!result.text.includes(">planned<"));
    assert.ok(result.text.includes("2026-11-10 10:00:00"));
  }));

test("第五阶段：下一节课跨周查询，教师不见他人课，学员跳过自己的请假课", async () =>
  withMobile(async (s) => {
    await status(s, s.lid, "completed");
    const next = await lesson(s, "2026-11-16T09:00");
    const leave = await lesson(s, "2026-11-13T09:00"),
      record = await details(s, leave),
      p = record.participants.find((p) => p.student_id === s.students[0]);
    await check(
      await mutate(s, "credits/lessons/" + leave + "/attendance", {
        lesson_version: record.version,
        participants: [
          { id: p.id, version: p.version, attendance: "student_leave" },
        ],
      }),
    );
    const teacher = (
      await check(
        await request(
          s,
          "schedule-next",
          "GET",
          undefined,
          s.teacherAccount.token,
        ),
      )
    ).record;
    const student = (
      await check(
        await request(s, "schedule-next", "GET", undefined, s.student.token),
      )
    ).record;
    assert.equal(teacher.id, leave);
    assert.equal(student.id, next);
    assert.ok(!JSON.stringify(student).includes(s.students[1]));
    const otherTeacher = await s.create("teachers", { name: "非本人教师" }),
      other = await teacherToken(s, otherTeacher);
    assert.equal(
      (
        await check(
          await request(s, "schedule-next", "GET", undefined, other.token),
        )
      ).record,
      null,
    );
  }));
