import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./support.mjs";
import { setup } from "./fixtures-credit.mjs";
import { adminCall } from "./fixtures-admin.mjs";

const tenant = "https://school.test";
const consoleOrigin = "https://console.school.test";
const versioned = "public, max-age=31536000, immutable";
const timingPattern = /^db;dur=(\d+\.\d);desc="(\d+)", app;dur=(\d+\.\d)(?:, [^\r\n]+)?$/;

function verifyTiming(response) {
  const match = timingPattern.exec(response.headers.get("Server-Timing") || "");
  assert.ok(match, response.headers.get("Server-Timing"));
  assert.equal(
    Number(match[2]),
    Number(response.headers.get("x-test-d1-queries")),
  );
  assert.ok(Number(match[3]) >= Number(match[1]));
  return Number(match[2]);
}

test("速度 S1：仅成功白名单静态响应可缓存，合法版本号、HTML、API 与越界路径", async () => {
  const f = await fixture();
  try {
    f.env.ACCESS_MODE = "off";
    const s = await setup(f, 1);
    const resources = [
      [tenant, "/assets/tenant.js"],
      [tenant, "/assets/tenant.css"],
      [consoleOrigin, "/console-assets/console.js"],
      [consoleOrigin, "/console-assets/console.css"],
      [consoleOrigin, "/console-assets/pinyin-pro.js"],
    ];
    for (const [origin, path] of resources) {
      const normal = await f.request(origin + path);
      const cached = await f.request(origin + path + "?v=0123abcdef&other=1");
      assert.equal(normal.status, 200);
      assert.equal(cached.status, 200);
      assert.equal(normal.headers.get("cache-control"), "no-cache");
      assert.equal(cached.headers.get("cache-control"), versioned);
      assert.equal(cached.headers.get("x-content-type-options"), "nosniff");
      assert.equal(
        cached.headers.get("content-security-policy"),
        normal.headers.get("content-security-policy"),
      );
      assert.equal(cached.headers.get("server-timing"), null);
      assert.equal(await cached.text(), await normal.text());
    }
    for (const query of [
      "?v=abc123",
      "?v=FFFFFFFF",
      "?v=" + "a".repeat(65),
      "?v=01234567&v=89abcdef",
    ]) {
      const response = await f.request(tenant + "/assets/tenant.js" + query);
      assert.equal(response.headers.get("cache-control"), "no-cache");
    }
    for (const path of [
      "/console-assets/console.js",
      "/assets/secret.js",
      "/_worker.js",
      "/src/server/repo.js",
    ]) {
      const response = await f.request(
        tenant + path + "?v=01234567&path=/assets/tenant.js",
      );
      assert.equal(response.status, 404);
      assert.equal(response.headers.get("cache-control"), "no-store");
    }
    for (const url of [
      tenant + "/" + s.t.slug + "/login?v=01234567",
      consoleOrigin + "/?v=01234567",
      tenant + "/" + s.t.slug + "/api/me?v=01234567",
      tenant +
        "/" +
        s.t.slug +
        "/api/promo/images/img_" +
        "0".repeat(24) +
        "?v=01234567",
    ]) {
      const response = await f.request(url, {
        headers: { Cookie: "channel_session=" + s.token },
      });
      assert.equal(response.headers.get("cache-control"), "no-store");
    }
    f.env.ACCESS_MODE = "on";
    const denied = await f.request(
      consoleOrigin + "/console-assets/console.js?v=01234567",
    );
    assert.equal(denied.status, 403);
    assert.equal(denied.headers.get("cache-control"), "no-store");
  } finally {
    f.restore();
  }
});

test("速度 S2/S3：认证固定往返与实测 D1 次数，成功及失败的 API 计时", async () => {
  const f = await fixture();
  try {
    const s = await setup(f, 1);
    const root = tenant + "/" + s.t.slug + "/api/";
    const headers = { Cookie: "channel_session=" + s.token };
    // /me does one feature-switch read after auth and is exempt from response record accounting.
    const me = await f.request(root + "me", { headers });
    assert.equal(me.status, 200);
    assert.equal(verifyTiming(me), 1 + 1);
    const logs = await f.request(consoleOrigin + "/api/logs", {
      headers: { Cookie: f.adminCookie, "Cf-Access-Jwt-Assertion": f.access },
    });
    assert.equal(logs.status, 200);
    assert.equal(verifyTiming(logs), 1 + 1);
    const data = await f.request(root + "data/students", { headers });
    assert.equal(data.status, 200);
    assert.equal(verifyTiming(data), 3);
    const denied = await f.request(root + "me");
    assert.equal(denied.status, 401);
    verifyTiming(denied);
    const badScope = await f.request(tenant + "/unknown-school/api/me", {
      headers,
    });
    assert.equal(badScope.status, 404);
    assert.equal(verifyTiming(badScope), 1);
    const noAccess = await f.request(consoleOrigin + "/api/me");
    assert.equal(noAccess.status, 403);
    assert.equal(verifyTiming(noAccess), 0);
    const limitKey = "request-get:" + s.t.id + ":" + s.user.id;
    f.db.raw
      .prepare(
        "UPDATE security_limits SET count=240,window_start=? WHERE key=?",
      )
      .run(Date.now(), limitKey);
    const limited = await f.request(root + "me", { headers });
    assert.equal(limited.status, 429);
    assert.equal(verifyTiming(limited), 1);
    const alarm = f.db.raw
      .prepare(
        "SELECT COUNT(*) n FROM platform_audit WHERE tenant_id=? AND action='请求限流告警'",
      )
      .get(s.t.id);
    assert.equal(alarm.n, 1);
    const repeated = await f.request(root + "me", { headers });
    assert.equal(repeated.status, 429);
    verifyTiming(repeated);
    assert.equal(
      f.db.raw
        .prepare(
          "SELECT COUNT(*) n FROM platform_audit WHERE tenant_id=? AND action='请求限流告警'",
        )
        .get(s.t.id).n,
      1,
    );
  } finally {
    f.restore();
  }
});

test("速度预算样本：典型接口的独立 D1 往返统计", async () => {
  const f = await fixture();
  try {
    const s = await setup(f, 1);
    const root = tenant + "/" + s.t.slug + "/api/";
    const headers = { Cookie: "channel_session=" + s.token };
    const rows = [];
    for (const path of [
      "me",
      "schedule?from=2026-11-02&to=2026-11-09",
      "data/students",
      "c2/students",
      "credits/packages",
      "c3/report?month=2026-11",
      "todo/summary",
      "c2/home",
      "logs?kind=login",
      "promo",
      "system-messages",
    ]) {
      const r = await f.request(root + path, { headers });
      assert.equal(r.status, 200, await r.text());
      rows.push({
        surface: "tenant",
        path,
        trips: Number(r.headers.get("x-test-d1-queries")),
      });
    }
    for (const path of [
      "me",
      "logs",
      "tenants",
      "platform/accounts",
      "promo",
    ]) {
      const r = await adminCall(f, path);
      assert.equal(r.status, 200, r.text);
      rows.push({ surface: "console", path, trips: r.queries });
    }
    if (process.env.SPEED_BUDGET_SAMPLE === "1")
      console.log("SPEED_SAMPLE " + JSON.stringify(rows));
  } finally {
    f.restore();
  }
});
