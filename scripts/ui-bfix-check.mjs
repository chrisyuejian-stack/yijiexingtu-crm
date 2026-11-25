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
  }),
  results = [];
await mkdir("work/screenshots/bfix", { recursive: true });
for (const width of [1440, 390]) {
  const ctx = await browser.newContext({
      viewport: { width, height: 900 },
      hasTouch: width === 390,
      isMobile: width === 390,
      timezoneId: "Asia/Shanghai",
    }),
    p = await ctx.newPage(),
    errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  try {
    await p.goto("http://localhost:4200/preview-school/app/");
    await p.locator(".metrics-grid").waitFor();
    await p.screenshot({
      path: `work/screenshots/bfix/home-${width}.png`,
      fullPage: true,
    });
    const counts = p.locator(".task-count");
    assert.equal(await counts.count(), 2);
    assert.equal(
      await counts.first().evaluate((n) => getComputedStyle(n).textAlign),
      "right",
    );
    if (width === 1440)
      assert.ok(
        (await p.locator(".staff-sidebar").evaluate((n) => n.scrollHeight)) <=
          900,
      );
    const nav = async (name) => {
      if (width === 390)
        await p.getByRole("button", { name: "打开导航", exact: true }).click();
      await p
        .locator(".staff-nav")
        .getByRole("button", { name, exact: true })
        .click();
    };
    await nav("学员档案");
    await p.locator(".student-entry").first().waitFor();
    await p.screenshot({
      path: `work/screenshots/bfix/students-${width}.png`,
      fullPage: true,
    });
    assert.equal(
      await p.locator(".student-course-tags").first().innerText(),
      "基础班课",
    );
    const more = p.getByRole("button", { name: /更多操作/ }).first();
    await more.click();
    const menu = p.locator(".ui-more-menu:popover-open");
    await menu.getByRole("button", { name: "查看", exact: true }).waitFor();
    assert.equal(await menu.getByRole("button", { name: /上移/ }).count(), 1);
    await p.keyboard.press("Escape");
    const picker = p
      .locator(".student-index .ui-list-tools .ui-picker-trigger")
      .first();
    await picker.click();
    await p.getByRole("option", { name: "在读", exact: true }).click();
    await p
      .getByRole("button", { name: /更多操作/ })
      .first()
      .click();
    assert.equal(
      await p
        .locator(".ui-more-menu:popover-open")
        .getByRole("button", { name: /上移|下移/ })
        .count(),
      0,
    );
    await p
      .locator(".ui-more-menu:popover-open")
      .getByRole("button", { name: "查看", exact: true })
      .click();
    const detail =
      width === 390 ? p.locator("dialog[open]") : p.locator(".student-detail");
    await detail
      .getByRole("heading", { name: "最近上课与点评", exact: true })
      .waitFor();
    for (const name of ["剩余课时", "累计缴费", "本月上课次数", "下次课"])
      assert.equal(
        await detail.getByRole("heading", { name, exact: true }).count(),
        1,
      );
    assert.ok((await detail.innerText()).includes("本节练习"));
    await p.screenshot({
      path: `work/screenshots/bfix/detail-${width}.png`,
      fullPage: true,
    });
    if (width === 390) {
      await p.keyboard.press("Escape");
      await p.waitForTimeout(300);
    }
    await nav("周课表");
    await p.locator(".b-week-grid").waitFor();
    await p
      .locator(".b-calendar-scroll")
      .evaluate((n) => (n.scrollTop = 8 * 88));
    await p.screenshot({
      path: `work/screenshots/bfix/week-${width}.png`,
      fullPage: true,
    });
    assert.equal(await p.locator(".b-calendar-page h1").count(), 0);
    const colors = await p
      .locator(".b-course[data-lesson]")
      .evaluateAll((nodes) => [
        ...new Set(nodes.map((n) => getComputedStyle(n).backgroundColor)),
      ]);
    assert.ok(colors.length >= 3, colors.join(","));
    assert.equal(
      await p.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    assert.deepEqual(errors, []);
    results.push({ width, status: "PASS", colors });
    console.log(
      "PASS BFIX " +
        width +
        "：六项修正、菜单显隐、真实汇总/点评、侧栏、标题、三种以上固定颜色",
    );
  } catch (e) {
    results.push({ width, status: "FAIL", error: e.stack });
    console.log("FAIL " + width + " " + e.stack);
    await p.screenshot({
      path: `work/screenshots/bfix/failure-${width}.png`,
      fullPage: true,
    });
  }
  await ctx.close();
}
await browser.close();
await writeFile(
  "work/reports/bfix-browser.json",
  JSON.stringify({ results }, null, 2) + "\n",
);
if (results.some((x) => x.status === "FAIL")) process.exitCode = 1;
