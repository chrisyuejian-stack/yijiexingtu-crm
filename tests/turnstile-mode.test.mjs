import { installFoundation } from "./ui-dom-support.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { fixture } from "./support.mjs";
import { setup, request } from "./fixtures-credit.mjs";
import { adminCall } from "./fixtures-admin.mjs";
import { phoneIndex } from "../src/server/crypto.js";
const password = "PhaseTwoSecure9",
  mobile = "13911112222";
const csp =
  "default-src 'none'; script-src 'self' https://challenges.cloudflare.com; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-src https://challenges.cloudflare.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'";
const failure = { error: "手机号或密码不正确", code: "LOGIN_FAILED" };
const make = async (f) => ({ ...(await setup(f, 1)), f });
const ok = (r, status = 200) => {
  assert.equal(r.status, status, r.text);
  assert.ok(r.queries <= 40);
  return r;
};
async function send(
  s,
  { phone = mobile, pass = password, token, ip = "192.0.2.101" } = {},
) {
  const payload = { phone, password: pass };
  if (token !== undefined) payload.turnstile = token;
  return raw(s, "api/login", { method: "POST", data: payload, ip });
}
async function raw(
  s,
  path,
  { method = "GET", data, cookie, ip = "192.0.2.101" } = {},
) {
  const response = await s.f.request(
    "https://school.test/" + s.t.slug + "/" + path,
    {
      method,
      headers: {
        Origin: "https://school.test",
        "Content-Type": "application/json",
        "CF-Connecting-IP": ip,
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    },
  );
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {}
  return {
    status: response.status,
    text,
    body,
    headers: response.headers,
    queries: Number(response.headers.get("x-test-d1-queries")),
  };
}
function blockChallenges() {
  const previous = globalThis.fetch;
  let count = 0;
  globalThis.fetch = async (input, init) => {
    if (
      String(input instanceof Request ? input.url : input).includes(
        "challenges.cloudflare.com",
      )
    ) {
      count++;
      throw Error("测试禁止外联Turnstile");
    }
    return previous(input, init);
  };
  return {
    get count() {
      return count;
    },
    restore() {
      globalThis.fetch = previous;
    },
  };
}
function off(f) {
  f.env.TURNSTILE_MODE = "off";
  delete f.env.TURNSTILE_SITE_KEY;
  delete f.env.TURNSTILE_SECRET;
}
test("第九阶段二：未设置/空串/on要求双Key，登录必须siteverify，登录CSP与旧版逐字一致", async () => {
  const f = await fixture();
  try {
    const s = await make(f);
    for (const mode of [undefined, "", "on"]) {
      if (mode === undefined) delete f.env.TURNSTILE_MODE;
      else f.env.TURNSTILE_MODE = mode;
      const page = ok(await raw(s, "login"));
      assert.equal(page.headers.get("content-security-policy"), csp);
      assert.match(page.text, /name="turnstile-mode" content="on"/);
      for (const key of ["TURNSTILE_SITE_KEY", "TURNSTILE_SECRET"]) {
        const value = f.env[key];
        delete f.env[key];
        ok(await raw(s, "login"), 503);
        f.env[key] = value;
      }
      ok(await send(s, { token: "fixture-valid" }));
    }
  } finally {
    f.restore();
  }
});
test("第九阶段二：on拒绝siteverify失败/异常、hostname/action不符与缺少token，统一401并记失败日志", async () => {
  const f = await fixture();
  let previous;
  try {
    const s = await make(f);
    previous = globalThis.fetch;
    let count = 0,
      result;
    globalThis.fetch = async (input, init) => {
      if (String(input).includes("challenges.cloudflare.com")) {
        count++;
        if (result instanceof Error) throw result;
        return Response.json(result);
      }
      return previous(input, init);
    };
    const cases = [
      { success: false, hostname: "school.test", action: "login" },
      { success: true, hostname: "other.test", action: "login" },
      { success: true, hostname: "school.test", action: "other" },
      new Error("network"),
      { success: true, hostname: "school.test", action: "login" },
    ];
    for (let i = 0; i < cases.length; i++) {
      result = cases[i];
      assert.deepEqual(
        ok(await send(s, { token: i === 4 ? undefined : "fixture-valid" }), 401)
          .body,
        failure,
      );
    }
    assert.equal(count, 5);
    assert.equal(
      f.db.raw
        .prepare(
          "SELECT COUNT(*) n FROM auth_log WHERE tenant_id=? AND event IN('login_failed','login_locked')",
        )
        .get(s.t.id).n,
      5,
    );
  } finally {
    if (previous) globalThis.fetch = previous;
    f.restore();
  }
});
test("第九阶段二：off零挑战外联可建会话，错误/停用/不存在账号统一401，虚拟PBKDF2哈希仍执行", async () => {
  const f = await fixture();
  let guard, derive;
  try {
    const s = await make(f);
    off(f);
    guard = blockChallenges();
    const login = ok(await send(s));
    assert.match(
      login.headers.get("set-cookie"),
      /Path=\/schedule-a\/; HttpOnly; Secure; SameSite=Strict; Max-Age=43200/,
    );
    ok(await raw(s, "api/me", { cookie: login.headers.get("set-cookie") }));
    derive = crypto.subtle.deriveBits;
    const hashes = [];
    crypto.subtle.deriveBits = async function (params, ...args) {
      hashes.push({
        iterations: params.iterations,
        salt: Array.from(params.salt),
      });
      return derive.call(this, params, ...args);
    };
    assert.deepEqual(
      ok(await send(s, { pass: "IncorrectPassword9" }), 401).body,
      failure,
    );
    f.db.raw
      .prepare("UPDATE users SET active=0 WHERE tenant_id=? AND id=?")
      .run(s.t.id, s.user.id);
    assert.deepEqual(ok(await send(s), 401).body, failure);
    assert.deepEqual(
      ok(await send(s, { phone: "13999999999" }), 401).body,
      failure,
    );
    assert.equal(hashes.length, 3);
    assert.ok(hashes.every((x) => x.iterations === 100000));
    assert.ok(hashes[2].salt.every((x) => x === 0));
    assert.equal(guard.count, 0);
  } finally {
    if (derive) crypto.subtle.deriveBits = derive;
    guard?.restore();
    f.restore();
  }
});
test("第九阶段二：off缺双Key正常渲染、HTML无挑战域且CSP严格，非法模式503且其他Secrets仍必需", async () => {
  const f = await fixture();
  try {
    const s = await make(f);
    off(f);
    const page = ok(await raw(s, "login"));
    assert.match(page.text, /name="turnstile-mode" content="off"/);
    assert.ok(!page.text.includes("challenges.cloudflare.com"));
    assert.ok(!page.text.includes("正在加载人机验证"));
    assert.equal(
      page.headers.get("content-security-policy"),
      csp
        .replace(" https://challenges.cloudflare.com", "")
        .replace(
          "frame-src https://challenges.cloudflare.com",
          "frame-src 'none'",
        ),
    );
    // 即便残留双Key，off也不把它们传给前端或校验服务。
    f.env.TURNSTILE_SITE_KEY = "https://challenges.cloudflare.com/ignored";
    f.env.TURNSTILE_SECRET = "unused-secret";
    assert.ok(
      !ok(await raw(s, "login")).text.includes("challenges.cloudflare.com"),
    );
    for (const value of [
      "OFF",
      "off ",
      " off",
      "false",
      "0",
      "ON",
      " ",
      0,
      false,
      null,
    ]) {
      f.env.TURNSTILE_MODE = value;
      const r = ok(await raw(s, "login"), 503);
      assert.equal(r.body.code, "CONFIG_INVALID");
    }
    f.env.TURNSTILE_MODE = "off";
    for (const key of [
      "FIELD_KEY",
      "BACKUP_KEY",
      "HMAC_KEY",
      "PW_PEPPER",
      "PLATFORM_SETUP_KEY",
    ]) {
      const v = f.env[key];
      delete f.env[key];
      ok(await raw(s, "login"), 503);
      f.env[key] = v;
    }
  } finally {
    f.restore();
  }
});
test("第九阶段二：off同手机号三次失败锁十五分钟，跨IP仍锁、到期可恢复，失败文案和日志不变", async () => {
  const f = await fixture(),
    realNow = Date.now;
  let guard;
  try {
    const s = await make(f);
    off(f);
    guard = blockChallenges();
    for (let i = 0; i < 3; i++)
      assert.deepEqual(
        ok(await send(s, { pass: "BadPassword9" }), 401).body,
        failure,
      );
    const index = await phoneIndex(f.env, s.t.id, mobile),
      row = f.db.raw
        .prepare("SELECT locked_until FROM security_limits WHERE key=?")
        .get("login:" + s.t.id + ":" + index);
    assert.ok(row.locked_until >= realNow() + 899000);
    assert.deepEqual(
      ok(await send(s, { ip: "192.0.2.102" }), 401).body,
      failure,
    );
    assert.ok(
      f.db.raw
        .prepare(
          "SELECT COUNT(*) n FROM auth_log WHERE tenant_id=? AND event='login_locked'",
        )
        .get(s.t.id).n >= 1,
    );
    Date.now = () => row.locked_until + 1;
    ok(await send(s));
    assert.equal(guard.count, 0);
  } finally {
    Date.now = realNow;
    guard?.restore();
    f.restore();
  }
});
test("第九阶段二：off同IP十次失败锁一小时，换IP正常、到期恢复且不调用挑战服务", async () => {
  const f = await fixture(),
    realNow = Date.now;
  let guard;
  try {
    const s = await make(f);
    off(f);
    guard = blockChallenges();
    for (let i = 0; i < 10; i++)
      assert.deepEqual(
        ok(
          await send(s, {
            phone: "139" + String(10000000 + i),
            pass: "BadPassword9",
          }),
          401,
        ).body,
        failure,
      );
    const row = f.db.raw
      .prepare("SELECT locked_until FROM security_limits WHERE key=?")
      .get("login-ip:192.0.2.101");
    assert.ok(row.locked_until >= realNow() + 3599000);
    assert.deepEqual(ok(await send(s), 401).body, failure);
    ok(await send(s, { ip: "192.0.2.102" }));
    Date.now = () => row.locked_until + 1;
    ok(await send(s));
    assert.equal(guard.count, 0);
  } finally {
    Date.now = realNow;
    guard?.restore();
    f.restore();
  }
});
test("第九阶段二：Turnstile与Access四种组合独立，控制台校验/CSP和租户其他接口保持原样", async () => {
  const f = await fixture();
  try {
    const s = await make(f);
    let consoleCsp, applicationCsp;
    const keys = {
      site: f.env.TURNSTILE_SITE_KEY,
      secret: f.env.TURNSTILE_SECRET,
    };
    for (const access of ["on", "off"])
      for (const captcha of ["on", "off"]) {
        f.env.ACCESS_MODE = access;
        f.env.TURNSTILE_MODE = captcha;
        if (captcha === "off") {
          delete f.env.TURNSTILE_SITE_KEY;
          delete f.env.TURNSTILE_SECRET;
        } else {
          f.env.TURNSTILE_SITE_KEY = keys.site;
          f.env.TURNSTILE_SECRET = keys.secret;
        }
        const url = "https://console.school.test/";
        const anonymous = await f.request(url);
        assert.equal(anonymous.status, access === "on" ? 403 : 200);
        const page = await f.request(url, {
          headers: { "cf-access-jwt-assertion": f.access },
        });
        assert.equal(page.status, 200);
        const header = page.headers.get("content-security-policy");
        consoleCsp ??= header;
        assert.equal(header, consoleCsp);
        assert.ok(!header.includes("challenges.cloudflare.com"));
        const me = await f.request(url + "api/me", {
          headers: {
            "cf-access-jwt-assertion": f.access,
            Cookie: f.adminCookie,
          },
        });
        assert.equal(me.status, 200);
        const missing = await f.request(url + "api/me", {
          headers: { "cf-access-jwt-assertion": f.access },
        });
        assert.equal(missing.status, 401);
        const login = ok(
            await send(s, {
              token: captcha === "on" ? "fixture-valid" : undefined,
            }),
          ),
          cookie = login.headers.get("set-cookie");
        ok(await raw(s, "api/me", { cookie }));
        const app = ok(await raw(s, "app/", { cookie }));
        applicationCsp ??= app.headers.get("content-security-policy");
        assert.equal(
          app.headers.get("content-security-policy"),
          applicationCsp,
        );
        assert.ok(!applicationCsp.includes("challenges.cloudflare.com"));
        assert.deepEqual(
          ok(await raw(s, "api/data/students", { cookie })).body.items.map(
            (x) => x.id,
          ),
          s.students,
        );
        assert.equal(
          (await f.request("https://school.test/console-assets/console.js"))
            .status,
          404,
        );
      }
  } finally {
    f.restore();
  }
});
test("第九阶段二：off主管/教务/财务/教师/学员均可登录，首次强制改密和会话撤销流程保留", async () => {
  const f = await fixture();
  let guard;
  try {
    const s = await make(f);
    off(f);
    guard = blockChallenges();
    for (const [i, role] of [
      "supervisor",
      "academic",
      "finance",
      "teacher",
      "student",
    ].entries()) {
      const phone = "1382222" + String(1000 + i),
        created = ok(
          role === "supervisor"
            ? await adminCall(f, "tenants/" + s.t.id + "/supervisors", "POST", {
                name: "角色登录回归",
                phone,
                roles: [role],
              })
            : await request(s, "accounts", "POST", {
                name: "角色登录回归",
                phone,
                roles: [role],
                ...(role === "teacher" ? { teacher_id: s.teacher } : {}),
                ...(role === "student" ? { student_id: s.students[0] } : {}),
              }),
          201,
        );
      const login = ok(
        await send(s, {
          phone,
          pass: created.body.temporary_password,
          ip: "192.0.2." + (110 + i),
        }),
      );
      assert.equal(login.body.must_change, true);
      assert.deepEqual(login.body.user.roles, [role]);
      const cookie = login.headers.get("set-cookie");
      assert.match(
        cookie,
        new RegExp(
          "Max-Age=" +
            (["teacher", "student"].includes(role) ? 1209600 : 43200),
        ),
      );
      ok(await raw(s, "api/me", { cookie }));
      const blocked = ok(await raw(s, "api/data/students", { cookie }), 403);
      assert.equal(blocked.body.code, "PASSWORD_CHANGE_REQUIRED");
      ok(
        await raw(s, "api/password", {
          method: "POST",
          cookie,
          data: {
            old_password: created.body.temporary_password,
            password: "NewRoleSecure9Z",
          },
        }),
      );
      ok(await raw(s, "api/me", { cookie }), 401);
      const next = ok(
        await send(s, {
          phone,
          pass: "NewRoleSecure9Z",
          ip: "192.0.2." + (110 + i),
        }),
      );
      assert.equal(next.body.must_change, false);
    }
    assert.equal(guard.count, 0);
  } finally {
    guard?.restore();
    f.restore();
  }
});
class Node {
  constructor(tag = "div") {
    this.tag = tag;
    this.children = [];
    this.attrs = {};
    this.listeners = {};
    this._text = "";
  }
  set textContent(s) {
    this._text = String(s);
    this.children = [];
  }
  get textContent() {
    return this._text + this.children.map((x) => x.textContent || "").join(" ");
  }
  setAttribute(k, v) {
    this.attrs[k] = v;
  }
  append(...xs) {
    this.children.push(...xs);
  }
  replaceChildren(...xs) {
    this._text = "";
    this.children = xs;
  }
  addEventListener(k, fn) {
    this.listeners[k] = fn;
  }
  querySelectorAll(tag) {
    return this.children.flatMap((x) => [
      ...(x.tag === tag ? [x] : []),
      ...x.querySelectorAll(tag),
    ]);
  }
}
test("第九阶段二：实际前端on仍等待挑战token，off不插脚本/占位且无token直接提交，失败也不调用widget", async () => {
  const source = await readFile(
    process.env.TEST_BUNDLE === "1"
      ? "dist/assets/tenant.js"
      : "src/tenant/app.js",
    "utf8",
  );
  for (const mode of ["on", "off"]) {
    const root = new Node(),
      head = new Node("head"),
      toast = new Node(),
      sent = [],
      locations = [];
    let callback,
      failLogin = false,
      widgetCalls = 0;
    const document = {
      head,
      querySelector: (s) =>
        s === "#root"
          ? root
          : s === "#toast"
            ? toast
            : s.includes("tenant-base")
              ? { content: "/school/" }
              : s.includes("turnstile-mode")
                ? { content: mode }
                : s.includes("turnstile-key")
                  ? { content: "public-test-key" }
                  : null,
      createElement: (tag) => new Node(tag),
    };
    class FormData {
      constructor(form) {
        this.values = form
          .querySelectorAll("input")
          .map((x) => [x.attrs.name, x.value]);
      }
      [Symbol.iterator]() {
        return this.values[Symbol.iterator]();
      }
    }
    const window = {
      turnstile: {
        ready(fn) {
          widgetCalls++;
          fn();
        },
        render(node, options) {
          widgetCalls++;
          callback = options.callback;
          return 0;
        },
        reset() {
          widgetCalls++;
        },
      },
    };
    const context = vm.createContext({
      document,
      window,
      FormData,
      URL,
      Blob,
      console,
      setTimeout: () => 0,
      clearTimeout() {},
      location: {
        pathname: "/school/login",
        assign: (url) => locations.push(url),
      },
      fetch: async (url, init) => {
        assert.ok(!String(url).includes("challenges.cloudflare.com"));
        if (/public\/brand(\?lite=1)?$/.test(String(url)))
          return {
            ok: true,
            json: async () => ({ display_name: "登录回归机构" }),
          };
        sent.push(JSON.parse(init.body));
        return {
          ok: !failLogin,
          status: failLogin ? 401 : 200,
          json: async () => (failLogin ? failure : {}),
        };
      },
    });
    await installFoundation(context, Node, document);
    vm.runInContext(source, context);
    await new Promise((resolve) => setImmediate(resolve));
    const form = root.querySelectorAll("form")[0];
    assert.ok(form);
    for (const input of form.querySelectorAll("input"))
      input.value = input.attrs.name === "phone" ? mobile : password;
    if (mode === "on") {
      assert.ok(root.textContent.includes("正在加载人机验证"));
      assert.equal(head.children.length, 1);
      assert.match(
        head.children[0].attrs.src,
        /^https:\/\/challenges.cloudflare.com\//,
      );
      await form.listeners.submit({ preventDefault() {} });
      assert.equal(sent.length, 0);
      assert.equal(toast.textContent, "请先完成人机验证");
      head.children[0].listeners.load();
      callback("ui-token");
      await form.listeners.submit({ preventDefault() {} });
      assert.equal(sent[0].turnstile, "ui-token");
    } else {
      assert.ok(!root.textContent.includes("人机验证"));
      assert.equal(head.children.length, 0);
      await form.listeners.submit({ preventDefault() {} });
      assert.deepEqual(JSON.parse(JSON.stringify(sent[0])), {
        phone: mobile,
        password,
      });
      failLogin = true;
      await form.listeners.submit({ preventDefault() {} });
      assert.equal(toast.textContent, failure.error);
      assert.equal(widgetCalls, 0);
      assert.ok(!toast.textContent.includes("请先完成人机验证"));
    }
    assert.ok(locations.includes("/school/app/"));
  }
});
