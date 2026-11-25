import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./support.mjs";
import { repo } from "../src/server/repo.js";
import { modules } from "../src/server/permissions.js";
import { newPassword, encrypt, phoneIndex } from "../src/server/crypto.js";
import { randomId, bytes, b64, sha } from "../src/server/core.js";
import { schoolFixture } from "./fixtures-school.mjs";
async function create(s, resource, data) {
  const x = await s.call("data/" + resource, "POST", data);
  assert.equal(x.status, 200, x.text);
  assert.ok(x.body.id, x.text);
  return x.body.id;
}
async function materials(s) {
  const teacher = await create(s, "teachers", { name: "教师" }),
    location = await create(s, "locations", { name: "教室", capacity: 40 }),
    category = await create(s, "course_categories", { name: "基础课程" }),
    type = await create(s, "course_types", {
      name: "班课",
      category_id: category,
      format: "group",
      capacity: 30,
    });
  let students = [];
  for (let i = 0; i < 20; i++)
    students.push(await create(s, "students", { name: "学员 " + i }));
  return { teacher, location, category, type, students };
}
const lesson = (m, start = "2026-11-02T09:00") => ({
  teacher_id: m.teacher,
  location_id: m.location,
  course_type_id: m.type,
  start_at: start,
  duration: 45,
  units: 1,
  student_ids: m.students.slice(0, 2),
});
test("第二阶段 HTTP：双机构各20名学员、一周课表、跨机构读取修改删除及全部关联 ID 被拒绝", async () => {
  const f = await fixture();
  try {
    const a = await schoolFixture(f, "a"),
      b = await schoolFixture(f, "b"),
      ma = await materials(a),
      mb = await materials(b);
    for (const s of [a, b])
      assert.equal((await s.call("data/students")).body.items.length, 20);
    for (let i = 0; i < 7; i++) {
      const date = "2026-11-0" + (2 + i);
      await create(a, "lessons", lesson(ma, date + "T09:00"));
      await create(b, "lessons", lesson(mb, date + "T09:00"));
    }
    for (const resource of ["students", "teachers", "locations", "lessons"]) {
      const id = (await b.call("data/" + resource)).body.items[0].id;
      for (const method of ["GET", "PATCH", "DELETE"])
        assert.equal(
          (
            await a.call(
              "data/" + resource + "/" + id,
              method,
              method === "GET" ? undefined : { version: 1, name: "篡改" },
            )
          ).status,
          404,
        );
    }
    for (const [field, id] of [
      ["teacher_id", mb.teacher],
      ["location_id", mb.location],
      ["course_type_id", mb.type],
    ])
      assert.equal(
        (
          await a.call("data/lessons", "POST", {
            ...lesson(ma, "2026-11-10T09:00"),
            [field]: id,
          })
        ).status,
        404,
      );
    assert.equal(
      (
        await a.call("data/lessons", "POST", {
          ...lesson(ma, "2026-11-10T09:00"),
          student_ids: [mb.students[0]],
        })
      ).status,
      404,
    );
    const pack = {
      id: randomId("pkg"),
      student_id: mb.students[0],
      course_type_id: mb.type,
      units_total: 10,
      valid_from: null,
      valid_to: null,
      status: "active",
      deleted_at: null,
    };
    await b.r.commitBusiness(
      await b.r.dataVersion(),
      [{ resource: "packages", data: pack }],
      b.user,
      "packages",
      "fixture",
    );
    assert.equal(
      (
        await a.call("data/lessons", "POST", {
          ...lesson(ma, "2026-11-10T09:00"),
          student_ids: undefined,
          participants: [{ student_id: ma.students[0], package_id: pack.id }],
        })
      ).status,
      404,
    );
    const own = await create(a, "students", {
      name: "可删除",
      tenant_id: b.t.id,
    });
    const row = (await a.call("data/students/" + own)).body.record;
    assert.equal(
      (await a.call("data/students/" + own, "DELETE", { version: row.version }))
        .status,
      200,
    );
    assert.equal((await a.call("data/students/" + own)).status, 404);
    assert.equal((await b.call("data/students/" + own)).status, 404);
  } finally {
    f.restore();
  }
});
test("第二阶段：冲突、不可排时段、线上教室豁免、模板整批回滚与去重、日期报名", async () => {
  const f = await fixture();
  try {
    const s = await schoolFixture(f),
      m = await materials(s);
    const first = await create(s, "lessons", lesson(m));
    let res = await s.call(
      "data/lessons",
      "POST",
      lesson(m, "2026-11-02T09:15"),
    );
    assert.equal(res.body.committed, false);
    assert.ok(res.body.conflicts[0].reasons.includes("教师"));
    assert.equal((await s.call("data/lessons")).body.items.length, 1);
    await create(s, "student_schedule_blocks", {
      student_id: m.students[2],
      weekday: 0,
      start_time: "10:00",
      end_time: "11:00",
      label: "学校课",
    });
    res = await s.call("data/lessons", "POST", {
      ...lesson(m, "2026-11-02T10:00"),
      student_ids: [m.students[2]],
    });
    assert.equal(res.body.committed, false);
    assert.ok(
      res.body.conflicts.some((x) => x.reasons.includes("学员不可排时段")),
    );
    const t = await create(s, "schedule_templates", {
      ...lesson(m),
      weekday: 0,
      start_time: "09:00",
      date_from: "2026-11-01",
      date_to: "2026-11-30",
    });
    await create(s, "schedule_enrollments", {
      template_id: t,
      student_id: m.students[0],
      date_from: "2026-11-01",
      date_to: "2026-11-30",
    });
    res = await s.call("templates/generate", "POST", {
      from: "2026-11-02",
      to: "2026-11-09",
    });
    assert.equal(res.body.committed, false);
    assert.equal((await s.call("data/lessons")).body.items.length, 1);
    await s.call("data/lessons/" + first, "DELETE", { version: 1 });
    res = await s.call("templates/generate", "POST", {
      from: "2026-11-02",
      to: "2026-11-09",
    });
    assert.equal(res.body.generated, 2, res.text);
    res = await s.call("templates/generate", "POST", {
      from: "2026-11-02",
      to: "2026-11-09",
    });
    assert.equal(res.body.generated, 0);
    assert.equal(res.body.skipped, 2);
    const rev = await s.r.dataVersion();
    await create(s, "students", { name: "并发变更" });
    await assert.rejects(
      () =>
        s.r.commitBusiness(
          rev,
          [{ resource: "students", data: { ...awaitableDummy() } }],
          s.user,
          "students",
          "update",
        ),
      (e) => e.status === 409,
    );
    function awaitableDummy() {
      return { id: randomId("rec"), name: "不会写入" };
    }
  } finally {
    f.restore();
  }
});
test("第二阶段：个人账号档案关联同机构、唯一关联、教师学员只见自己、教务开关及归档下线", async () => {
  const f = await fixture();
  try {
    const a = await schoolFixture(f),
      b = await schoolFixture(f, "b"),
      ma = await materials(a),
      mb = await materials(b);
    for (const [role, field, id] of [
      ["teacher", "teacher_id", mb.teacher],
      ["student", "student_id", mb.students[0]],
    ])
      assert.equal(
        (
          await a.call("accounts", "POST", {
            name: "非法关联",
            phone: "13900000009",
            roles: [role],
            [field]: id,
          })
        ).status,
        404,
      );
    const lessonId = await create(a, "lessons", lesson(ma));
    const account = await a.call("accounts", "POST", {
      name: "学员本人",
      phone: "13900000008",
      roles: ["student"],
      student_id: ma.students[0],
    });
    assert.equal(account.status, 201, account.text);
    assert.equal(
      (
        await a.call("accounts", "POST", {
          name: "重复关联",
          phone: "13900000007",
          roles: ["student"],
          student_id: ma.students[0],
        })
      ).status,
      409,
    );
    const stored = await a.r.user(account.body.id);
    const token = b64(bytes(32));
    await a.r.createSession(await sha(token), stored, {
      ip: "x",
      ua: "student",
    });
    f.db.raw
      .prepare("UPDATE users SET must_change=0 WHERE tenant_id=?")
      .run(a.t.id);
    const read = async (p) => {
      const response = await f.request(
        "https://school.test/" + a.t.slug + "/api/" + p,
        { headers: { Cookie: "channel_session=" + token } },
      );
      const text = await response.text();
      return {
        status: response.status,
        body: text.startsWith("{") ? JSON.parse(text) : {},
      };
    };
    const detail = await read("data/lessons/" + lessonId);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.record.participants.length, 1);
    assert.equal((await read("data/students/" + ma.students[1])).status, 404);
    const row = await a.r.businessGet("students", ma.students[0]);
    await a.call("data/students/" + row.id, "PATCH", {
      version: row.version,
      status: "archived",
    });
    assert.equal((await read("me")).status, 401);
  } finally {
    f.restore();
  }
});
test("第二阶段：教师仅自己课程、默认教务不能建教师教室、主管授权后可建、个人档案重新启用", async () => {
  const f = await fixture();
  try {
    const s = await schoolFixture(f),
      m = await materials(s),
      other = await create(s, "teachers", { name: "其他教师" });
    const ownLesson = await create(s, "lessons", lesson(m));
    const foreignLesson = await create(s, "lessons", {
      ...lesson(m, "2026-11-03T09:00"),
      teacher_id: other,
    });
    const teacherAccount = await s.call("accounts", "POST", {
      name: "教师",
      phone: "13900000011",
      roles: ["teacher"],
      teacher_id: m.teacher,
    });
    assert.equal(teacherAccount.status, 201);
    const academic = await s.call("accounts", "POST", {
      name: "教务",
      phone: "13900000012",
      roles: ["academic"],
    });
    assert.equal(academic.status, 201);
    f.db.raw.prepare("UPDATE users SET must_change=0").run();
    async function client(id) {
      const u = await s.r.user(id),
        token = b64(bytes(32));
      await s.r.createSession(await sha(token), u, { ip: "x", ua: "test" });
      return async (path, method = "GET", data) => {
        const response = await f.request(
          "https://school.test/" + s.t.slug + "/api/" + path,
          {
            method,
            headers: {
              Origin: "https://school.test",
              Cookie: "channel_session=" + token,
              "Content-Type": "application/json",
            },
            body: data ? JSON.stringify(data) : undefined,
          },
        );
        const raw = await response.text();
        return {
          status: response.status,
          body: raw.startsWith("{") ? JSON.parse(raw) : null,
        };
      };
    }
    const teacher = await client(teacherAccount.body.id);
    assert.equal((await teacher("data/lessons/" + foreignLesson)).status, 404);
    assert.equal((await teacher("data/lessons/" + ownLesson)).status, 200);
    assert.equal(
      (await teacher("schedule?from=2026-11-02&to=2026-11-09")).body.items
        .length,
      1,
    );
    let academicClient = await client(academic.body.id);
    for (const resource of ["teachers", "locations"])
      assert.equal(
        (await academicClient("data/" + resource, "POST", { name: "未授权" }))
          .status,
        403,
      );
    await s.r.saveRights("academic", "settings", "create", true, {
      id: s.user.id,
      name: "主管",
    });
    academicClient = await client(academic.body.id);
    s.call = await client(s.user.id);
    assert.equal(
      (await academicClient("data/teachers", "POST", { name: "已授权" }))
        .status,
      200,
    );
    const row = await s.r.businessGet("teachers", m.teacher);
    await s.call("data/teachers/" + row.id, "PATCH", {
      version: row.version,
      status: "archived",
    });
    assert.equal((await teacher("me")).status, 401);
    const user = await s.r.user(teacherAccount.body.id);
    assert.equal(
      (
        await s.call("accounts/" + user.id, "PATCH", {
          version: user.version,
          name: user.name,
          roles: ["teacher"],
          active: true,
        })
      ).status,
      400,
    );
    const archived = await s.r.businessGet("teachers", m.teacher);
    await s.call("data/teachers/" + m.teacher, "PATCH", {
      version: archived.version,
      status: "active",
    });
    const fresh = await s.r.user(user.id);
    assert.equal(
      (
        await s.call("accounts/" + user.id, "PATCH", {
          version: fresh.version,
          name: user.name,
          roles: ["teacher"],
          active: true,
        })
      ).status,
      200,
    );
  } finally {
    f.restore();
  }
});
test("第二阶段：线上不占教室、报名起止日期、排序版本、搜索通配符转义与跨机构搜索", async () => {
  const f = await fixture();
  try {
    const a = await schoolFixture(f),
      b = await schoolFixture(f, "b"),
      m = await materials(a),
      teacher2 = await create(a, "teachers", { name: "线上教师" });
    await create(a, "lessons", lesson(m));
    const online = await a.call("data/lessons", "POST", {
      ...lesson(m, "2026-11-02T09:15"),
      teacher_id: teacher2,
      student_ids: [m.students[4]],
      mode: "online",
    });
    assert.equal(online.body.committed, true);
    const template = await create(a, "schedule_templates", {
      teacher_id: m.teacher,
      course_type_id: m.type,
      location_id: m.location,
      weekday: 2,
      start_time: "11:00",
      duration: 45,
      units: 1,
      date_from: "2026-11-01",
      date_to: "2026-11-30",
    });
    await create(a, "schedule_enrollments", {
      template_id: template,
      student_id: m.students[5],
      date_from: "2026-11-10",
      date_to: "2026-11-30",
    });
    const generated = await a.call("templates/generate", "POST", {
      from: "2026-11-04",
      to: "2026-11-11",
    });
    assert.equal(generated.body.generated, 1);
    const rows = (await a.call("schedule?from=2026-11-04&to=2026-11-12")).body
      .items;
    assert.equal(rows.length, 1);
    assert.ok(rows[0].start_at.startsWith("2026-11-11"));
    const reversed = [...m.students.slice(0, 3)]
      .reverse()
      .map((id) => ({ id, version: 1 }));
    assert.equal(
      (
        await a.call("reorder", "PUT", {
          resource: "students",
          records: reversed,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await a.call("reorder", "PUT", {
          resource: "students",
          records: reversed,
        })
      ).status,
      409,
    );
    const own = await create(a, "students", { name: "包含%字面量" });
    await create(b, "students", { name: "包含%字面量" });
    const search = await a.call("data/students?q=%25");
    assert.equal(search.body.items.length, 1);
    assert.equal(search.body.items[0].id, own);
    assert.equal(
      (await a.call("data/students?q=%27%20OR%201%3D1--")).body.items.length,
      0,
    );
  } finally {
    f.restore();
  }
});
test("第二阶段：并发排课重新校验，重叠只写一节，非重叠两节都保存", async () => {
  const f = await fixture();
  try {
    const s = await schoolFixture(f),
      m = await materials(s);
    const overlap = await Promise.all([
      s.call("data/lessons", "POST", lesson(m)),
      s.call("data/lessons", "POST", lesson(m)),
    ]);
    assert.equal(
      overlap.filter((x) => x.body.committed === true).length,
      1,
      JSON.stringify(overlap),
    );
    assert.equal(overlap.filter((x) => x.body.committed === false).length, 1);
    const separate = await Promise.all([
      s.call("data/lessons", "POST", lesson(m, "2026-11-03T09:00")),
      s.call("data/lessons", "POST", lesson(m, "2026-11-03T11:00")),
    ]);
    assert.ok(
      separate.every((x) => x.body.committed === true),
      JSON.stringify(separate),
    );
    assert.equal((await s.call("data/lessons")).body.items.length, 3);
  } finally {
    f.restore();
  }
});
test("第二阶段：档案联系方式加密、主管查看留痕、教务历史授权也不能读取完整号码", async () => {
  const f = await fixture();
  try {
    const s = await schoolFixture(f),
      student = await create(s, "students", {
        name: "隐私验收",
        phone: "13912345670",
        parent_phone: "13912345671",
      });
    const raw = await s.r.businessGet("students", student);
    assert.ok(!raw.phone_enc.includes("13912345670"));
    const response = await s.call("data/students/" + student);
    assert.ok(!JSON.stringify(response.body).includes("13912345670"));
    assert.equal(
      (await s.call("data/students/" + student + "/contact", "POST", {})).body
        .parent_phone,
      "13912345671",
    );
    assert.ok(
      (await s.r.logs("audit", 0)).some((x) => x.action === "reveal_contact"),
    );
    const account = await s.call("accounts", "POST", {
      name: "教务",
      phone: "13900000033",
      roles: ["academic"],
    });
    await s.r.saveRights("academic", "accounts", "reveal_phone", true, {
      id: s.user.id,
      name: "主管",
    });
    f.db.raw.prepare("UPDATE users SET must_change=0").run();
    const user = await s.r.user(account.body.id),
      token = b64(bytes(32));
    await s.r.createSession(await sha(token), user, { ip: "x", ua: "privacy" });
    const denied = await f.request(
      "https://school.test/" +
        s.t.slug +
        "/api/data/students/" +
        student +
        "/contact",
      {
        method: "POST",
        headers: {
          Origin: "https://school.test",
          Cookie: "channel_session=" + token,
          "Content-Type": "application/json",
        },
        body: "{}",
      },
    );
    assert.equal(denied.status, 403);
  } finally {
    f.restore();
  }
});
