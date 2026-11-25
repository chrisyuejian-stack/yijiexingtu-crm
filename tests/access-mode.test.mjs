import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { fixture } from "./support.mjs";
import { setup, request } from "./fixtures-credit.mjs";
import { base32, encrypt, totp } from "../src/server/crypto.js";
const notice = "当前未启用 Cloudflare Access 外层保护";
const origin = "https://console.school.test";
const accessKeys = ["ACCESS_ISSUER", "ACCESS_AUD", "ACCESS_EMAILS"];
async function call(
  f,
  path = "/",
  { method = "GET", data, cookie, access, ip = "192.0.2.91" } = {},
) {
  const headers = {
    Origin: origin,
    "Content-Type": "application/json",
    "CF-Connecting-IP": ip,
  };
  if (cookie) headers.Cookie = cookie;
  if (access !== undefined) headers["cf-access-jwt-assertion"] = access;
  const res = await f.request(origin + path, {
    method,
    headers,
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {}
  assert.ok(Number(res.headers.get("x-test-d1-queries")) <= 40);
  return { status: res.status, text, body, headers: res.headers };
}
function off(f) {
  f.env.ACCESS_MODE = "off";
  for (const k of accessKeys) delete f.env[k];
}
const expect = (r, status) => {
  assert.equal(r.status, status, r.text);
  return r;
};
test("第九阶段：默认/空串/on均强制Access，缺三个Access变量503，JWT验证与超管会话两层保留", async () => {
  const f = await fixture();
  try {
    for (const mode of [undefined, "", "on"]) {
      if (mode === undefined) delete f.env.ACCESS_MODE;
      else f.env.ACCESS_MODE = mode;
      for (const path of [
        "/",
        "/console-assets/console.js",
        "/api/me",
        "/api/login",
      ])
        expect(await call(f, path), 403);
      expect(await call(f, "/", { access: "forged.jwt.value" }), 403);
      expect(await call(f, "/", { access: f.access }), 200);
      expect(await call(f, "/api/me", { access: f.access }), 401);
      expect(
        await call(f, "/api/me", { access: f.access, cookie: f.adminCookie }),
        200,
      );
      for (const k of accessKeys) {
        const prior = f.env[k];
        delete f.env[k];
        const r = expect(await call(f, "/", { access: f.access }), 503);
        assert.equal(r.body.code, "CONFIG_MISSING");
        f.env[k] = prior;
      }
    }
  } finally {
    f.restore();
  }
});
test("第九阶段：off无Access头可读控制台和静态资源，提示仅off出现，其他API未登录仍401且CSP不变", async () => {
  const f = await fixture();
  try {
    const secured = expect(await call(f, "/", { access: f.access }), 200);
    assert.ok(!secured.text.includes(notice));
    off(f);
    const page = expect(await call(f), 200);
    assert.ok(page.text.includes(notice));
    assert.ok(!page.text.includes("__ACCESS_NOTICE__"));
    assert.equal(
      page.headers.get("content-security-policy"),
      secured.headers.get("content-security-policy"),
    );
    for (const path of [
      "/console-assets/console.js",
      "/console-assets/console.css",
      "/console-assets/pinyin-pro.js",
    ])
      expect(await call(f, path), 200);
    expect(await call(f, "/", { access: "forged.jwt.value" }), 200);
    for (const path of [
      "/api/me",
      "/api/overview",
      "/api/tenants",
      "/api/promo",
      "/api/backups",
      "/api/alerts",
      "/api/announcements",
      "/api/referrals",
    ])
      expect(await call(f, path), 401);
    expect(await call(f, "/api/logout", { method: "POST", data: {} }), 401);
    expect(await call(f, "/api/tenants", { method: "POST", data: {} }), 401);
    expect(await call(f, "/api/setup"), 401); // 仅POST可以进入初始化分支。
    expect(await call(f, "/api/overview", { cookie: f.adminCookie }), 200);
  } finally {
    f.restore();
  }
});
test("第九阶段：off用户名密码TOTP失败一致，五次锁IP十五分钟，正确登录/防重放及会话Cookie保留", async () => {
  const f = await fixture(),
    realNow = Date.now;
  try {
    off(f);
    const secret = base32(crypto.getRandomValues(new Uint8Array(20)));
    f.db.raw
      .prepare(
        "UPDATE platform_admins SET totp_enc=?,last_totp_step=-1 WHERE id='adm_fixture'",
      )
      .run(await encrypt(f.env, secret, "platform:totp"));
    const code = await totp(secret, Math.floor(Date.now() / 30000)),
      wrong = ((Number(code[0]) + 1) % 10) + code.slice(1);
    for (let i = 0; i < 5; i++)
      expect(
        await call(f, "/api/login", {
          method: "POST",
          data: {
            username: "fixture",
            password: i < 2 ? "WrongPassword9Z" : "FixtureSecure8Z",
            totp: i < 2 ? code : wrong,
          },
        }),
        401,
      );
    const row = f.db.raw
      .prepare(
        "SELECT locked_until FROM security_limits WHERE key='console-login:192.0.2.91'",
      )
      .get();
    assert.ok(row.locked_until >= realNow() + 899000);
    expect(
      await call(f, "/api/login", {
        method: "POST",
        data: { username: "fixture", password: "FixtureSecure8Z", totp: code },
      }),
      401,
    );
    const later = realNow() + 900100;
    Date.now = () => later;
    const next = await totp(secret, Math.floor(later / 30000));
    const logged = expect(
      await call(f, "/api/login", {
        method: "POST",
        data: { username: "fixture", password: "FixtureSecure8Z", totp: next },
      }),
      200,
    );
    const cookie = logged.headers.get("set-cookie");
    assert.match(
      cookie,
      /__Host-channel_console=.*HttpOnly; Secure; SameSite=Strict/,
    );
    expect(await call(f, "/api/me", { cookie }), 200);
    expect(
      await call(f, "/api/login", {
        method: "POST",
        data: { username: "fixture", password: "FixtureSecure8Z", totp: next },
      }),
      401,
    );
  } finally {
    Date.now = realNow;
    f.restore();
  }
});
test("第九阶段：off初始化仍需PLATFORM_SETUP_KEY和有效TOTP，初始化后两个setup接口永久404", async () => {
  const f = await fixture(),
    realNow = Date.now;
  try {
    off(f);
    f.db.raw.exec(
      "DELETE FROM platform_sessions; DELETE FROM platform_admins; DELETE FROM platform_state;",
    );
    for (const path of ["/api/setup/prepare", "/api/setup"])
      expect(
        await call(f, path, { method: "POST", data: { setup_key: "wrong" } }),
        403,
      );
    const prep = expect(
      await call(f, "/api/setup/prepare", {
        method: "POST",
        data: { setup_key: f.env.PLATFORM_SETUP_KEY },
      }),
      200,
    ).body;
    const payload = {
      ...prep,
      setup_key: f.env.PLATFORM_SETUP_KEY,
      username: "new_owner",
      password: "NewPlatformSecure9Z",
      totp: await totp(prep.secret, Math.floor(Date.now() / 30000)),
    };
    expect(
      await call(f, "/api/setup", {
        method: "POST",
        data: { ...payload, totp: "invalid" },
      }),
      400,
    );
    expect(await call(f, "/api/setup", { method: "POST", data: payload }), 200);
    for (const path of ["/api/setup/prepare", "/api/setup"])
      expect(
        await call(f, path, {
          method: "POST",
          data: { setup_key: f.env.PLATFORM_SETUP_KEY },
        }),
        404,
      );
    const later = realNow() + 31000;
    Date.now = () => later;
    expect(
      await call(f, "/api/login", {
        method: "POST",
        data: {
          username: payload.username,
          password: payload.password,
          totp: await totp(prep.secret, Math.floor(later / 30000)),
        },
      }),
      200,
    );
  } finally {
    Date.now = realNow;
    f.restore();
  }
});
test("第九阶段：off authenticateAdmin仍拒绝失效/停用会话，控制台读请求每分钟240次后仍限流", async () => {
  const f = await fixture(),
    realNow = Date.now;
  try {
    off(f);
    for (let i = 0; i < 240; i++)
      expect(await call(f, "/api/me", { cookie: f.adminCookie }), 200);
    expect(await call(f, "/api/me", { cookie: f.adminCookie }), 429);
    const later = realNow() + 61000;
    Date.now = () => later;
    expect(await call(f, "/api/me", { cookie: f.adminCookie }), 200);
    f.db.raw
      .prepare("UPDATE platform_admins SET active=0 WHERE id='adm_fixture'")
      .run();
    expect(await call(f, "/api/me", { cookie: f.adminCookie }), 401);
    f.db.raw
      .prepare("UPDATE platform_admins SET active=1 WHERE id='adm_fixture'")
      .run();
    expect(await call(f, "/api/me", { cookie: f.adminCookie }), 401);
  } finally {
    Date.now = realNow;
    f.restore();
  }
});
test("第九阶段：非法ACCESS_MODE严格503 CONFIG_INVALID，off不放宽其他Secrets/主机名/Turnstile配置", async () => {
  const f = await fixture();
  try {
    for (const value of [
      "OFF",
      "ON",
      "off ",
      " off",
      "false",
      "0",
      " ",
      "\n",
      0,
      false,
      null,
      {},
      [],
    ]) {
      f.env.ACCESS_MODE = value;
      for (const url of [origin + "/", "https://school.test/"]) {
        const res = await f.request(url);
        assert.equal(res.status, 503);
        assert.equal((await res.json()).code, "CONFIG_INVALID");
      }
    }
    off(f);
    const host = f.env.TENANT_HOST;
    f.env.CONSOLE_HOST = host;
    expect(await call(f), 503);
    f.env.CONSOLE_HOST = "console.school.test";
    for (const k of [
      "FIELD_KEY",
      "BACKUP_KEY",
      "HMAC_KEY",
      "PW_PEPPER",
      "PLATFORM_SETUP_KEY",
      "TURNSTILE_SECRET",
      "TURNSTILE_SITE_KEY",
    ]) {
      const v = f.env[k];
      delete f.env[k];
      expect(await call(f), 503);
      f.env[k] = v;
    }
  } finally {
    f.restore();
  }
});
test("第九阶段：on/off租户端响应及CSP一致，租户域名下控制台文件和接口始终404", async () => {
  const f = await fixture();
  try {
    const s = { ...(await setup(f)), f },
      paths = [
        "/",
        "/assets/tenant.js",
        "/assets/tenant.css",
        "/" + s.t.slug + "/login",
        "/console-assets/console.js",
        "/console.html",
        "/api/overview",
        "/_worker.js",
      ],
      before = [];
    for (const path of paths) {
      const res = await f.request("https://school.test" + path);
      before.push({
        status: res.status,
        text: await res.text(),
        csp: res.headers.get("content-security-policy"),
      });
    }
    const a = await request(s, "data/students");
    off(f);
    for (let i = 0; i < paths.length; i++) {
      const res = await f.request("https://school.test" + paths[i]);
      assert.deepEqual(
        {
          status: res.status,
          text: await res.text(),
          csp: res.headers.get("content-security-policy"),
        },
        before[i],
      );
      if (i >= 4) assert.equal(res.status, 404);
    }
    const b = await request(s, "data/students");
    assert.equal(a.status, 200);
    assert.deepEqual(a.body, b.body);
  } finally {
    f.restore();
  }
});
test("第九阶段：控制台登录文案在off不宣称Access已验证，on保持原文案且提示独立于应用内容", async () => {
  const source = (
    await readFile(new URL("../src/console/app.js", import.meta.url), "utf8")
  ).replace("\nboot();\n", "\n");
  for (const offMode of [false, true]) {
    class Node {
      constructor() {
        this.children = [];
        this.textContent = "";
      }
      setAttribute() {}
      addEventListener() {}
      append(...items) {
        this.children.push(...items);
      }
      replaceChildren(...items) {
        this.children = items;
      }
    }
    const root = new Node(),
      banner = offMode ? new Node() : null;
    const document = {
      querySelector: (s) =>
        s === "#root" ? root : s === "#access-notice" ? banner : new Node(),
      createElement: () => new Node(),
    };
    const ctx = vm.createContext({
      document,
      console,
      URL,
      setTimeout,
      clearTimeout,
    });
    vm.runInContext(source + "\nlogin();", ctx);
    const text = (n) => n.textContent + " " + n.children.map(text).join(" ");
    assert.equal(text(root).includes("Cloudflare Access 已验证"), !offMode);
    assert.ok(text(root).includes("账号和动态口令"));
    assert.equal(document.querySelector("#access-notice"), banner);
  }
});
