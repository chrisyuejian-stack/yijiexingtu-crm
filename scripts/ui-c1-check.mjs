import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const { chromium } = createRequire(import.meta.url)(
  process.env.UI_TEST_MODULES
    ? process.env.UI_TEST_MODULES + "/playwright-core"
    : "/Users/chenyuejian/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core",
);
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
const results = [],
  requests = [];
const out = "work/screenshots/c1";
await mkdir(out, { recursive: true });
await mkdir("work/reports/c1", { recursive: true });
const routes = [
  ["today", "home"],
  ["todo-unchecked", "schedule"],
  ["todo-teacher", "attendance", "confirm"],
  ["todo-makeup", "attendance"],
  ["todo-followup", "followup"],
  ["todo-renewal", "packages"],
  ["schedule-week", "schedule"],
  ["schedule-fixed", "templates"],
  ["schedule-classes", "classes"],
  ["students", "students"],
  ["enrol-leads", "leads"],
  ["enrol-referrals", "referrals"],
  ["enrol-promo", "promo"],
  ["finance-income", "tuition"],
  ["finance-packages", "packages"],
  ["finance-pay", "teacher_pay"],
  ["finance-costs", "settlements"],
  ["finance-reports", "reports"],
  ["settings-teachers", "settings"],
  ["settings-accounts", "accounts"],
  ["settings-institution", "settings"],
  ["settings-import", "imports"],
  ["settings-logs", "logs"],
  ["settings-messages", "home"],
  ["settings-password", "profile"],
];
for (const [role, port] of [
  ["supervisor", 4211],
  ["academic", 4212],
  ["finance", 4213],
  ["teacher", 4214],
  ["student", 4215],
]) {
  const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      timezoneId: "Asia/Shanghai",
      locale: "en-US",
    }),
    p = await ctx.newPage(),
    errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  let next = 0;
  await ctx.route("**/api/**", async (route) => {
    const wait = Math.max(0, next - Date.now());
    next = Math.max(next, Date.now()) + 650;
    if (wait) await new Promise((r) => setTimeout(r, wait));
    await route.continue();
  });
  p.on("response", async (r) => {
    if (r.url().includes("/api/"))
      requests.push({ role, url: r.url(), status: r.status() });
  });
  await p.clock.install({ time: new Date("2026-11-04T20:00:00+08:00") });
  try {
    await p.goto(`http://localhost:${port}/preview-school/app/`);
    await p.waitForLoadState("networkidle");
    const staff = ["supervisor", "academic", "finance"].includes(role);
    if (staff)
      await p.waitForFunction(
        () =>
          document.querySelector(".c1-content")?.getAttribute("aria-busy") ===
          "false",
      );
    if (staff)
      assert.equal(
        await p.locator(".staff-nav>button").count(),
        { supervisor: 6, academic: 5, finance: 4 }[role],
      );
    const allowed = staff
      ? await p.evaluate(
          (routes) =>
            routes.filter(
              ([key, mod, act = "read"]) =>
                (enabled(mod, act) &&
                  (!(key.startsWith("todo-") || key.startsWith("enrol-")) ||
                    !me.user.roles.includes("finance")) &&
                  (!key.startsWith("finance-") ||
                    me.user.roles.some((r) =>
                      ["supervisor", "finance"].includes(r),
                    ))) ||
                (key === "settings-logs" && enabled("logs", "read_finance")),
            ),
          routes,
        )
      : [];
    for (const width of [1440, 390]) {
      await p.setViewportSize({ width, height: 900 });
      for (const [key] of staff ? allowed : [["personal-default"]]) {
        try {
          if (staff) {
            await p.evaluate((key) => (location.hash = key), key);
            await p.waitForTimeout(150);
            await p.waitForFunction((key) => {
              const c = document.querySelector(".c1-content");
              return (
                c?.dataset.route === key &&
                c.getAttribute("aria-busy") === "false"
              );
            }, key);
            await p.waitForLoadState("networkidle");
            await p.locator(".ui-page-body").waitFor();
          }
          assert.ok(
            await p.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
            "页面横向溢出",
          );
          if (role === "finance" && key === "today")
            assert.equal(await p.locator(".metrics-grid>.panel").count(), 3);
          assert.equal(errors.length, 0, errors.join(";"));
          await p.screenshot({
            path: `${out}/${role}-${key}-${width}.png`,
            fullPage: true,
          });
          results.push({ role, key, width, pass: true });
        } catch (e) {
          results.push({ role, key, width, pass: false, error: e.message });
          await p.screenshot({
            path: `${out}/failure-${role}-${key}-${width}.png`,
            fullPage: true,
          });
        }
      }
    }
    if (staff) {
      await p.setViewportSize({ width: 1440, height: 900 });
      await p.evaluate(() => (location.hash = "schedule-fixed"));
      await p.waitForLoadState("networkidle");
      await p.reload();
      await p.waitForLoadState("networkidle");
      assert.ok(p.url().endsWith("#schedule-fixed"));
      assert.equal(
        await p.locator(".ui-page-tabs [aria-current=page]").textContent(),
        "固定排课",
      );
      const input = p.getByRole("searchbox", { name: "全局搜索" });
      await input.fill("王小明");
      await input.press("Enter");
      await p.locator(".c1-search-results:popover-open").waitFor();
      await p.screenshot({ path: `${out}/${role}-search-1440.png` });
      await p.keyboard.press("Escape");
    }
  } catch (e) {
    results.push({ role, key: "shell", pass: false, error: e.stack });
  } finally {
    await ctx.close();
  }
}
await browser.close();
const result = {
  checked: results.length,
  failed: results.filter((x) => !x.pass).length,
  results,
  requests,
};
await writeFile(
  "work/reports/c1/browser.json",
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result));
if (result.failed || requests.some((x) => x.status >= 500 || x.status === 429))
  process.exitCode = 1;
