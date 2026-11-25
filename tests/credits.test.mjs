import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./support.mjs";
import { schoolFixture } from "./fixtures-school.mjs";
import { randomId, sha } from "../src/server/core.js";
import {
  setup,
  request,
  mutate,
  pack,
  lesson,
  details,
  status,
  balance,
  assertInvariant,
  accountToken,
} from "./fixtures-credit.mjs";
test("第三阶段：购买流水、销课、逐人出勤、撤销和删除回补，余额恒等于流水", async () => {
  const f = await fixture();
  try {
    const s = { ...(await setup(f)), f },
      p1 = await pack(s, s.students[0], 3),
      p2 = await pack(s, s.students[1], 3),
      id = await lesson(s);
    let result = await status(s, id, "completed");
    assert.equal(result.status, 200, result.text);
    assert.equal(await balance(s, p1), 2);
    assert.equal(await balance(s, p2), 2);
    let d = await details(s, id);
    result = await mutate(s, "credits/lessons/" + id + "/attendance", {
      lesson_version: d.version,
      participants: [
        {
          id: d.participants.find((p) => p.student_id === s.students[0]).id,
          version: d.participants.find((p) => p.student_id === s.students[0])
            .version,
          attendance: "student_leave",
        },
      ],
    });
    assert.equal(result.status, 200, result.text);
    assert.equal(await balance(s, p1), 3);
    d = await details(s, id);
    result = await mutate(s, "credits/lessons/" + id + "/undo", {
      lesson_version: d.version,
    });
    assert.equal(result.status, 200, result.text);
    assert.equal(await balance(s, p2), 3);
    await status(s, id, "completed");
    d = await details(s, id);
    result = await mutate(s, "credits/lessons/" + id + "/delete", {
      lesson_version: d.version,
    });
    assert.equal(result.status, 200, result.text);
    assert.equal(await balance(s, p1), 3);
    assert.equal(await balance(s, p2), 3);
    assert.equal((await request(s, "data/lessons/" + id)).status, 404);
    await assertInvariant(s);
    assert.throws(() =>
      f.db.raw.exec("UPDATE package_transactions SET delta=999"),
    );
  } finally {
    f.restore();
  }
});
test("第三阶段：旧版缺勤规则、跨包FIFO、整体收费、补课免重复扣与原课联动", async () => {
  const f = await fixture();
  try {
    const s = { ...(await setup(f, 1)), f },
      first = await pack(s, s.students[0], 0.5),
      second = await pack(s, s.students[0], 5),
      id = await lesson(s);
    await status(s, id, "student_no_show");
    assert.equal(await balance(s, first), 0);
    assert.equal(await balance(s, second), 4.5);
    await status(s, id, "student_leave");
    assert.equal(await balance(s, first), 0.5);
    assert.equal(await balance(s, second), 5);
    await s.r.saveSetting(
      "absence_policies",
      {
        student_leave: { deduct: true },
        student_no_show: { deduct: false },
        teacher_leave: { deduct: true, teacherPaid: true },
        cancelled: { deduct: true, teacherPaid: false },
      },
      { id: s.user.id, name: "主管" },
    );
    await status(s, id, "student_leave");
    assert.equal(await balance(s, second), 4.5);
    let source = await details(s, id);
    const makeup = await mutate(s, "credits/makeups", {
      original_participant_id: source.participants.find(
        (p) => p.student_id === s.students[0],
      ).id,
      new_lesson: {
        start_at: "2026-11-12T09:00",
        teacher_id: s.teacher,
        location_id: s.room,
        duration: 45,
        units: 1,
      },
    });
    assert.equal(makeup.status, 200, makeup.text);
    await status(s, makeup.body.lesson_id, "completed");
    assert.equal(await balance(s, second), 4.5);
    await status(s, id, "teacher_leave");
    assert.equal(await balance(s, first), 0);
    assert.equal(await balance(s, second), 4.5); // 原课返还，补课改为扣一次。
    assert.equal((await s.r.businessGet("lessons", id)).teacher_paid, 1);
    await status(s, makeup.body.lesson_id, "planned");
    assert.equal(await balance(s, first), 0.5);
    assert.equal(await balance(s, second), 5);
    await status(s, id, "cancelled");
    assert.equal(await balance(s, second), 5);
    const own = await s.r.businessGet("students", s.students[0]);
    await s.call("data/students/" + own.id, "PATCH", {
      version: own.version,
      billing_mode: "overall",
    });
    await status(s, id, "completed");
    assert.equal(await balance(s, second), 5);
    await assertInvariant(s);
  } finally {
    f.restore();
  }
});
test("第三阶段：禁止欠课时的学员单独待销、幂等、课时转换及跨机构引用拒绝", async () => {
  const f = await fixture();
  try {
    const s = { ...(await setup(f)), f },
      p = await pack(s, s.students[0], 3),
      id = await lesson(s),
      before = f.db.raw
        .prepare("SELECT count(*) n FROM package_transactions")
        .get().n;
    assert.equal((await s.call("settings", "PUT", { key: "max_debt_units", value: 0 })).status, 200);
    const partial = await status(s, id, "completed");
    assert.equal(partial.status, 200);
    assert.equal(partial.body.blocked[0].student_id, s.students[1]);
    assert.equal(
      f.db.raw.prepare("SELECT count(*) n FROM package_transactions").get().n,
      before + 1,
    );
    assert.equal((await details(s, id)).participants.find(
      (x) => x.student_id === s.students[1],
    ).attendance, "planned");
    await pack(s, s.students[1], 3);
    let d = await details(s, id),
      body = {
        operation_id: randomId("op"),
        lesson_version: d.version,
        status: "completed",
      };
    const a = await request(
        s,
        "credits/lessons/" + id + "/status",
        "POST",
        body,
      ),
      b = await request(s, "credits/lessons/" + id + "/status", "POST", body);
    assert.equal(a.status, 200, a.text);
    assert.deepEqual(a.body, b.body);
    assert.equal(await balance(s, p), 2);
    const type2 = await s.create("course_types", {
        name: "第二课程",
        category_id: s.cat,
        format: "group",
        capacity: 40,
      }),
      to = await pack(s, s.students[0], 0, type2);
    const moved = await mutate(s, "credits/transfer", {
      from_package_id: p,
      to_package_id: to,
      from_units: 1,
      to_units: 2,
      reason: "跨课程转换",
    });
    assert.equal(moved.status, 200, moved.text);
    assert.equal(await balance(s, p), 1);
    assert.equal(await balance(s, to), 2);
    const t = await schoolFixture(f, "foreign");
    const forbidden = await request(
      { ...s, t: t.t, token: t.token },
      "credits/packages/" + p,
    );
    assert.equal(forbidden.status, 404);
    await assertInvariant(s);
  } finally {
    f.restore();
  }
});
test("第三阶段：教务金额按HTTP裁剪且提交不覆盖；关闭学员缴费可见后无数据", async () => {
  const f = await fixture();
  try {
    const s = { ...(await setup(f, 1)), f },
      p = await pack(s),
      academic = await accountToken(s, ["academic"]),
      student = await accountToken(s, ["student"], s.students[0]);
    let response = await request(
      s,
      "credits/packages/" + p,
      "GET",
      undefined,
      academic.token,
    );
    assert.equal(response.status, 200);
    assert.ok(!JSON.stringify(response.body).match(/unit_price|"amount"/));
    response = await mutate(
      s,
      "credits/packages/" + p,
      { version: 1, units_total: 10, unit_price: 1, amount: 1 },
      "PATCH",
      academic.token,
    );
    assert.equal(response.status, 200, response.text);
    assert.equal((await s.r.businessGet("packages", p)).unit_price, 10000);
    assert.equal((await s.r.businessGet("packages", p)).amount, 100000);
    const pay = await mutate(s, "credits/payments", {
      student_id: s.students[0],
      package_id: p,
      amount: 500,
      paid_at: "2026-11-02",
      method: "转账",
    });
    assert.equal(pay.status, 200, pay.text);
    assert.equal(
      (await request(s, "credits/payments", "GET", undefined, academic.token))
        .status,
      403,
    );
    await s.call("settings", "PUT", {
      key: "student_view_payments",
      value: true,
    });
    response = await request(
      s,
      "credits/payments",
      "GET",
      undefined,
      student.token,
    );
    assert.equal(response.status, 200);
    assert.equal(response.body.items[0].amount, 500);
    await s.call("settings", "PUT", {
      key: "student_view_payments",
      value: false,
    });
    response = await request(
      s,
      "credits/payments/" + pay.body.id,
      "GET",
      undefined,
      student.token,
    );
    assert.equal(response.status, 403);
    assert.ok(!response.text.includes("500"));
    await s.call("settings", "PUT", {
      key: "student_view_balance",
      value: false,
    });
    assert.equal(
      (await request(s, "credits/packages", "GET", undefined, student.token))
        .status,
      403,
    );
  } finally {
    f.restore();
  }
});
test("第三阶段：锁月拒绝、乐观并发、跨机构写入及混合班课补课状态", async () => {
  const f = await fixture();
  try {
    const s = { ...(await setup(f, 2)), f };
    for (const student of s.students) await pack(s, student, 10);
    const original = await lesson(s);
    await status(s, original, "student_leave");
    const source = await details(s, original),
      target = await lesson(s, "2026-11-15T09:00", [s.students[1]]);
    const linked = await mutate(s, "credits/makeups", {
      original_participant_id: source.participants.find(
        (p) => p.student_id === s.students[0],
      ).id,
      target_lesson_id: target,
    });
    assert.equal(linked.status, 200, linked.text);
    let d = await details(s, target);
    const added = d.participants.find((p) => p.student_id === s.students[0]);
    assert.equal(
      (
        await mutate(s, "credits/lessons/" + target + "/attendance", {
          lesson_version: d.version,
          participants: [
            { id: added.id, version: added.version, attendance: "attended" },
          ],
        })
      ).status,
      200,
    );
    await status(s, original, "student_no_show");
    assert.equal((await details(s, target)).status, "completed");
    assert.equal(
      (await details(s, target)).participants.find(
        (p) => p.student_id === s.students[1],
      ).attendance,
      "planned",
    );
    const old = await details(s, target);
    const stale = await mutate(s, "credits/lessons/" + target + "/undo", {
      lesson_version: old.version - 1,
    });
    assert.equal(stale.status, 409);
    const foreign = await setup(f, 1, "foreign");
    const bad = await mutate(s, "credits/payments", {
      student_id: foreign.students[0],
      amount: 10,
    });
    assert.equal(bad.status, 404);
    const revision = await s.r.dataVersion();
    await s.r.commitBusiness(
      revision,
      [
        {
          resource: "settlements",
          data: {
            id: randomId("settle"),
            month: "2026-11",
            locked: 1,
            summary: "{}",
            deleted_at: null,
          },
        },
      ],
      { id: s.user.id, name: "主管" },
      "settlements",
      "fixture_lock",
    );
    d = await details(s, target);
    assert.equal(
      (
        await mutate(s, "credits/lessons/" + target + "/undo", {
          lesson_version: d.version,
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await mutate(s, "credits/adjust", {
          package_id: (await request(s, "credits/packages")).body.items[0].id,
          delta: 1,
          reason: "锁月拒绝",
        })
      ).status,
      409,
    );
    await assertInvariant(s);
  } finally {
    f.restore();
  }
});
test("第三阶段：重复请求并发只扣一次；授予日志读取也不能绕过金额裁剪", async () => {
  const f = await fixture();
  try {
    const s = { ...(await setup(f, 1)), f },
      p = await pack(s),
      id = await lesson(s),
      d = await details(s, id),
      body = {
        operation_id: randomId("op"),
        lesson_version: d.version,
        status: "completed",
      };
    const results = await Promise.all([
      request(s, "credits/lessons/" + id + "/status", "POST", body),
      request(s, "credits/lessons/" + id + "/status", "POST", body),
    ]);
    for (const res of results) assert.equal(res.status, 200, res.text);
    assert.equal(await balance(s, p), 9);
    assert.deepEqual(results[0].body, results[1].body);
    const academic = await accountToken(s, ["academic"]);
    await s.r.saveRights("academic", "logs", "read", true, {
      id: s.user.id,
      name: "主管",
    });
    await s.r.createSession(await sha(s.token), s.user, {
      ip: "test",
      ua: "credit",
    });
    await s.r.createSession(
      await sha(academic.token),
      await s.r.user(academic.id),
      { ip: "test", ua: "credit" },
    );
    const logs = await request(s, "logs", "GET", undefined, academic.token);
    assert.equal(logs.status, 200, logs.text);
    for (const item of logs.body.items)
      for (const key of ["before_json", "after_json"])
        if (item[key])
          assert.ok(
            !JSON.stringify(JSON.parse(item[key])).match(
              /"(?:amount|unit_price|teacher_cost|salary)"/,
            ),
          );
    assert.equal(
      (
        await request(
          s,
          "credits/transactions/" +
            (await request(s, "credits/transactions")).body.items[0].id,
          "PATCH",
          { delta: 999 },
        )
      ).status,
      404,
    );
    await assertInvariant(s);
  } finally {
    f.restore();
  }
});
test("第三阶段：HTTP结果逐项对照旧包最终生效的扣课与余额函数", async () => {
  const { legacyCreditOracle } = await import("./fixtures-legacy-credit.mjs"),
    f = await fixture();
  try {
    const s = { ...(await setup(f, 1)), f },
      p1 = await pack(s, s.students[0], 0.5),
      p2 = await pack(s, s.students[0], 5),
      id = await lesson(s),
      d = await details(s, id),
      oracle = legacyCreditOracle({
        settings: { absencePolicies: {} },
        students: [{ id: s.students[0], name: "学员", billingMode: "package" }],
        lessons: [{ id, units: 1, courseTypeId: s.type, status: "planned" }],
        lessonParticipants: [
          {
            id: d.participants[0].id,
            lessonId: id,
            studentId: s.students[0],
            attendance: "planned",
            deducted: 0,
            makeupFor: null,
          },
        ],
        packages: [
          {
            id: p1,
            studentId: s.students[0],
            courseTypeId: s.type,
            total: 0.5,
            date: "2026-01-02",
          },
          {
            id: p2,
            studentId: s.students[0],
            courseTypeId: s.type,
            total: 5,
            date: "2026-01-03",
          },
        ],
        packageTransactions: [],
      });
    for (const policies of [
      {},
      { student_leave: { deduct: true }, student_no_show: { deduct: false } },
      {
        student_leave: { deduct: false },
        student_no_show: { deduct: true },
        teacher_leave: { deduct: true },
        cancelled: { deduct: true },
      },
    ]) {
      oracle.db.settings.absencePolicies = policies;
      await s.r.saveSetting("absence_policies", policies, {
        id: s.user.id,
        name: "主管",
      });
      for (const value of [
        "completed",
        "student_leave",
        "student_no_show",
        "teacher_leave",
        "cancelled",
        "planned",
      ]) {
        oracle.apply(id, value);
        const result = await status(s, id, value);
        assert.equal(result.status, 200, result.text);
        assert.equal(await balance(s, p1), oracle.balance(p1));
        assert.equal(await balance(s, p2), oracle.balance(p2));
        const live = await s.r.businessGet("lessons", id);
        assert.equal(live.status, oracle.db.lessons[0].status);
        const part = (await details(s, id)).participants[0];
        assert.equal(part.deducted, oracle.db.lessonParticipants[0].deducted);
      }
    }
  } finally {
    f.restore();
  }
});
