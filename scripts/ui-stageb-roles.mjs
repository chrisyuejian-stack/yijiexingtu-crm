import { createRequire } from "node:module";
import { writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const req = createRequire(import.meta.url),
  { chromium } = req(
    process.env.UI_TEST_MODULES
      ? process.env.UI_TEST_MODULES + "/playwright-core"
      : "/Users/chenyuejian/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core",
  );
const browser = await chromium.launch({
    executablePath:
      process.env.CHROME_PATH ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  }),
  results = [];
for (const [role, port] of [
  ["teacher", 4196],
  ["student", 4197],
  ["academic", 4194],
  ["finance", 4195],
]) {
  const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      timezoneId: "Asia/Shanghai",
      hasTouch: true,
      isMobile: true,
    }),
    page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto(`http://localhost:${port}/preview-school/app/`);
    await page
      .locator(
        role === "teacher" || role === "student"
          ? ".personal-frame"
          : ".metrics-grid",
      )
      .waitFor();
    const me = await page.evaluate(() =>
      fetch(
        document.querySelector("meta[name=tenant-base]").content + "api/me",
      ).then((r) => r.json()),
    );
    assert.ok(me.user.roles.includes(role));
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    if (role === "academic") {
      assert.ok(
        !(await page.locator(".metrics-grid").innerText()).includes("¥"),
      );
      await page.getByRole("button", { name: "打开导航", exact: true }).click();
      assert.equal(
        await page
          .locator(".staff-nav")
          .getByRole("button", { name: "账号与权限", exact: true })
          .count(),
        0,
      );
      await page
        .locator(".staff-nav")
        .getByRole("button", { name: "学员档案", exact: true })
        .click();
      await page
        .locator(".student-index .ui-row")
        .first()
        .getByRole("button", { name: "查看", exact: true })
        .click();
      await page
        .locator("dialog")
        .getByRole("button", { name: "开通学员账号", exact: true })
        .waitFor();
      assert.ok(
        !(await page.locator("dialog").innerText()).includes("累计缴费"),
      );
      assert.equal(
        await page
          .locator("dialog")
          .getByRole("button", { name: "查看完整联系方式", exact: true })
          .count(),
        0,
      );
    }
    if (role === "finance") {
      await page.getByRole("button", { name: "打开导航", exact: true }).click();
      await page
        .locator(".staff-nav")
        .getByRole("button", { name: "周课表", exact: true })
        .click();
      await page.locator(".b-week-grid").waitFor();
      assert.equal(
        await page
          .getByRole("button", { name: "＋ 新建课程", exact: true })
          .count(),
        0,
      );
      assert.equal(await page.locator(".mobile-move-tools").count(), 0);
    }
    if (role === "teacher" || role === "student")
      assert.equal(await page.locator(".staff-nav").count(), 0);
    assert.deepEqual(errors, []);
    results.push({ role, status: "PASS" });
    console.log(
      "PASS B-ROLE " +
        role +
        "：真实会话/角色、原权限入口、金额显隐、窄屏与无脚本异常",
    );
  } catch (e) {
    results.push({ role, status: "FAIL", error: e.stack });
    console.log("FAIL " + role + " " + e.message);
  }
  await context.close();
}
await browser.close();
await writeFile(
  "work/reports/stage10b/roles.json",
  JSON.stringify({ results }, null, 2) + "\n",
);
if (results.some((x) => x.status === "FAIL")) process.exitCode = 1;
