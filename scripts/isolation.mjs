import assert from "node:assert/strict";
import { writeFile, mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { crc32, deflateSync } from "node:zlib";
export async function runIsolation({
  request = fetch,
  baseUrl,
  consoleUrl,
  adminCookie,
  accessJwt,
  turnstileToken,
  phase = 8,
}) {
  const report = {
    phase,
    at: new Date().toISOString(),
    environment: new URL(baseUrl).origin,
    results: [],
  };
  const run = async (name, fn) => {
    try {
      await fn();
      report.results.push({ name, status: "PASS" });
    } catch (e) {
      report.results.push({ name, status: "FAIL", detail: e.message });
    }
  };
  const pending = (name) =>
    report.results.push({ name, status: "NOT_IMPLEMENTED" });
  const call = async (
    url,
    { method = "GET", data, cookie = "", console = false } = {},
  ) => {
    const origin = new URL(url).origin;
    const headers = { "User-Agent": "channel-isolation-audit/1.0" };
    if (cookie) headers.Cookie = cookie;
    if (console) {
      headers.Cookie = adminCookie;
      headers["Cf-Access-Jwt-Assertion"] = accessJwt;
    }
    if (method !== "GET") {
      headers.Origin = origin;
      headers["Content-Type"] = "application/json";
    }
    const response = await request(url, {
      method,
      headers,
      body: data === undefined ? undefined : JSON.stringify(data),
      redirect: "manual",
    });
    const text = await response.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    return {
      status: response.status,
      body,
      text,
      headers: response.headers,
      cookie: (response.headers.get("set-cookie") || "").split(";")[0],
    };
  };
  const con = (p, method = "GET", data) =>
    call(consoleUrl + "/api/" + p, { method, data, console: true });
  const challengeFor = async (t) =>
    typeof turnstileToken === "function"
      ? await turnstileToken({
          baseUrl,
          slug: t.slug,
          phone: t.phone || "13900000001",
        })
      : turnstileToken;
  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 10);
  const fixtures = [];
  for (const letter of ["a", "b"]) {
    const slug = "audit-" + letter + "-" + suffix;
    const created = await con("tenants", "POST", {
      slug,
      name: "隔离验收机构 " + letter,
      type: "其他",
      city: "",
      expires_at: null,
      staff_seat_limit: 20,
      student_seat_limit: 20,
    });
    assert.equal(created.status, 201, "控制台创建测试机构失败");
    const id = created.body.id;
    const account = await con("tenants/" + id + "/supervisors", "POST", {
      name: "验收主管 " + letter,
      phone: "13900000001",
      roles: ["supervisor"],
    });
    assert.equal(account.status, 201, "创建主管失败");
    fixtures.push({
      id,
      slug,
      user: account.body.id,
      password: account.body.temporary_password,
    });
  }
  const [a, b] = fixtures;
  const tenantCall = (t, p, method = "GET", data, cookie = t.cookie) =>
    call(baseUrl + "/" + t.slug + "/api/" + p, { method, data, cookie });
  async function login(t, password = t.password) {
    return tenantCall(
      t,
      "login",
      "POST",
      {
        phone: t.phone || "13900000001",
        password,
        turnstile: await challengeFor(t),
      },
      "",
    );
  }
  for (const t of fixtures) {
    let result = await login(t);
    assert.equal(result.status, 200);
    t.cookie = result.cookie;
    result = await tenantCall(t, "password", "POST", {
      old_password: t.password,
      password: "AuditStrong9Zx",
    });
    assert.equal(result.status, 200);
    t.password = "AuditStrong9Zx";
    result = await login(t);
    assert.equal(result.status, 200);
    t.cookie = result.cookie;
  }
  await run("7.7-01 A 会话访问 B 接口被拒绝", async () =>
    assert.equal(
      (await tenantCall(b, "accounts", "GET", undefined, a.cookie)).status,
      404,
    ),
  );
  await run("7.7-02 A 读取/修改 B 账号 ID 返回不存在", async () => {
    assert.equal((await tenantCall(a, "accounts/" + b.user)).status, 404);
    assert.equal(
      (
        await tenantCall(a, "accounts/" + b.user, "PATCH", {
          name: "错误",
          roles: ["academic"],
          active: true,
          version: 1,
        })
      ).status,
      404,
    );
  });
  let materialA,
    materialB,
    studentScope,
    academicScope,
    courseTeacherSession,
    isolationLessonId;
  if (phase >= 2) {
    const seed = async (t) => {
      const create = async (resource, data) => {
        const result = await tenantCall(t, "data/" + resource, "POST", data);
        assert.equal(result.status, 200, result.text);
        assert.ok(result.body.id);
        return result.body.id;
      };
      const student = await create("students", { name: "隔离验收学员" }),
        teacher = await create("teachers", { name: "隔离验收教师" }),
        location = await create("locations", {
          name: "隔离验收教室",
          capacity: 20,
        }),
        category = await create("course_categories", { name: "隔离验收课程" }),
        type = await create("course_types", {
          name: "验收班课",
          category_id: category,
          format: "group",
          capacity: 20,
        }),
        pack = await create("packages", {
          student_id: student,
          course_type_id: type,
          units_total: 0,
        });
      return { student, teacher, location, type, pack };
    };
    let ma, mb;
    await run("第二阶段双机构资料准备", async () => {
      ma = await seed(a);
      mb = await seed(b);
      materialA = ma;
      materialB = mb;
    });
    await run("7.7-02 业务读取、修改、删除跨机构 ID 均返回不存在", async () => {
      for (const method of ["GET", "PATCH", "DELETE"])
        assert.equal(
          (
            await tenantCall(
              a,
              "data/students/" + mb.student,
              method,
              method === "GET" ? undefined : { version: 1, name: "篡改" },
            )
          ).status,
          404,
        );
      const record = await tenantCall(a, "data/students", "POST", {
        name: "删除验收",
      });
      assert.equal(
        (
          await tenantCall(a, "data/students/" + record.body.id, "DELETE", {
            version: 1,
          })
        ).status,
        200,
      );
      assert.equal(
        (await tenantCall(a, "data/students/" + record.body.id)).status,
        404,
      );
    });
    await run(
      "7.7-03 课程跨机构学员、教师、教室、课时包引用均拒绝",
      async () => {
        const base = {
          start_at: "2026-11-02T09:00",
          duration: 45,
          units: 1,
          teacher_id: ma.teacher,
          location_id: ma.location,
          course_type_id: ma.type,
          student_ids: [ma.student],
        };
        for (const patch of [
          { teacher_id: mb.teacher },
          { location_id: mb.location },
          { student_ids: [mb.student] },
          {
            participants: [{ student_id: ma.student, package_id: mb.pack }],
            student_ids: undefined,
          },
        ])
          assert.equal(
            (await tenantCall(a, "data/lessons", "POST", { ...base, ...patch }))
              .status,
            404,
          );
      },
    );
    await run("第二阶段个人账号跨机构档案关联拒绝", async () => {
      for (const item of [
        { roles: ["teacher"], teacher_id: mb.teacher },
        { roles: ["student"], student_id: mb.student },
      ])
        assert.equal(
          (
            await tenantCall(a, "accounts", "POST", {
              name: "非法关联",
              phone: "13900000004",
              ...item,
            })
          ).status,
          404,
        );
    });
    const personalSession = async (role, id, phone) => {
      const result = await tenantCall(a, "accounts", "POST", {
        name: "范围验收",
        phone,
        roles: [role],
        [role + "_id"]: id,
      });
      assert.equal(result.status, 201, result.text);
      const person = { ...a, phone, password: result.body.temporary_password };
      let logged = await login(person);
      assert.equal(logged.status, 200);
      person.cookie = logged.cookie;
      assert.equal(
        (
          await tenantCall(person, "password", "POST", {
            old_password: person.password,
            password: "PersonalScope8Za",
          })
        ).status,
        200,
      );
      person.password = "PersonalScope8Za";
      logged = await login(person);
      assert.equal(logged.status, 200);
      person.cookie = logged.cookie;
      return person;
    };
    const create = async (resource, data) => {
      const result = await tenantCall(a, "data/" + resource, "POST", data);
      assert.equal(result.status, 200, result.text);
      return result.body.id;
    };
    const otherTeacher = await create("teachers", { name: "其他教师范围验收" }),
      otherStudent = await create("students", { name: "其他学员范围验收" });
    const base = {
      start_at: "2026-11-02T09:00",
      teacher_id: ma.teacher,
      course_type_id: ma.type,
      location_id: ma.location,
      duration: 45,
      units: 1,
      student_ids: [ma.student, otherStudent],
    };
    const ownLesson = await create("lessons", base),
      otherLesson = await create("lessons", {
        ...base,
        start_at: "2026-11-03T09:00",
        teacher_id: otherTeacher,
        student_ids: [otherStudent],
      });
    await run("7.7-06 教师不能读取其他教师课程（HTTP）", async () => {
      const person = await personalSession(
        "teacher",
        ma.teacher,
        "13900000006",
      );
      assert.equal(
        (await tenantCall(person, "data/lessons/" + otherLesson)).status,
        404,
      );
      if (person.phone === "13900000007") studentScope = person;
      if (person.phone === "13900000006") {
        courseTeacherSession = person;
        isolationLessonId = ownLesson;
      }
      const own = await tenantCall(person, "data/lessons/" + ownLesson);
      assert.equal(own.status, 200);
      const roster = await tenantCall(person, "c3/teacher-students");
      assert.equal(roster.status, 200, roster.text);
      assert.ok(
        roster.body.items.every((x) =>
          [ma.student, otherStudent].includes(x.student_id),
        ),
      );
      assert.ok(!/"(?:balance|amount|unit_price|phone)"/.test(roster.text));
      assert.equal(
        (await tenantCall(person, "c3/teacher-students/" + mb.student)).status,
        404,
      );
      const history = await tenantCall(
        person,
        "c3/teacher-students/" + ma.student,
      );
      assert.equal(history.status, 200, history.text);
      assert.ok(history.body.items.every((x) => x.id === ownLesson));
      const list = await tenantCall(
        person,
        "schedule?from=2026-11-01&to=2026-11-08",
      );
      assert.deepEqual(
        list.body.items.map((x) => x.id),
        [ownLesson],
      );
    });
    await run("7.7-07 学员不能读取他人课程或同学名单（HTTP）", async () => {
      const person = await personalSession(
        "student",
        ma.student,
        "13900000007",
      );
      assert.equal(
        (await tenantCall(person, "data/lessons/" + otherLesson)).status,
        404,
      );
      if (person.phone === "13900000007") studentScope = person;
      if (person.phone === "13900000006") {
        courseTeacherSession = person;
        isolationLessonId = ownLesson;
      }
      const own = await tenantCall(person, "data/lessons/" + ownLesson);
      assert.equal(own.status, 200);
      assert.equal(own.body.record.participants.length, 1);
      assert.equal(
        (await tenantCall(person, "c3/teacher-students")).status,
        403,
      );
      const comments = await tenantCall(person, "c3/student-comments");
      assert.equal(comments.status, 200, comments.text);
      assert.ok(!comments.text.includes(otherStudent));
      assert.equal(own.body.record.participants[0].student_id, ma.student);
      assert.ok(!JSON.stringify(own.body).includes(otherStudent));
      const list = await tenantCall(
        person,
        "schedule?from=2026-11-01&to=2026-11-08",
      );
      assert.deepEqual(
        list.body.items.map((x) => x.id),
        [ownLesson],
      );
    });
  } else {
    pending("7.7-02 业务记录删除：第二阶段开放后执行");
    pending("7.7-03 课程关联跨机构学员/教师/教室/课时包 ID");
  }
  let createdUser;
  await run("7.7-04 客户端 tenant_id/created_by/role 不可信", async () => {
    const result = await tenantCall(a, "accounts", "POST", {
      name: "<img src=x onerror=alert(1)>",
      phone: "13900000002",
      roles: ["academic"],
      tenant_id: b.id,
      created_by: "forged",
      role: "supervisor",
    });
    assert.equal(result.status, 201);
    createdUser = {
      id: result.body.id,
      password: result.body.temporary_password,
      phone: "13900000002",
    };
    assert.equal(
      (await tenantCall(b, "accounts/" + createdUser.id)).status,
      404,
    );
    const stored = await tenantCall(a, "accounts/" + createdUser.id);
    assert.deepEqual(stored.body.user.roles, ["academic"]);
  });
  if (phase < 4) pending("7.7-05 导出、报表、业务搜索：相关业务开放后执行");
  if (phase < 4) pending("7.7-06 教师课酬范围隔离：第四阶段执行");
  if (phase < 2) pending("7.7-07 学员课程与同学名单：第二阶段执行");
  if (phase < 3) pending("7.7-08 关闭缴费后学员无法读取数据");
  await run("7.7-09 教务默认权限及无金额的当前接口", async () => {
    const academic = { ...a, ...createdUser };
    academicScope = academic;
    const logged = await login(academic);
    assert.equal(logged.status, 200);
    academic.cookie = logged.cookie;
    await tenantCall(academic, "password", "POST", {
      old_password: academic.password,
      password: "AcademicStrong8Z",
    });
    academic.password = "AcademicStrong8Z";
    academic.cookie = (await login(academic)).cookie;
    const result = await tenantCall(academic, "me");
    assert.equal(result.status, 200);
    assert.equal(result.body.policy.rights.length, 0);
    assert.equal((await tenantCall(academic, "accounts")).status, 403);
    assert.ok(
      !/"(?:amount|unit_price|rate|cost|salary)"/.test(
        JSON.stringify(result.body),
      ),
    );
  });
  if (phase >= 3) {
    const operation = () => "iso_" + crypto.randomUUID();
    await run("7.7-09 课时包金额对教务裁剪且伪造写入无效（HTTP）", async () => {
      const made = await tenantCall(a, "credits/packages", "POST", {
        operation_id: operation(),
        student_id: materialA.student,
        course_type_id: materialA.type,
        units_total: 10,
        unit_price: 200,
        amount: 2000,
      });
      assert.equal(made.status, 200, made.text);
      for (const path of [
        "credits/packages",
        "credits/packages/" + made.body.id,
        "data/packages/" + made.body.id,
      ]) {
        const got = await tenantCall(academicScope, path);
        assert.equal(got.status, 200, got.text);
        assert.ok(!/"(?:unit_price|amount|price)"/.test(got.text));
      }
      assert.equal(
        (
          await tenantCall(
            academicScope,
            "credits/packages/" + made.body.id,
            "PATCH",
            {
              operation_id: operation(),
              version: 1,
              units_total: 10,
              unit_price: 1,
              amount: 1,
            },
          )
        ).status,
        200,
      );
      const saved = await tenantCall(a, "credits/packages/" + made.body.id);
      assert.equal(saved.body.record.amount, 2000);
      assert.equal(saved.body.record.unit_price, 200);
      assert.equal(
        (await tenantCall(b, "credits/packages/" + made.body.id)).status,
        404,
      );
    });
    await run("7.7-08 缴费开关关闭后学员列表和详情均拒绝（HTTP）", async () => {
      const paid = await tenantCall(a, "credits/payments", "POST", {
        operation_id: operation(),
        student_id: materialA.student,
        amount: 345.67,
        paid_at: "2026-11-02",
        method: "转账",
      });
      assert.equal(paid.status, 200, paid.text);
      assert.equal(
        (
          await tenantCall(a, "settings", "PUT", {
            key: "student_view_payments",
            value: true,
          })
        ).status,
        200,
      );
      const visible = await tenantCall(
        studentScope,
        "credits/payments/" + paid.body.id,
      );
      assert.equal(visible.status, 200, visible.text);
      assert.equal(visible.body.record.amount, 345.67);
      const peer = await tenantCall(a, "data/students", "POST", {
        name: "缴费范围验收同学",
      });
      assert.equal(peer.status, 200, peer.text);
      const peerPay = await tenantCall(a, "credits/payments", "POST", {
        operation_id: operation(),
        student_id: peer.body.id,
        amount: 123,
        paid_at: "2026-11-02",
      });
      assert.equal(peerPay.status, 200, peerPay.text);
      assert.equal(
        (await tenantCall(studentScope, "credits/payments/" + peerPay.body.id))
          .status,
        404,
      );
      const list = await tenantCall(
        studentScope,
        "credits/payments?student_id=" + peer.body.id,
      );
      assert.equal(list.status, 200, list.text);
      assert.ok(
        list.body.items.every((item) => item.student_id === materialA.student),
      );

      assert.equal(
        (await tenantCall(academicScope, "credits/payments")).status,
        403,
      );
      await tenantCall(a, "settings", "PUT", {
        key: "student_view_payments",
        value: false,
      });
      for (const path of [
        "credits/payments",
        "credits/payments/" + paid.body.id,
      ]) {
        const hidden = await tenantCall(studentScope, path);
        assert.equal(hidden.status, 403, hidden.text);
        assert.ok(!hidden.text.includes("345.67"));
      }
      assert.equal(
        (await tenantCall(b, "credits/payments/" + paid.body.id)).status,
        404,
      );
    });
  }
  if (phase < 4) pending("7.7-09 课酬、财务报表金额裁剪：第四阶段执行");
  if (phase >= 4) {
    const op = () => "iso_" + crypto.randomUUID();
    let financialSession, financialRate;
    await run("第四阶段财务准备与跨机构关联拒绝（HTTP）", async () => {
      const account = await tenantCall(a, "accounts", "POST", {
        name: "财务验收",
        phone: "13900000008",
        roles: ["finance"],
      });
      assert.equal(account.status, 201, account.text);
      financialSession = {
        ...a,
        phone: "13900000008",
        password: account.body.temporary_password,
      };
      financialSession.cookie = (await login(financialSession)).cookie;
      assert.equal(
        (
          await tenantCall(financialSession, "password", "POST", {
            old_password: financialSession.password,
            password: "FinanceStrong8Za",
          })
        ).status,
        200,
      );
      financialSession.password = "FinanceStrong8Za";
      financialSession.cookie = (await login(financialSession)).cookie;
      const made = await tenantCall(a, "finance/rates", "POST", {
        operation_id: op(),
        teacher_id: materialA.teacher,
        course_type_id: materialA.type,
        rate: 95.25,
        rate_basis: "legacy",
        effective_from: "2026-01-01",
        effective_to: "2026-12-31",
      });
      assert.equal(made.status, 200, made.text);
      financialRate = made.body.id;
      for (const data of [
        { teacher_id: materialB.teacher, course_type_id: materialA.type },
        { teacher_id: materialA.teacher, course_type_id: materialB.type },
      ])
        assert.equal(
          (
            await tenantCall(a, "finance/rates", "POST", {
              operation_id: op(),
              rate: 1,
              ...data,
            })
          ).status,
          404,
        );
      for (const method of ["GET", "PATCH", "DELETE"])
        assert.equal(
          (
            await tenantCall(
              b,
              "finance/rates/" + financialRate,
              method,
              method === "GET"
                ? undefined
                : { operation_id: op(), version: 1, rate: 1 },
            )
          ).status,
          404,
        );
    });
    await run(
      "7.7-05 财务报表、课程搜索和Excel导出不包含B（HTTP）",
      async () => {
        const report = await tenantCall(a, "finance/report?month=2026-11");
        assert.equal(report.status, 200, report.text);
        assert.ok(!report.text.includes(materialB.teacher));
        assert.ok(!report.text.includes(materialB.student));
        const search = await tenantCall(a, "data/students?q=隔离验收");
        assert.equal(search.status, 200);
        assert.ok(!search.text.includes(materialB.student));
        for (const kind of ["lessons", "finance", "report", "packages"]) {
          const download = await tenantCall(
            a,
            "export?kind=" + kind + "&month=2026-11",
          );
          assert.equal(download.status, 200);
          assert.ok(download.text.startsWith("PK"));
          assert.ok(!download.text.includes(materialB.teacher));
          assert.ok(!download.text.includes(materialB.student));
        }
      },
    );
    await run("7.7-06 教师只能读和导出本人课酬（HTTP）", async () => {
      const result = await tenantCall(
        courseTeacherSession,
        "finance/payroll?month=2026-11",
      );
      assert.equal(result.status, 200, result.text);
      assert.ok(
        result.body.items.every((row) => row.teacher_id === materialA.teacher),
      );
      assert.equal(
        (
          await tenantCall(
            courseTeacherSession,
            "finance/payroll?month=2026-11&teacher_id=" + materialB.teacher,
          )
        ).status,
        404,
      );
      assert.equal(
        (
          await tenantCall(
            courseTeacherSession,
            "finance/rates/" + financialRate,
          )
        ).status,
        200,
      );
      const exported = await tenantCall(
        courseTeacherSession,
        "export?kind=finance&month=2026-11",
      );
      assert.equal(exported.status, 200);
      assert.ok(!exported.text.includes(materialB.teacher));
    });
    await run("7.7-09 教务财务响应及报表Excel无金额（HTTP）", async () => {
      for (const path of [
        "finance/rates",
        "finance/payroll?month=2026-11",
        "finance/payments",
        "finance/costs",
        "export?kind=finance&month=2026-11",
      ])
        assert.equal((await tenantCall(academicScope, path)).status, 403);
      const report = await tenantCall(
        academicScope,
        "finance/report?month=2026-11",
      );
      assert.equal(report.status, 200);
      assert.ok(
        !/"(?:[a-z_]*amount|rate|unit_price|salary)"/.test(report.text),
      );
      const exported = await tenantCall(
        academicScope,
        "export?kind=report&month=2026-11",
      );
      assert.equal(exported.status, 200);
      assert.ok(!exported.text.includes("课酬分摊"));
      for (const path of ["credits/adjust", "credits/transfer"])
        assert.equal(
          (
            await tenantCall(academicScope, path, "POST", {
              operation_id: op(),
              package_id: materialA.pack,
              delta: 1,
              reason: "越权",
            })
          ).status,
          403,
        );
    });
    await run("7.7-13 当前报表和Excel的姓名按文本输出（HTTP）", async () => {
      const student = (
        await tenantCall(a, "data/students/" + materialA.student)
      ).body.record;
      const text = "<img src=x onerror=alert(1)>";
      assert.equal(
        (
          await tenantCall(a, "data/students/" + materialA.student, "PATCH", {
            version: student.version,
            name: text,
          })
        ).status,
        200,
      );
      const report = await tenantCall(a, "finance/report?month=2026-11");
      assert.equal(report.status, 200);
      assert.ok(report.text.includes(text));
      const download = await tenantCall(a, "export?kind=report&month=2026-11");
      assert.equal(download.status, 200);
      assert.ok(download.text.includes("&lt;img src=x onerror=alert(1)&gt;"));
      assert.ok(!download.text.includes("<img "));
      assert.ok(!download.text.includes("<f>"));
    });
    await run(
      "7.7-14 锁月后课程、出勤及回补拒绝，解锁须主管原因（HTTP）",
      async () => {
        // These are freshly created isolation fixtures. Finish their planned roster before locking.
        const week = await tenantCall(a, "schedule?from=2026-11-01&to=2026-12-01");
        assert.equal(week.status, 200, week.text);
        for (const lesson of week.body.items.filter((row) => row.status === "planned")) {
          const checkout = await tenantCall(a, "credits/lessons/" + lesson.id + "/status", "POST", {
            operation_id: op(), lesson_version: lesson.version, status: "cancelled",
          });
          assert.equal(checkout.status, 200, checkout.text);
        }
        let result = await tenantCall(
          financialSession,
          "finance/settlements/submit",
          "POST",
          { month: "2026-11", version: 0, operation_id: op() },
        );
        assert.equal(result.status, 200, result.text);
        result = await tenantCall(a, "finance/settlements/approve", "POST", {
          month: "2026-11",
          version: 1,
          operation_id: op(),
        });
        assert.equal(result.status, 200, result.text);
        const course = (
          await tenantCall(a, "data/lessons/" + isolationLessonId)
        ).body.record;
        assert.equal(
          (
            await tenantCall(a, "data/lessons/" + isolationLessonId, "PATCH", {
              version: course.version,
              units: 2,
            })
          ).status,
          409,
        );
        assert.equal(
          (
            await tenantCall(
              a,
              "credits/lessons/" + isolationLessonId + "/attendance",
              "POST",
              {
                operation_id: op(),
                lesson_version: course.version,
                participants: [
                  {
                    id: course.participants[0].id,
                    version: course.participants[0].version,
                    attendance: "attended",
                  },
                ],
              },
            )
          ).status,
          409,
        );
        assert.equal(
          (
            await tenantCall(a, "data/lessons/" + isolationLessonId, "DELETE", {
              version: course.version,
            })
          ).status,
          409,
        );
        assert.equal(
          (
            await tenantCall(
              courseTeacherSession,
              "finance/payroll?month=2026-11",
            )
          ).body.confirmation_status,
          "confirmed",
        );
        assert.equal(
          (
            await tenantCall(
              financialSession,
              "finance/settlements/unlock",
              "POST",
              {
                operation_id: op(),
                month: "2026-11",
                version: 2,
                reason: "越权",
              },
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await tenantCall(a, "finance/settlements/unlock", "POST", {
              operation_id: op(),
              month: "2026-11",
              version: 2,
              reason: "",
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await tenantCall(a, "finance/settlements/unlock", "POST", {
              operation_id: op(),
              month: "2026-11",
              version: 2,
              reason: "审查后重提",
            })
          ).status,
          200,
        );
        assert.equal(
          (
            await tenantCall(
              courseTeacherSession,
              "finance/payroll?month=2026-11",
            )
          ).body.confirmation_status,
          "unconfirmed",
        );
      },
    );
  }
  if (phase >= 5) {
    let mobileLesson, mobileSubmission, mobileBody, secondStudent;
    const op = () => "mobile_" + crypto.randomUUID();
    await run(
      "第五阶段 HTTP：主讲提交待确认、跨机构/跨课参与人拒绝，学员不见草稿或同学",
      async () => {
        const made = await tenantCall(a, "data/students", "POST", {
          name: "独立私评学员",
          billing_mode: "overall",
        });
        assert.equal(made.status, 200, made.text);
        secondStudent = made.body.id;
        let start = new Date(Date.now() + 8 * 3600000 - 5 * 60000)
          .toISOString()
          .slice(0, 16);
        if (start.slice(11) > "23:00") start = start.slice(0, 10) + "T23:00";
        let result = await tenantCall(a, "data/lessons", "POST", {
          start_at: start,
          teacher_id: materialA.teacher,
          course_type_id: materialA.type,
          location_id: materialA.location,
          duration: 45,
          units: 1,
          student_ids: [materialA.student, secondStudent],
          force: true,
        });
        assert.equal(result.status, 200, result.text);
        mobileLesson = result.body.id;
        assert.equal(
          (
            await tenantCall(a, "settings", "PUT", {
              key: "teacher_self_checkin",
              value: true,
            })
          ).status,
          200,
        );
        let v = (
          await tenantCall(
            courseTeacherSession,
            "lessons/" + mobileLesson + "/review",
          )
        ).body;
        mobileBody = {
          operation_id: op(),
          kind: "attendance",
          previous_id: null,
          comment_fingerprint: v.comment_fingerprint,
          public_text: "<img src=x onerror=alert(1)>",
          homework: "公共作业",
          people: v.participants.map((p) => ({
            participant_id: p.id,
            student_id: p.student_id,
            attendance: "attended",
            comment:
              p.student_id === materialA.student
                ? "本人私评"
                : "同学私评禁止泄漏",
          })),
        };
        const cross = structuredClone(mobileBody);
        cross.operation_id = op();
        cross.people[1].student_id = materialB.student;
        assert.equal(
          (
            await tenantCall(
              courseTeacherSession,
              "lessons/" + mobileLesson + "/review",
              "POST",
              cross,
            )
          ).status,
          404,
        );
        assert.equal(
          (
            await tenantCall(
              b,
              "lessons/" + mobileLesson + "/review",
              "POST",
              mobileBody,
            )
          ).status,
          404,
        );
        result = await tenantCall(
          courseTeacherSession,
          "lessons/" + mobileLesson + "/review",
          "POST",
          mobileBody,
        );
        assert.equal(result.status, 200, result.text);
        mobileSubmission = result.body.id;
        const learner = await tenantCall(
          studentScope,
          "lessons/" + mobileLesson + "/review",
        );
        assert.equal(learner.status, 200, learner.text);
        assert.equal(learner.body.participants.length, 1);
        assert.deepEqual(learner.body.published, []);
        assert.equal(learner.body.submission, null);
        assert.ok(!learner.text.includes(secondStudent));
        assert.ok(!learner.text.includes("同学私评"));
        assert.equal(
          (
            await tenantCall(
              studentScope,
              "submissions?from=" +
                start.slice(0, 7) +
                "-01&to=" +
                start.slice(0, 10),
            )
          ).status,
          403,
        );
      },
    );
    await run(
      "第五阶段 HTTP：教师不能确认，教务确认后点评只含公共及本人；金额无泄漏",
      async () => {
        let result = await tenantCall(
          courseTeacherSession,
          "submissions/" + mobileSubmission + "/confirm",
          "POST",
          { operation_id: op(), version: 1 },
        );
        assert.equal(result.status, 403);
        result = await tenantCall(
          academicScope,
          "submissions/" + mobileSubmission + "/confirm",
          "POST",
          { operation_id: op(), version: 1 },
        );
        assert.equal(result.status, 200, result.text);
        const learner = await tenantCall(
          studentScope,
          "lessons/" + mobileLesson + "/review",
        );
        assert.equal(learner.body.published.length, 2);
        assert.ok(learner.text.includes("本人私评"));
        assert.ok(!learner.text.includes("同学私评"));
        assert.ok(!learner.text.includes(secondStudent));
        assert.ok(learner.text.includes("<img src=x onerror=alert(1)>"));
        const teacher = await tenantCall(
          courseTeacherSession,
          "lessons/" + mobileLesson + "/review",
        );
        assert.ok(!/unit_price|amount|phone|balance/.test(teacher.text));
      },
    );
    await run(
      "第五阶段 HTTP：点评修订待审与退回保留已确认版本，关闭点评模块不泄漏草稿",
      async () => {
        const v = (
          await tenantCall(
            courseTeacherSession,
            "lessons/" + mobileLesson + "/review",
          )
        ).body;
        const result = await tenantCall(
          courseTeacherSession,
          "lessons/" + mobileLesson + "/review",
          "POST",
          {
            ...mobileBody,
            operation_id: op(),
            kind: "comments",
            previous_id: v.submission.id,
            previous_version: v.submission.version,
            comment_fingerprint: v.comment_fingerprint,
            public_text: "尚未确认的新公共点评",
          },
        );
        assert.equal(result.status, 200, result.text);
        let learner = await tenantCall(
          studentScope,
          "lessons/" + mobileLesson + "/review",
        );
        assert.ok(!learner.text.includes("尚未确认的新公共点评"));
        assert.ok(learner.text.includes("本人私评"));
        assert.equal(
          (
            await tenantCall(
              a,
              "submissions/" + result.body.id + "/return",
              "POST",
              { operation_id: op(), version: 1, reason: "核对点评" },
            )
          ).status,
          200,
        );
        learner = await tenantCall(
          studentScope,
          "lessons/" + mobileLesson + "/review",
        );
        assert.ok(learner.text.includes("本人私评"));
        await con("tenants/" + a.id + "/modules", "PUT", {
          module: "comments",
          enabled: false,
        });
        const hidden = await tenantCall(
          courseTeacherSession,
          "lessons/" + mobileLesson + "/review",
        );
        assert.deepEqual(hidden.body.published, []);
        assert.ok(!hidden.text.includes("尚未确认的新公共点评"));
        await con("tenants/" + a.id + "/modules", "PUT", {
          module: "comments",
          enabled: true,
        });
      },
    );
    await run(
      "第五阶段 HTTP：品牌个人课表图教师/学员不可指定他人或跨机构",
      async () => {
        const from = new Date(Date.now() + 8 * 3600000)
          .toISOString()
          .slice(0, 10);
        assert.equal(
          (await tenantCall(studentScope, "brand-timetable?from=" + from))
            .status,
          200,
        );
        assert.equal(
          (
            await tenantCall(
              studentScope,
              "brand-timetable?from=" + from + "&student_id=" + secondStudent,
            )
          ).status,
          404,
        );
        assert.equal(
          (
            await tenantCall(
              courseTeacherSession,
              "brand-timetable?from=" +
                from +
                "&teacher_id=" +
                materialB.teacher,
            )
          ).status,
          404,
        );
        assert.equal(
          (await tenantCall(b, "lessons/" + mobileLesson + "/review")).status,
          404,
        );
      },
    );
  }
  if (phase >= 6) {
    let classA, classB, leadA;
    await run(
      "第六阶段 HTTP 7.7-02/03：班级与跟进跨机构读取、修改、删除及关联全部拒绝",
      async () => {
        const make = (t, m) =>
          tenantCall(t, "tools/classes", "POST", {
            name: "隔离班级",
            teacher_id: m.teacher,
            course_type_id: m.type,
            location_id: m.location,
            date_from: "2026-11-01",
            date_to: "2026-12-31",
          });
        const ca = await make(a, materialA),
          cb = await make(b, materialB);
        assert.equal(ca.status, 200, ca.text);
        assert.equal(cb.status, 200, cb.text);
        classA = ca.body.id;
        classB = cb.body.id;
        for (const method of ["GET", "PATCH", "DELETE"]) {
          const r = await tenantCall(
            a,
            "tools/classes/" + classB,
            method,
            method === "GET" ? undefined : { version: 1 },
          );
          assert.equal(r.status, 404, r.text);
        }
        let r = await tenantCall(
          a,
          "tools/classes/" + classA + "/members",
          "POST",
          { student_ids: [materialA.student, materialB.student] },
        );
        assert.equal(r.status, 404, r.text);
        assert.equal(
          (await tenantCall(a, "tools/classes/" + classA)).body.members.length,
          0,
        );
        r = await tenantCall(a, "tools/followup_notes", "POST", {
          student_id: materialB.student,
          at: "2026-11-02T09:00",
          content: "拒绝他机构",
        });
        assert.equal(r.status, 404, r.text);
        r = await tenantCall(a, "tools/followup_notes", "POST", {
          tenant_id: b.id,
          student_id: materialA.student,
          at: "2026-11-02T09:00",
          content: "<img src=x onerror=alert(1)>",
        });
        assert.equal(r.status, 200, r.text);
        assert.equal(
          (await tenantCall(b, "tools/followup_notes/" + r.body.id)).status,
          404,
        );
      },
    );
    await run(
      "第六阶段 HTTP 7.7-06/07/09：教师学员无员工工具，教务工作台/预警不含金额",
      async () => {
        for (const actor of [courseTeacherSession, studentScope])
          for (const endpoint of [
            "tools/classes",
            "tools/leads",
            "tools/referrals",
            "workbench",
            "renewals",
            "followup-assignees",
          ]) {
            const r = await tenantCall(actor, endpoint);
            assert.equal(r.status, 403, r.text);
          }
        for (const endpoint of ["workbench", "renewals"]) {
          const r = await tenantCall(academicScope, endpoint);
          assert.equal(r.status, 200, r.text);
          assert.ok(
            !/"(?:unit_price|amount|tuition_amount|rate|teacher_pay_amount)"/.test(
              r.text,
            ),
            r.text,
          );
        }
      },
    );
    await run(
      "第六阶段 HTTP：线索转正与推荐只在本机构，手机加密字段及未同意推荐不可读写",
      async () => {
        let r = await tenantCall(a, "tools/leads", "POST", {
          name: "来源仅属于机构A",
          phone: "13900000089",
          source: "隔离验收",
          stage: "new",
        });
        assert.equal(r.status, 200, r.text);
        leadA = r.body.id;
        r = await tenantCall(b, "tools/leads/" + leadA);
        assert.equal(r.status, 404, r.text);
        r = await tenantCall(
          academicScope,
          "tools/leads/" + leadA + "/contact",
          "POST",
          {},
        );
        assert.equal(r.status, 403, r.text);
        r = await tenantCall(a, "tools/referrals", "POST", {
          student_id: materialA.student,
          intention: "本科",
          parent_phone: "13900000088",
        });
        assert.equal(r.status, 400, r.text);
        r = await tenantCall(a, "tools/referrals", "POST", {
          student_id: materialB.student,
          intention: "本科",
          parent_phone: "13900000088",
          consent_name: "家长",
          consent_at: "2026-01-01T09:00",
          consent_method: "书面",
          consent_operator: "经办",
        });
        assert.equal(r.status, 404, r.text);
        const list = await tenantCall(b, "tools/leads");
        assert.equal(list.status, 200, list.text);
        assert.ok(!list.text.includes("来源仅属于机构A"));
      },
    );
    await run(
      "第六阶段 HTTP：平台公告只投指定机构/角色，机构域名控制台数据工具仍404",
      async () => {
        const message = await con("announcements", "POST", {
          title: "只投A机构主管",
          content: "公告隔离验收内容",
          roles: ["supervisor"],
          tenants: [a.id],
          starts_at: Date.now() - 1000,
        });
        assert.equal(message.status, 200, message.text);
        assert.ok(
          (await tenantCall(a, "system-messages")).text.includes(
            "公告隔离验收内容",
          ),
        );
        for (const actor of [
          b,
          studentScope,
          courseTeacherSession,
          academicScope,
        ]) {
          const other = await tenantCall(actor, "system-messages");
          assert.equal(other.status, 200, other.text);
          assert.ok(!other.text.includes("公告隔离验收内容"));
        }
        for (const endpoint of [
          "overview",
          "backups",
          "announcements",
          "tenants/" + a.id + "/export-schema",
          "tenants/" + a.id + "/jobs",
          "tenants/" + a.id + "/business",
        ])
          assert.equal((await tenantCall(a, endpoint)).status, 404);
      },
    );
  }
  if (phase >= 8) {
    let promoId, partnerId, partnerLesson, imageId;
    await run(
      "第八阶段 HTTP：推广指定机构、角色与tuition价格裁剪；跨机构申请拒绝",
      async () => {
        const date =
          new Date(Date.now() + 3 * 86400000 + 8 * 3600000)
            .toISOString()
            .slice(0, 10) + "T10:00";
        const upload = await con("promo/images", "POST", { kind: "detail" });
        assert.equal(upload.status, 200, upload.text);
        const pngChunk = (tag, data) => {
          const payload = Buffer.concat([Buffer.from(tag), data]);
          const length = Buffer.alloc(4),
            crc = Buffer.alloc(4);
          length.writeUInt32BE(data.length);
          crc.writeUInt32BE(crc32(payload));
          return Buffer.concat([length, payload, crc]);
        };
        const header = Buffer.alloc(13);
        header.writeUInt32BE(750, 0);
        header.writeUInt32BE(1000, 4);
        header[8] = 8;
        const png = Buffer.concat([
          Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
          pngChunk("IHDR", header),
          pngChunk("IDAT", deflateSync(Buffer.alloc(751 * 1000))),
          pngChunk("IEND", Buffer.alloc(0)),
        ]);
        const longImage = upload.body.id;
        const part = await con("promo/images/" + longImage + "/part", "POST", {
          index: 0,
          data: "data:image/png;base64," + png.toString("base64"),
        });
        assert.equal(part.status, 200, part.text);
        const complete = await con(
          "promo/images/" + longImage + "/complete",
          "POST",
          {},
        );
        assert.equal(complete.status, 200, complete.text);
        const made = await con("promo", "POST", {
          type: "course",
          detail_image_key: longImage,
          title: "推广隔离验收",
          body: "<img src=x onerror=alert(1)>",
          audience: "selected",
          tenant_ids: [a.id],
          status: "published",
          publish_at: Date.now() - 1000,
          lecturer: "隔离讲师",
          seat_price: 123,
          suggested_price: 200,
          min_size: 1,
          apply_deadline: Date.now() + 3600000,
          sessions: [
            {
              start_at: date,
              duration: 45,
              meeting_no: "隔离保密会议号",
              meeting_url: "https://meeting.tencent.com/isolation",
            },
          ],
        });
        assert.equal(made.status, 200, made.text);
        promoId = made.body.id;
        const own = await tenantCall(a, "promo/" + promoId);
        assert.equal(own.status, 200);
        assert.equal(own.body.campaign.seat_price, 123);
        assert.equal((await tenantCall(b, "promo/" + promoId)).status, 404);
        assert.equal(
          (
            await tenantCall(b, "promo/" + promoId + "/application", "POST", {
              est_size: 1,
              unsure: false,
            })
          ).status,
          404,
        );
        for (const actor of [studentScope, courseTeacherSession])
          assert.equal((await tenantCall(actor, "promo")).status, 403);
        const academic = await tenantCall(academicScope, "promo/" + promoId);
        assert.equal(academic.status, 200, academic.text);
        assert.ok(!academic.text.includes("seat_price"));
        assert.ok(!academic.text.includes("suggested_price"));
        assert.equal(
          (
            await tenantCall(a, "promo/" + promoId + "/application", "POST", {
              est_size: 1,
              unsure: false,
            })
          ).status,
          200,
        );
      },
    );
    await run(
      "第八阶段 HTTP：开班与学员名单同机构；学员仅见本人合作课，不见会议号、链接或同学",
      async () => {
        let detail = await con("promo/" + promoId),
          app = detail.body.applications[0];
        partnerId = detail.body.course.id;
        assert.equal(
          (
            await con("promo/" + promoId + "/applications/" + app.id, "PUT", {
              version: app.version,
              status: "confirmed",
              confirmed_size: 1,
              consultant: "验收顾问",
            })
          ).status,
          200,
        );
        detail = await con("promo/" + promoId);
        assert.equal(
          (
            await con("promo/" + promoId + "/open", "POST", {
              version: detail.body.course.version,
            })
          ).status,
          200,
        );
        let own = await tenantCall(a, "promo/" + promoId);
        const foreign = await tenantCall(
          a,
          "promo/" + promoId + "/roster",
          "PUT",
          {
            version: own.body.application.version,
            student_ids: [materialB.student],
          },
        );
        assert.equal(foreign.status, 400);
        assert.equal(
          (
            await tenantCall(a, "promo/" + promoId + "/roster", "PUT", {
              version: own.body.application.version,
              student_ids: [materialA.student],
            })
          ).status,
          200,
        );
        const start = detail.body.sessions[0].start_at.slice(0, 10),
          end = new Date(Date.parse(start + "T00:00:00Z") + 86400000)
            .toISOString()
            .slice(0, 10);
        const schedule = await tenantCall(
          studentScope,
          "schedule?from=" + start + "&to=" + end,
        );
        assert.equal(schedule.status, 200);
        const l = schedule.body.items.find(
          (x) => x.source_course_id === partnerId,
        );
        assert.ok(l);
        partnerLesson = l.id;
        const read = await tenantCall(studentScope, "data/lessons/" + l.id);
        assert.equal(read.status, 200);
        assert.equal(read.body.record.participants.length, 1);
        assert.ok(!read.text.includes("隔离保密会议号"));
        assert.ok(!read.text.includes("meeting.tencent.com"));
        assert.ok(!read.text.includes(materialB.student));
        assert.equal((await tenantCall(b, "data/lessons/" + l.id)).status, 404);
      },
    );
    await run(
      "第八阶段 HTTP：合作课不能经普通接口修改、删除、销课或点评；不计机构课酬",
      async () => {
        const l = (await tenantCall(a, "data/lessons/" + partnerLesson)).body
          .record;
        assert.equal(
          (
            await tenantCall(a, "data/lessons/" + l.id, "PATCH", {
              version: l.version,
              note: "不可修改",
            })
          ).status,
          403,
        );
        assert.equal(
          (
            await tenantCall(a, "data/lessons/" + l.id, "DELETE", {
              version: l.version,
            })
          ).status,
          403,
        );
        assert.equal(
          (
            await tenantCall(a, "credits/lessons/" + l.id + "/status", "POST", {
              operation_id: crypto.randomUUID(),
              lesson_version: l.version,
              status: "completed",
            })
          ).status,
          403,
        );
        assert.equal(
          (await tenantCall(a, "lessons/" + l.id + "/review")).status,
          403,
        );
        const pay = await tenantCall(
          a,
          "finance/payroll?month=" + l.start_at.slice(0, 7),
        );
        assert.equal(pay.status, 200);
        assert.ok(!pay.body.lessons.some((x) => x.id === partnerLesson));
      },
    );
    await run(
      "第八阶段 HTTP：推广R2图片按机构及角色鉴权；关闭promo后图片与列表均拒绝",
      async () => {
        const created = await con("promo/images", "POST", { kind: "cover" });
        assert.equal(created.status, 200);
        imageId = created.body.id;
        const png =
          "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6S9sAAAAASUVORK5CYII=";
        assert.equal(
          (
            await con("promo/images/" + imageId + "/part", "POST", {
              index: 0,
              data: png,
            })
          ).status,
          200,
        );
        assert.equal(
          (await con("promo/images/" + imageId + "/complete", "POST", {}))
            .status,
          200,
        );
        const c = await con("promo", "POST", {
          type: "material",
          title: "图片隔离验收",
          cover: imageId,
          audience: "selected",
          tenant_ids: [a.id],
          status: "published",
          publish_at: Date.now() - 1000,
        });
        assert.equal(c.status, 200);
        assert.equal(
          (await tenantCall(a, "promo/images/" + imageId)).status,
          200,
        );
        assert.equal(
          (await tenantCall(b, "promo/images/" + imageId)).status,
          404,
        );
        assert.equal(
          (await tenantCall(studentScope, "promo/images/" + imageId)).status,
          403,
        );
        assert.equal(
          (
            await con("tenants/" + a.id + "/modules", "PUT", {
              module: "promo",
              enabled: false,
            })
          ).status,
          200,
        );
        assert.equal((await tenantCall(a, "promo")).status, 403);
        assert.equal(
          (await tenantCall(a, "promo/images/" + imageId)).status,
          403,
        );
        assert.equal(
          (
            await con("tenants/" + a.id + "/modules", "PUT", {
              module: "promo",
              enabled: true,
            })
          ).status,
          200,
        );
      },
    );
  }
  await run("7.7-10 超管关闭模块后主管接口拒绝", async () => {
    assert.equal(
      (
        await con("tenants/" + a.id + "/modules", "PUT", {
          module: "accounts",
          enabled: false,
        })
      ).status,
      200,
    );
    assert.equal((await tenantCall(a, "accounts")).status, 403);
    await con("tenants/" + a.id + "/modules", "PUT", {
      module: "accounts",
      enabled: true,
    });
  });
  await run("7.7-11 不存在/停用/普通不存在页的 404 完全一致", async () => {
    const current = (await con("tenants/" + b.id)).body.tenant;
    await con("tenants/" + b.id, "PATCH", { ...current, status: "paused" });
    const responses = [
      await call(baseUrl + "/unknown-" + suffix + "/login"),
      await call(baseUrl + "/" + b.slug + "/login"),
      await call(baseUrl + "/" + a.slug + "/missing"),
    ];
    assert.ok(responses.every((x) => x.status === 404));
    assert.equal(responses[0].text, responses[1].text);
    assert.equal(responses[0].text, responses[2].text);
    assert.equal(
      responses[0].headers.get("content-security-policy"),
      responses[2].headers.get("content-security-policy"),
    );
  });
  await run("7.7-12 机构域名控制台文件/接口均为 404", async () => {
    for (const p of [
      "/console.html",
      "/console-assets/console.js",
      "/console-assets/console.css",
      "/api/tenants",
      "/console/api/tenants",
      "/" + a.slug + "/api/tenants",
      "/_worker.js",
      "/src/server/repo.js",
    ])
      assert.equal(
        (await call(baseUrl + p, { cookie: a.cookie })).status,
        404,
        p,
      );
  });
  await run("7.7-13 当前文本字段原样返回，严格 CSP 禁止内联", async () => {
    const u = (await tenantCall(a, "accounts/" + createdUser.id)).body.user;
    assert.equal(u.name, "<img src=x onerror=alert(1)>");
    const response = await call(baseUrl + "/" + a.slug + "/app/", {
      cookie: a.cookie,
    });
    assert.equal(response.status, 200);
    const csp = response.headers.get("content-security-policy");
    assert.ok(
      !csp.includes("unsafe-inline") &&
        !csp.includes("unsafe-eval") &&
        !csp.includes("challenges.cloudflare.com"),
    );
    assert.ok(!response.text.includes("onerror="));
  });
  if (phase >= 7) {
    await run(
      "7.7-13 第1–7阶段全部导出种类与业务文本/页面壳（HTTP）；DOM注入汇另由前端全量静态及运行测试验证",
      async () => {
        const text = "<img src=x onerror=alert(1)>";
        for (const path of [
          "data/students",
          "accounts",
          "tools/classes",
          "tools/followup_notes",
          "tools/leads",
          "tools/referrals",
          "system-messages",
        ]) {
          const r = await tenantCall(a, path);
          assert.equal(r.status, 200, path);
          assert.ok(r.headers.get("content-type").includes("application/json"));
        }
        for (const kind of [
          "lessons",
          "packages",
          "finance",
          "report",
          "logs",
        ]) {
          const r = await tenantCall(
            a,
            "export?kind=" + kind + "&month=2026-11",
          );
          assert.equal(r.status, 200, kind);
          assert.ok(r.headers.get("content-type").includes("spreadsheetml"));
          assert.ok(!r.text.includes("<img "));
          assert.ok(!r.text.includes("<f>"));
        }
        const profile = await tenantCall(
          a,
          "data/students/" + materialA.student,
        );
        assert.equal(profile.body.record.name, text);
        for (const path of [
          "app/",
          "app/students",
          "app/schedule",
          "app/settings",
          "app/accounts",
          "app/logs",
        ]) {
          const r = await call(baseUrl + "/" + a.slug + "/" + path, {
            cookie: a.cookie,
          });
          assert.equal(r.status, 200);
          assert.ok(!r.text.includes(text));
          assert.ok(!/\son\w+=/.test(r.text));
        }
      },
    );
    await run(
      "第七阶段 HTTP：有效代管租约的四个月结审批路径全部404，只读结算正常",
      async () => {
        const prefix = "tenants/" + a.id,
          lease = await con(prefix + "/maintenance", "POST", {
            reason: "代管结算边界隔离验收",
          });
        assert.equal(lease.status, 200);
        for (const action of ["submit", "approve", "unlock", "reject"])
          assert.equal(
            (
              await con(prefix + "/operate", "POST", {
                lease: lease.body.id,
                path: "/finance/settlements/" + action,
                method: "POST",
                data: { month: "2026-11" },
              })
            ).status,
            404,
          );
        assert.equal(
          (
            await con(
              prefix +
                "/business?path=/finance/settlement&query=month%3D2026-11",
            )
          ).status,
          200,
        );
        assert.equal(
          (await con(prefix + "/maintenance/" + lease.body.id, "DELETE", {}))
            .status,
          200,
        );
      },
    );
  } else pending("7.7-13 后续未开发页面/导出的完整XSS回归：第七阶段全量执行");
  if (phase < 4) pending("7.7-14 锁月后课程/出勤/课时流水不可修改");
  await run("7.7-15 连错五次锁定，账号不存在与密码错误一致", async () => {
    const wrong = await tenantCall(
      a,
      "login",
      "POST",
      {
        phone: "13900000999",
        password: "WrongSecure9x",
        turnstile: await challengeFor(a),
      },
      "",
    );
    let last;
    for (let i = 0; i < 5; i++)
      last = await tenantCall(
        a,
        "login",
        "POST",
        {
          phone: "13900000001",
          password: "WrongSecure9x",
          turnstile: await challengeFor(a),
        },
        "",
      );
    assert.equal(last.status, 401);
    assert.deepEqual(last.body, wrong.body);
    assert.equal((await login(a)).status, 401);
  });
  await run("补充 Origin 和 Content-Type 校验", async () => {
    const url = baseUrl + "/" + a.slug + "/api/logout";
    for (const headers of [
      { Origin: "https://evil.test", "Content-Type": "application/json" },
      { Origin: new URL(baseUrl).origin, "Content-Type": "text/plain" },
    ]) {
      headers.Cookie = a.cookie;
      const res = await request(url, { method: "POST", headers, body: "{}" });
      assert.ok([403, 415].includes(res.status));
    }
  });
  await run("补充公开品牌只包含五个许可字段", async () => {
    const result = await tenantCall(a, "public/brand");
    assert.deepEqual(
      Object.keys(result.body).sort(),
      [
        "display_name",
        "logo",
        "login_bg",
        "theme_color",
        "welcome_text",
      ].sort(),
    );
  });
  await run("补充 Access 伪造头不能进入控制台", async () => {
    const r = await request(consoleUrl + "/api/tenants", {
      headers: { Cookie: adminCookie, "Cf-Access-Jwt-Assertion": "forged" },
    });
    assert.equal(r.status, 403);
  });
  await run("补充修改机构路径使旧会话失效，旧路径跳转", async () => {
    const t = (await con("tenants/" + a.id)).body.tenant;
    await con("tenants/" + a.id, "PATCH", { ...t, slug: t.slug + "-new" });
    assert.equal((await call(baseUrl + "/" + a.slug + "/login")).status, 308);
    assert.equal(
      (await call(baseUrl + "/" + a.slug + "-new/api/me", { cookie: a.cookie }))
        .status,
      401,
    );
  });
  report.summary = {
    passed: report.results.filter((x) => x.status === "PASS").length,
    failed: report.results.filter((x) => x.status === "FAIL").length,
    not_implemented: report.results.filter(
      (x) => x.status === "NOT_IMPLEMENTED",
    ).length,
  };
  report.fixtures = fixtures.map((t) => ({ tenant_id: t.id, slug: t.slug }));
  return report;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const env = process.env;
  for (const k of [
    "TEST_BASE_URL",
    "TEST_CONSOLE_URL",
    "TEST_CONSOLE_COOKIE",
    "TEST_ACCESS_JWT",
  ])
    if (!env[k]) throw Error("缺少环境变量 " + k + "，请查阅中文测试说明。");
  let provider;
  if (env.TEST_TURNSTILE_PROVIDER) {
    const path = await import("node:path");
    provider = (
      await import(
        pathToFileURL(path.resolve(env.TEST_TURNSTILE_PROVIDER)).href
      )
    ).default;
  } else if (env.TEST_TURNSTILE_TOKENS) {
    const tokens = JSON.parse(env.TEST_TURNSTILE_TOKENS);
    provider = async () => {
      if (!tokens.length) throw Error("有效验证码令牌已用完");
      return tokens.shift();
    };
  } else {
    throw Error(
      "远程测试需要 TEST_TURNSTILE_PROVIDER 或 TEST_TURNSTILE_TOKENS 提供逐次有效令牌；不能复用生产令牌。",
    );
  }
  const report = await runIsolation({
    baseUrl: env.TEST_BASE_URL.replace(/\/$/, ""),
    consoleUrl: env.TEST_CONSOLE_URL.replace(/\/$/, ""),
    adminCookie: env.TEST_CONSOLE_COOKIE,
    accessJwt: env.TEST_ACCESS_JWT,
    turnstileToken: provider,
    phase: Number(env.TEST_PHASE || 8),
  });
  await mkdir("work/reports", { recursive: true });
  await writeFile(
    "work/reports/isolation.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report.summary));
  process.exitCode = report.summary.failed
    ? 1
    : report.summary.not_implemented
      ? 2
      : 0;
}
