import { tenantAssets } from "../scripts/frontend-bundle.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { emulateD1, validateD1 } from "./d1-emulator.mjs";
import { LocalR2 } from "./r2.mjs";
import { AsyncLocalStorage } from "node:async_hooks";
import { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";
import sourceWorker from "../src/server/worker.js";
const worker =
  process.env.TEST_BUNDLE === "1"
    ? (await import("../dist/_worker.js")).default
    : sourceWorker;
import { newPassword, encrypt, totp, base32 } from "../src/server/crypto.js";
import { b64, bytes, sha } from "../src/server/core.js";
export class LocalD1 {
  constructor() {
    this.raw = new DatabaseSync(":memory:");
    this.limits = emulateD1(this.raw);
    this.context = new AsyncLocalStorage();
    this.queryLimit = 40;
    this.queryReports = [];
  }
  count(statements = 1) {
    const value = this.context.getStore();
    if (value) {
      value.queries++;
      value.statements += statements;
      if (value.queries > this.queryLimit)
        throw Error("D1_QUERY_BUDGET_EXCEEDED");
    }
  }
  async measure(fn, metadata = {}) {
    return this.context.run({ queries: 0, statements: 0 }, async () => {
      const response = await fn(),
        stats = { ...this.context.getStore() };
      response.headers.set("x-test-d1-queries", String(stats.queries));
      response.headers.set("x-test-d1-statements", String(stats.statements));
      this.queryReports.push({
        ...stats,
        status: response.status,
        ...metadata,
      });
      return response;
    });
  }
  prepare(query) {
    validateD1(query);
    this.limits.installRows();
    const db = this;
    return {
      query,
      params: [],
      bind(...p) {
        validateD1(query, p);
        this.params = p;
        return this;
      },
      async first() {
        db.count();
        return (
          db.limits.result(db.raw.prepare(query).get(...this.params)) || null
        );
      },
      async all() {
        db.count();
        return {
          results: db.limits.result(db.raw.prepare(query).all(...this.params)),
        };
      },
      async run() {
        db.count();
        const x = db.raw.prepare(query).run(...this.params);
        return { meta: { changes: Number(x.changes) } };
      },
    };
  }
  async batch(statements) {
    this.limits.installRows();
    for (const s of statements) validateD1(s.query, s.params);
    this.count(statements.length);
    this.raw.exec("BEGIN IMMEDIATE");
    try {
      const results = [];
      for (const s of statements) {
        const statement = this.raw.prepare(s.query);
        if (statement.columns().length)
          results.push({
            results: this.limits.result(statement.all(...s.params)),
            meta: { changes: 0 },
          });
        else
          results.push({
            meta: { changes: Number(statement.run(...s.params).changes) },
          });
      }
      this.raw.exec("COMMIT");
      return results;
    } catch (e) {
      this.raw.exec("ROLLBACK");
      throw e;
    }
  }
}
export async function fixture({ migrateIncome = true, migrateSettings = true, migratePlans = true, migrateAi = true, migrateGrowth = true, migratePlatform = true, migrateArticle = true, migrateProspects = true, migrateStorage = true } = {}) {
  const db = new LocalD1();
  db.raw.exec(
    await readFile(
      new URL("../migrations/0001_foundation.sql", import.meta.url),
      "utf8",
    ),
  );
  db.raw.exec(
    await readFile(
      new URL("../migrations/0003_scheduling.sql", import.meta.url),
      "utf8",
    ),
  );
  db.raw.exec(
    await readFile(
      new URL("../migrations/0004_credits.sql", import.meta.url),
      "utf8",
    ),
  );
  db.raw.exec(
    await readFile(
      new URL("../migrations/0005_integer_money.sql", import.meta.url),
      "utf8",
    ),
  );
  db.raw.exec(
    await readFile(
      new URL("../migrations/0006_finance.sql", import.meta.url),
      "utf8",
    ),
  );
  db.raw.exec(
    await readFile(
      new URL("../migrations/0007_settlement_fingerprint.sql", import.meta.url),
      "utf8",
    ),
  );
  db.raw.exec(
    await readFile(
      new URL("../migrations/0008_mobile_reviews.sql", import.meta.url),
      "utf8",
    ),
  );
  db.raw.exec(
    await readFile(
      new URL("../migrations/0009_tools.sql", import.meta.url),
      "utf8",
    ),
  );
  db.raw.exec(
    await readFile(
      new URL("../migrations/0010_promo.sql", import.meta.url),
      "utf8",
    ),
  );
  db.raw.exec(
    await readFile(
      new URL("../migrations/0011_promo_image_limits.sql", import.meta.url),
      "utf8",
    ),
  );
  db.raw.exec(
    await readFile(
      new URL("../migrations/0012_ui_rebuild.sql", import.meta.url),
      "utf8",
    ),
  );
  db.raw.exec(
    await readFile(
      new URL("../migrations/0013_promo_rebuild.sql", import.meta.url),
      "utf8",
    ),
  );
  db.raw.exec(await readFile(new URL("../migrations/0014_debt_and_balance.sql", import.meta.url), "utf8"));
  db.raw.exec(await readFile(new URL("../migrations/0015_delete_capabilities.sql", import.meta.url), "utf8"));
  db.raw.exec(await readFile(new URL("../migrations/0016_page_query_indexes.sql", import.meta.url), "utf8"));
  db.raw.exec(await readFile(new URL("../migrations/0017_student_schedule_indexes.sql", import.meta.url), "utf8"));
  if (migrateIncome) db.raw.exec(await readFile(new URL("../migrations/0018_credit_income_and_schedule_guards.sql", import.meta.url), "utf8"));
  db.raw.exec(await readFile(new URL("../migrations/0019_identity_and_institutions.sql", import.meta.url), "utf8"));
  if(migrateSettings) db.raw.exec(await readFile(new URL("../migrations/0020_settings_and_templates.sql", import.meta.url), "utf8"));
  if(migrateSettings && migratePlans) db.raw.exec(await readFile(new URL("../migrations/0021_course_plans.sql", import.meta.url), "utf8"));
  if(migrateSettings && migratePlans && migrateAi) db.raw.exec(await readFile(new URL("../migrations/0022_content_and_ai.sql", import.meta.url), "utf8"));
  if(migrateSettings && migratePlans && migrateAi && migrateGrowth) db.raw.exec(await readFile(new URL("../migrations/0023_feedback_and_growth_reports.sql", import.meta.url), "utf8"));
  if(migrateSettings && migratePlans && migrateAi && migrateGrowth && migratePlatform) db.raw.exec(await readFile(new URL("../migrations/0024_platform_management.sql", import.meta.url), "utf8"));
  if(migrateSettings && migratePlans && migrateAi && migrateArticle) db.raw.exec(await readFile(new URL("../migrations/0025_article_metadata.sql", import.meta.url), "utf8"));
  if(migrateSettings && migratePlans && migrateProspects) db.raw.exec(await readFile(new URL('../migrations/0026_plan_prospects.sql',import.meta.url),'utf8'));
  if(migrateSettings && migrateStorage) db.raw.exec(await readFile(new URL('../migrations/0027_gallery_storage.sql',import.meta.url),'utf8'));
  if(migrateSettings && migratePlans && migrateStorage) db.raw.exec(await readFile(new URL('../migrations/0028_plan_v2.sql',import.meta.url),'utf8'));
  // The legacy referral tests run with the persisted platform switch enabled.
  db.raw
    .prepare(
      "INSERT INTO platform_state(id,value) VALUES('referrals_enabled','1')",
    )
    .run();
  const env = {
    CHANNEL_DB: db,
    CHANNEL_BACKUPS: new LocalR2(),
    CHANNEL_MEDIA: new LocalR2(),
    BACKUP_KEY: b64(bytes(32)),
    TENANT_HOST: "school.test",
    CONSOLE_HOST: "console.school.test",
    FIELD_KEY: b64(bytes(32)),
    HMAC_KEY: b64(bytes(32)),
    PLATFORM_PHONE_HMAC_KEY: b64(bytes(32)),
    PW_PEPPER: b64(bytes(32)),
    PLATFORM_SETUP_KEY: b64(bytes(32)),
    TURNSTILE_SECRET: "test-only-secret",
    TURNSTILE_SITE_KEY: "test-only-key",
    ACCESS_ISSUER:
      "https://test-" +
      crypto.randomUUID().slice(0, 8) +
      ".cloudflareaccess.com",
    ACCESS_AUD: "fixture-audience",
    ACCESS_EMAILS: "fixture@example.test",
  };
  env.ASSETS = {
    fetch: async (req) => {
      const pathname = new URL(req.url).pathname;
      const map = {
        "/tenant.html": "src/tenant/index.html",
        "/share/index.html": "src/share/index.html",
        "/console.html": "src/console/index.html",
        "/assets/tenant.js": "src/tenant/app.js",
        "/assets/tenant.css": "src/tenant/app.css",
        "/console-assets/pinyin-pro.js": "src/console/vendor/pinyin-pro.js",
        "/console-assets/console.js": "src/console/app.js",
        "/console-assets/console.css": "src/console/app.css",
      };
      if (!map[pathname]) return new Response("not found", { status: 404 });
      if (
        process.env.TEST_BUNDLE !== "1" &&
        ["/assets/tenant.js", "/assets/tenant.css"].includes(pathname)
      ) {
        const assets = await tenantAssets();
        return new Response(pathname.endsWith(".js") ? assets.js : assets.css, {
          headers: {
            "Content-Type": pathname.endsWith(".js")
              ? "text/javascript"
              : "text/css",
          },
        });
      }
      return new Response(
        await readFile(
          process.env.TEST_BUNDLE === "1" ? "dist" + pathname : map[pathname],
        ),
        {
          headers: {
            "Content-Type": pathname.endsWith(".js")
              ? "text/javascript"
              : pathname.endsWith(".css")
                ? "text/css"
                : "text/html",
          },
        },
      );
    },
  };
  const keys = await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["sign", "verify"],
    ),
    jwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
  jwk.kid = "fixture";
  const url64 = (x) => Buffer.from(JSON.stringify(x)).toString("base64url"),
    header = url64({ alg: "RS256", kid: "fixture" }),
    payload = url64({
      iss: env.ACCESS_ISSUER,
      aud: [env.ACCESS_AUD],
      email: env.ACCESS_EMAILS,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
    input = header + "." + payload;
  const signature = Buffer.from(
    await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      keys.privateKey,
      new TextEncoder().encode(input),
    ),
  ).toString("base64url");
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === env.ACCESS_ISSUER + "/cdn-cgi/access/certs")
      return Response.json({ keys: [jwk] });
    if (url === "https://challenges.cloudflare.com/turnstile/v0/siteverify") {
      const params = init.body;
      return Response.json({
        success: params.get("response") === "fixture-valid",
        hostname: "school.test",
        action: "login",
      });
    }
    return original(input, init);
  };
  // 仅测试夹具直接建平台会话；生产包中无此入口。
  const id = "adm_fixture",
    secret = base32(bytes(20)),
    password = await newPassword(env, "FixtureSecure8Z");
  db.raw
    .prepare(
      "INSERT INTO platform_admins(id,username,salt,digest,totp_enc,created_at) VALUES(?,?,?,?,?,?)",
    )
    .run(
      id,
      "fixture",
      password.salt,
      password.digest,
      await encrypt(env, secret, "platform:totp"),
      Date.now(),
    );
  const token = b64(bytes(32));
  db.raw
    .prepare(
      "INSERT INTO platform_sessions(token_hash,admin_id,expires_at,last_seen_at,ip,ua) VALUES(?,?,?,?,?,?)",
    )
    .run(
      await sha(token),
      id,
      Date.now() + 3600000,
      Date.now(),
      "test",
      "fixture",
    );
  const access = header + "." + payload + "." + signature;
  const request = async (url, init = {}) => {
    const response = await db.measure(
      () => {
        const req = new Request(url, init);
        if (init.cf) Object.defineProperty(req, "cf", { value: init.cf });
        return worker.fetch(req, env);
      },
      { url: String(url), method: init.method || "GET" },
    );
    return response;
  };
  return {
    env,
    db,
    request,
    access,
    adminCookie: "__Host-channel_console=" + token,
    restore() {
      if (process.env.QUERY_REPORT_DIR) {
        mkdirSync(process.env.QUERY_REPORT_DIR, { recursive: true });
        writeFileSync(
          process.env.QUERY_REPORT_DIR + "/" + crypto.randomUUID() + ".json",
          JSON.stringify(db.queryReports),
        );
      }
      globalThis.fetch = original;
      db.limits.close();
      db.raw.close();
      if (db.queryReports.some((x) => x.queries > db.queryLimit))
        throw Error("HTTP 请求超过 D1 查询预算");
    },
  };
}
