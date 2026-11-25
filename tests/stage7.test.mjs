import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fixture } from "./support.mjs";
import { setup, request, accountToken, lesson } from "./fixtures-credit.mjs";
import { adminCall } from "./fixtures-admin.mjs";
import { sha } from "../src/server/core.js";
import { responseRecordCount } from "../src/server/security.js";

test("第七阶段：有效代管租约不能提交/批准/退回/解锁结算，均404；结算状态可读", async () => {
  const f = await fixture();
  try {
    const s = { ...(await setup(f)), f };
    const path = "tenants/" + s.t.id;
    const lease = await adminCall(f, path + "/maintenance", "POST", {
      reason: "月结边界回归测试",
    });
    assert.equal(lease.status, 200);
    for (const action of ["submit", "approve", "unlock", "reject"]) {
      const r = await adminCall(f, path + "/operate", "POST", {
        lease: lease.body.id,
        path: "/finance/settlements/" + action,
        method: "POST",
        data: { month: "2026-11", reason: "不可代替机构审批" },
      });
      assert.equal(r.status, 404, action);
      assert.ok(r.queries <= 40);
    }
    const read = await adminCall(
      f,
      path + "/business?path=/finance/settlement&query=month%3D2026-11",
    );
    assert.equal(read.status, 200, read.text);
    assert.equal(
      f.db.raw
        .prepare("SELECT COUNT(*) n FROM settlements WHERE tenant_id=?")
        .get(s.t.id).n,
      0,
    );
  } finally {
    f.restore();
  }
});
test("读取限额修复：230学员教务每30秒读200条持续60分钟全部200，只告警一次且会话保留", async () => {
  const f = await fixture(),
    realNow = Date.now;
  try {
    const s = { ...(await setup(f)), f };
    f.db.raw
      .prepare(
        "UPDATE users SET roles='[\"academic\"]' WHERE tenant_id=? AND id=?",
      )
      .run(s.t.id, s.user.id);
    // 角色更新触发清会话，按真实登录方式重建会话。
    const u = await s.r.user(s.user.id);
    await s.r.createSession(await sha(s.token), u, {
      ip: "test",
      ua: "read-regression",
    });
    const sample = f.db.raw
        .prepare("SELECT * FROM students WHERE tenant_id=? LIMIT 1")
        .get(s.t.id),
      cols = Object.keys(sample);
    const insert = f.db.raw.prepare(
      "INSERT INTO students(" +
        cols.join(",") +
        ") VALUES(" +
        cols.map(() => "?").join(",") +
        ")",
    );
    for (let i = 2; i < 230; i++)
      insert.run(
        ...cols.map((k) =>
          k === "id"
            ? "stu_" + i.toString(16).padStart(24, "0")
            : k === "name"
              ? "办公样本" + i
              : sample[k],
        ),
      );
    // Advance into the next hour; never rewind over the fixture request limiter.
    const start = (Math.floor(realNow() / 3600000) + 1) * 3600000 + 1000;
    for (let i = 0; i < 120; i++) {
      Date.now = () => start + i * 30000;
      const res = await request(s, "data/students");
      assert.equal(res.status, 200, res.text);
      assert.equal(res.body.items.length, 200);
      assert.ok(res.queries <= 40);
    }
    Date.now = realNow;
    assert.equal(
      f.db.raw
        .prepare(
          "SELECT COUNT(*) n FROM sessions WHERE tenant_id=? AND token_hash=?",
        )
        .get(s.t.id, await sha(s.token)).n,
      1,
    );
    const logs = f.db.raw
      .prepare(
        "SELECT * FROM platform_audit WHERE tenant_id=? AND action='读取量告警'",
      )
      .all(s.t.id);
    assert.equal(logs.length, 1);
    assert.equal(logs[0].target, s.user.id);
    assert.ok(logs[0].detail.includes("20000"));
    assert.ok(logs[0].at > 0);
  } finally {
    Date.now = realNow;
    f.restore();
  }
});
test("读取限额修复：员工50000/教师5000拦截但保留会话，新会话仍有效，写入登出不受影响，自然小时恢复", async () => {
  const f = await fixture(),
    realNow = Date.now;
  try {
    const s = { ...(await setup(f)), f },
      b = { ...(await setup(f, 1, "b")), f };
    const personal = await accountToken(s, ["student"], s.students[0]);
    const teacherId = (
      await s.call("accounts", "POST", {
        name: "老师",
        phone: "13912349876",
        roles: ["teacher"],
        teacher_id: s.teacher,
      })
    ).body.id;
    f.db.raw
      .prepare("UPDATE users SET must_change=0 WHERE tenant_id=? AND id=?")
      .run(s.t.id, teacherId);
    const teacher = await s.r.user(teacherId);
    const { b64, bytes } = await import("../src/server/core.js");
    const teacherToken = b64(bytes(32));
    await s.r.createSession(await sha(teacherToken), teacher, {
      ip: "test",
      ua: "test",
    });
    await lesson(s);
    const start = Math.floor(realNow() / 3600000) * 3600000;
    const counter = (id, n) =>
      f.db.raw
        .prepare(
          "INSERT OR REPLACE INTO security_limits(key,count,window_start,locked_until) VALUES(?,?,?,0)",
        )
        .run("read:" + s.t.id + ":" + id, n, start);
    counter(s.user.id, 49998);
    let res = await request(s, "data/students");
    assert.equal(res.status, 429, res.text);
    assert.match(
      res.body.error,
      /本小时读取量已达安全上限，将在 \d{2}:\d{2} 后恢复/,
    );
    assert.equal(
      f.db.raw
        .prepare(
          "SELECT COUNT(*) n FROM sessions WHERE tenant_id=? AND token_hash=?",
        )
        .get(s.t.id, await sha(s.token)).n,
      1,
    );
    const second = b64(bytes(32));
    await s.r.createSession(await sha(second), await s.r.user(s.user.id), {
      ip: "test",
      ua: "relogin",
    });
    assert.equal(
      (await request(s, "data/students", "GET", undefined, second)).status,
      429,
    );
    assert.equal(
      (await request(s, "me", "GET", undefined, second)).status,
      200,
    );
    assert.equal(
      (
        await request(
          s,
          "data/students",
          "POST",
          { name: "拦截期间正常写入" },
          second,
        )
      ).status,
      200,
    );
    assert.equal((await request(s, "logout", "POST", {}, second)).status, 200);
    counter(teacherId, 5000);
    assert.equal(
      (
        await request(
          s,
          "schedule?from=2026-11-01&to=2026-12-01",
          "GET",
          undefined,
          teacherToken,
        )
      ).status,
      429,
    );
    assert.equal(
      f.db.raw
        .prepare(
          "SELECT COUNT(*) n FROM sessions WHERE tenant_id=? AND token_hash=?",
        )
        .get(s.t.id, await sha(teacherToken)).n,
      1,
    );
    assert.equal((await request(b, "data/students")).status, 200);
    Date.now = () => start + 3600000 + 1000;
    assert.equal((await request(s, "data/students")).status, 200);
    Date.now = realNow;
    const alerts = await adminCall(f, "alerts");
    assert.equal(alerts.status, 200);
    assert.ok(
      alerts.body.items.some((x) => x.tenant_name === s.t.name && x.user_name),
    );
  } finally {
    Date.now = realNow;
    f.restore();
  }
});
test("第七阶段：员工和个人读请求每分钟240次限流、第五次失败告警；真实cf城市元数据触发异地告警，伪造Header无效", async () => {
  const f = await fixture();
  try {
    const s = { ...(await setup(f)), f };
    const personal = await accountToken(s, ["student"], s.students[0]);
    f.db.raw
      .prepare(
        "INSERT OR REPLACE INTO security_limits(key,count,window_start,locked_until) VALUES(?,?,?,0)",
      )
      .run("request-get:" + s.t.id + ":" + s.user.id, 240, Date.now());
    assert.equal((await request(s, "data/students")).status, 429);
    f.db.raw
      .prepare(
        "INSERT INTO security_limits(key,count,window_start,locked_until) VALUES(?,?,?,0)",
      )
      .run("request-get:" + s.t.id + ":" + personal.id, 240, Date.now());
    assert.equal(
      (await request(s, "data/students", "GET", undefined, personal.token))
        .status,
      429,
    );
    assert.equal(
      f.db.raw
        .prepare(
          "SELECT COUNT(*) n FROM platform_audit WHERE action='请求限流告警'",
        )
        .get().n,
      2,
    );
    const login = async (password, city, headers = {}) =>
      f.request("https://school.test/" + s.t.slug + "/api/login", {
        method: "POST",
        headers: {
          Origin: "https://school.test",
          "Content-Type": "application/json",
          "cf-connecting-ip": "192.0.2.1",
          ...headers,
        },
        body: JSON.stringify({
          phone: "13911112222",
          password,
          turnstile: "fixture-valid",
        }),
        cf: city ? { city, country: "CN" } : undefined,
      });
    for (let i = 0; i < 5; i++)
      assert.equal((await login("WrongPass8")).status, 401);
    assert.equal(
      f.db.raw
        .prepare(
          "SELECT COUNT(*) n FROM platform_audit WHERE action='登录失败告警'",
        )
        .get().n,
      1,
    );
    f.db.raw.exec("DELETE FROM security_limits");
    assert.equal((await login("PhaseTwoSecure9", "Shanghai")).status, 200);
    assert.equal((await login("PhaseTwoSecure9", "Beijing")).status, 200);
    assert.equal(
      (await login("PhaseTwoSecure9", null, { "cf-ipcity": "Shenzhen" }))
        .status,
      200,
    );
    assert.equal(
      f.db.raw
        .prepare(
          "SELECT COUNT(*) n FROM platform_audit WHERE action='异地登录告警'",
        )
        .get().n,
      1,
    );
    assert.ok(
      !JSON.stringify(
        f.db.raw
          .prepare("SELECT key FROM security_limits WHERE key LIKE 'city:%'")
          .all(),
      ).includes("Beijing"),
    );
  } finally {
    f.restore();
  }
});
test("第七阶段：全部自有前端无HTML注入汇、内联事件或动态执行；生产包压缩混淆、不含源码/映射/测试数据", async () => {
  for (const dir of ["tenant", "console"]) {
    const source = await readFile("src/" + dir + "/app.js", "utf8");
    assert.ok(
      !/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\s*\(|new\s+Function\s*\(/.test(
        source,
      ),
    );
    const html = await readFile("src/" + dir + "/index.html", "utf8");
    assert.ok(!/\son\w+\s*=|<script(?![^>]*\bsrc=)/i.test(html));
    assert.ok(source.includes(".textContent = text"));
  }
  const walk = async (dir) =>
    (
      await Promise.all(
        (await readdir(dir, { withFileTypes: true })).map((x) =>
          x.isDirectory() ? walk(dir + "/" + x.name) : [dir + "/" + x.name],
        ),
      )
    ).flat();
  const files = await walk("dist");
  assert.equal(files.length, 12);
  assert.ok(!files.some((p) => /\.map$|\/src\/|\/tests\//.test(p)));
  for (const file of [
    "dist/_worker.js",
    "dist/assets/tenant.js",
    "dist/console-assets/console.js",
    "backup-dist/backup-worker.js",
  ]) {
    const code = await readFile(file, "utf8");
    assert.ok(!code.includes("sourceMappingURL"));
    assert.ok(code.split("\n").length <= 4);
    assert.ok(
      !/function (resolveTenant|personalPay|renewalNotice)\(/.test(code),
    );
    assert.ok(!/fixture-valid|preview-school|FixtureSecure/.test(code));
  }
});
