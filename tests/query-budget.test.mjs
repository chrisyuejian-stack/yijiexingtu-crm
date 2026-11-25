import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fixture } from "./support.mjs";
import { repo } from "../src/server/repo.js";
import { modules } from "../src/server/permissions.js";
import { newPassword, encrypt, phoneIndex } from "../src/server/crypto.js";
import { randomId, bytes, b64, sha } from "../src/server/core.js";
test("D1 查询预算：30人班课、30个模板整月生成及所有已测接口每请求不超过40次", async () => {
  const f = await fixture();
  try {
    const tenant = {
      id: randomId("ten"),
      slug: "budget-school",
      name: "预算验收",
      type: "其他",
      city: "",
      expires_at: null,
      staff_seat_limit: 100,
      student_seat_limit: 1000,
      contact_enc: null,
    };
    await repo(f.env, null).createTenant(tenant, "fixture", modules);
    const r = repo(f.env, tenant.id),
      user = {
        id: randomId("usr"),
        name: "主管",
        roles: '["supervisor"]',
        phone_hmac: await phoneIndex(f.env, tenant.id, "13912345678"),
        phone_enc: await encrypt(f.env, "13912345678", tenant.id + ":phone"),
        phone_last4: "5678",
        ...(await newPassword(f.env, "BudgetPassword8Za")),
      };
    await r.createUser(user, { id: "fixture", name: "主管" });
    f.db.raw.prepare("UPDATE users SET must_change=0").run();
    const token = b64(bytes(32));
    await r.createSession(await sha(token), user, { ip: "x", ua: "budget" });
    const category = randomId("cat"),
      type = randomId("type"),
      stamp = Date.now(),
      actor = "fixture";
    f.db.raw
      .prepare(
        "INSERT INTO course_categories(tenant_id,id,name,created_at,created_by,updated_at,updated_by) VALUES(?,?,?,?,?,?,?)",
      )
      .run(tenant.id, category, "基础", stamp, actor, stamp, actor);
    f.db.raw
      .prepare(
        "INSERT INTO course_types(tenant_id,id,name,category_id,format,capacity,created_at,created_by,updated_at,updated_by) VALUES(?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        tenant.id,
        type,
        "班课",
        category,
        "group",
        30,
        stamp,
        actor,
        stamp,
        actor,
      );
    const groups = [];
    for (let n = 0; n < 30; n++) {
      const teacher = randomId("tea"),
        room = randomId("room"),
        template = randomId("tpl"),
        students = [];
      f.db.raw
        .prepare(
          "INSERT INTO teachers(tenant_id,id,name,created_at,created_by,updated_at,updated_by) VALUES(?,?,?,?,?,?,?)",
        )
        .run(tenant.id, teacher, "教师" + n, stamp, actor, stamp, actor);
      f.db.raw
        .prepare(
          "INSERT INTO locations(tenant_id,id,name,capacity,created_at,created_by,updated_at,updated_by) VALUES(?,?,?,?,?,?,?,?)",
        )
        .run(tenant.id, room, "教室" + n, 30, stamp, actor, stamp, actor);
      f.db.raw
        .prepare(
          "INSERT INTO schedule_templates(tenant_id,id,teacher_id,course_type_id,location_id,weekday,start_time,duration,units,date_from,date_to,created_at,created_by,updated_at,updated_by) VALUES(?,?,?,?,?,0,?,45,1,?,?,?,?,?,?)",
        )
        .run(
          tenant.id,
          template,
          teacher,
          type,
          room,
          "09:00",
          "2026-10-01",
          "2026-11-30",
          stamp,
          actor,
          stamp,
          actor,
        );
      for (let i = 0; i < 30; i++) {
        const student = randomId("stu");
        students.push(student);
        f.db.raw
          .prepare(
            "INSERT INTO students(tenant_id,id,name,created_at,created_by,updated_at,updated_by) VALUES(?,?,?,?,?,?,?)",
          )
          .run(
            tenant.id,
            student,
            "学员" + n + "-" + i,
            stamp,
            actor,
            stamp,
            actor,
          );
        f.db.raw
          .prepare(
            "INSERT INTO schedule_enrollments(tenant_id,id,template_id,student_id,date_from,date_to,created_at,created_by,updated_at,updated_by) VALUES(?,?,?,?,?,?,?,?,?,?)",
          )
          .run(
            tenant.id,
            randomId("enr"),
            template,
            student,
            "2026-10-01",
            "2026-11-30",
            stamp,
            actor,
            stamp,
            actor,
          );
      }
      groups.push({ teacher, room, template, students });
    }
    const results = [];
    async function call(label, path, method = "GET", data) {
      const response = await f.request(
          "https://school.test/budget-school/api/" + path,
          {
            method,
            headers: {
              Origin: "https://school.test",
              Cookie: "channel_session=" + token,
              "Content-Type": "application/json",
            },
            body: data === undefined ? undefined : JSON.stringify(data),
          },
        ),
        text = await response.text(),
        body = text.startsWith("{") ? JSON.parse(text) : null;
      const queries = Number(response.headers.get("x-test-d1-queries"));
      results.push({
        label,
        method,
        path,
        queries,
        statements: Number(response.headers.get("x-test-d1-statements")),
        status: response.status,
      });
      assert.ok(queries <= 40, label + ": " + queries);
      assert.ok([200, 201].includes(response.status), text);
      return body;
    }
    const m = groups[0],
      base = {
        teacher_id: m.teacher,
        location_id: m.room,
        course_type_id: type,
        start_at: "2026-12-01T09:00",
        duration: 45,
        units: 1,
      };
    await call("新建学员", "data/students", "POST", { name: "新增" });
    const individual = await call(
      "新增一对一课程类型",
      "data/course_types",
      "POST",
      {
        name: "一对一",
        category_id: category,
        format: "individual",
        capacity: 1,
      },
    );
    const single = await call("一对一课程", "data/lessons", "POST", {
      ...base,
      course_type_id: individual.id,
      student_ids: m.students.slice(0, 1),
    });
    assert.equal(single.committed, true);
    const class30 = await call("30人班课", "data/lessons", "POST", {
      ...base,
      start_at: "2026-12-02T09:00",
      student_ids: m.students,
    });
    assert.equal(class30.committed, true);
    await call("30人课程详情", "data/lessons/" + class30.id);
    f.db.raw
      .prepare(
        "UPDATE schedule_templates SET active=0 WHERE tenant_id=? AND id<>?",
      )
      .run(tenant.id, m.template);
    const small = await call(
      "1模板生成4周（30人）",
      "templates/generate",
      "POST",
      { from: "2026-10-01", to: "2026-10-31" },
    );
    assert.equal(small.generated, 4);
    const smallQueries = results.at(-1).queries;
    f.db.raw
      .prepare("UPDATE schedule_templates SET active=1 WHERE tenant_id=?")
      .run(tenant.id);
    const batch = await call(
      "30模板生成整月（900名学员，150节、4500参与记录）",
      "templates/generate",
      "POST",
      { from: "2026-11-01", to: "2026-11-30" },
    );
    assert.equal(batch.generated, 150, JSON.stringify(batch));
    assert.equal(
      results.at(-1).queries,
      smallQueries,
      "模板规模不应增加查询次数",
    );
    await call(
      "整月周课表页（150节）",
      "schedule?from=2026-11-01&to=2026-12-01",
    );
    const repeat = await call("重复生成去重", "templates/generate", "POST", {
      from: "2026-11-01",
      to: "2026-11-30",
    });
    assert.equal(repeat.skipped, 150);
    await call("账号与权限", "me");
    await call("学员列表", "data/students");
    await call("教师列表", "data/teachers");
    await call("固定模板列表", "data/schedule_templates");
    await call("财务/业务日志", "logs");
    const created = await call("编辑用学员新建", "data/students", "POST", {
      name: "版本验收",
    });
    await call("编辑学员", "data/students/" + created.id, "PATCH", {
      version: 1,
      name: "编辑后",
    });
    await call("删除学员", "data/students/" + created.id, "DELETE", {
      version: 2,
    });
    await call("学员搜索", "data/students?q=" + encodeURIComponent("学员"));
    await call("30名学员排序", "reorder", "PUT", {
      resource: "students",
      records: groups[1].students.map((id) => ({ id, version: 1 })),
    });
    await call("学员档案详情", "data/students/" + m.students[0]);
    await call(
      "查看联系方式",
      "data/students/" + m.students[0] + "/contact",
      "POST",
      {},
    );
    await call("缺勤规则", "absence-policies");
    await call("创建教师", "data/teachers", "POST", { name: "新增教师" });
    await call("创建教室", "data/locations", "POST", {
      name: "新增教室",
      capacity: 30,
    });
    const template = await call("新建模板", "data/schedule_templates", "POST", {
      teacher_id: m.teacher,
      course_type_id: type,
      location_id: m.room,
      weekday: 1,
      start_time: "11:00",
      duration: 45,
      units: 1,
      date_from: "2027-01-01",
      date_to: "2027-01-31",
    });
    await call("模板报名", "data/schedule_enrollments", "POST", {
      template_id: template.id,
      student_id: m.students[0],
      date_from: "2027-01-01",
      date_to: "2027-01-31",
    });
    await call("不可排时段", "data/student_schedule_blocks", "POST", {
      student_id: m.students[0],
      weekday: 2,
      start_time: "10:00",
      end_time: "11:00",
      label: "活动",
    });
    const employee = await call("创建员工账号", "accounts", "POST", {
      name: "教务",
      phone: "13900000004",
      roles: ["academic"],
    });
    await call("修改员工账号", "accounts/" + employee.id, "PATCH", {
      version: 1,
      name: "教务",
      roles: ["academic"],
      active: false,
    });
    await call(
      "重置员工密码",
      "accounts/" + employee.id + "/reset-password",
      "POST",
      {},
    );
    await call("创建教师关联账号", "accounts", "POST", {
      name: "教师",
      phone: "13900000005",
      roles: ["teacher"],
      teacher_id: m.teacher,
    });
    await call("登录", "login", "POST", {
      phone: "13912345678",
      password: "BudgetPassword8Za",
      turnstile: "fixture-valid",
    });
    await call("我的设备", "sessions");
    const report = {
      budget: 40,
      counting: "first/all/run 各1次；batch 整体1次，同时另记内部SQL语句数",
      build:
        process.env.TEST_BUNDLE === "1"
          ? "dist/_worker.js"
          : "src/server/worker.js",
      results,
      max: Math.max(...f.db.queryReports.map((x) => x.queries)),
    };
    await mkdir("work/reports", { recursive: true });
    await writeFile(
      "work/reports/query-budget" +
        (process.env.TEST_BUNDLE === "1" ? "-bundle" : "") +
        ".json",
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(results));
    assert.ok(report.max <= 40);
  } finally {
    f.restore();
  }
});
