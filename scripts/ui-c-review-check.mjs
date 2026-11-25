import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(
  process.env.UI_TEST_MODULES
    ? process.env.UI_TEST_MODULES + "/playwright-core"
    : "/Users/chenyuejian/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core",
);
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
const out = process.env.C_REVIEW_OUT || "work/screenshots/C-review";
const base = Number(process.env.UI_C_PORT_BASE || 4365);
const results = [];
await mkdir(out, { recursive: true });

async function run(name, fn) {
  try {
    await fn();
    results.push({ name, pass: true });
  } catch (e) {
    results.push({ name, pass: false, error: e.stack });
  }
}
async function pageFor(role, width = 1440) {
  const context = await browser.newContext({
    viewport: { width, height: 900 },
    timezoneId: "Asia/Shanghai",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.install({ time: new Date("2026-11-04T20:00:00+08:00") });
  const offset = { console: 0, supervisor: 1, finance: 3, teacher: 4 }[role];
  await page.goto(
    role === "console"
      ? "http://127.0.0.1:" + base + "/"
      : "http://localhost:" + (base + offset) + "/preview-school/app/",
  );
  async function shot(name, target = page) {
    assert.deepEqual(errors, []);
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await target.screenshot({
      path: out + "/" + name + "-" + width + ".png",
      ...(target === page ? { fullPage: true } : {}),
    });
  }
  return { context, page, shot };
}
async function go(page, key) {
  await page.evaluate((value) => {
    location.hash = value;
  }, key);
  await page.waitForFunction((value) => {
    const main = document.querySelector(".c1-content");
    return (
      main?.dataset.route === value &&
      main.getAttribute("aria-busy") === "false"
    );
  }, key);
}
const content = (page) => page.locator(".c1-content");
try {
  const { context, page, shot } = await pageFor("supervisor");
  const text = () => content(page).innerText();
  await run(
    "主管今天：人工到期项先于系统项，且标明学员与日期状态",
    async () => {
      await go(page, "today");
      const copy = await text();
      for (const name of ["杜锦程", "夏安然"])
        assert.match(copy, new RegExp(name + " · [^\n]+ · 今天"));
      assert.match(copy, /未关联学员 · [^\n]+ · 逾期/);
      assert.ok(
        copy.indexOf("夏安然 ·") < copy.indexOf("学习阶段已到期 · 今天"),
      );
      await shot("主管今天");
    },
  );
  await run("未销课：单一真实总数，无多余翻页", async () => {
    await go(page, "todo-unchecked");
    const list = content(page).locator(".ui-data-table");
    assert.equal(await list.locator(".ui-pagination").count(), 1);
    assert.match(await list.locator(".ui-pagination").innerText(), /共 4 条/);
    assert.equal(await list.locator(".ui-pagination button").count(), 0);
    assert.doesNotMatch(await text(), /已加载 \d+ 条/);
    await shot("待办-未销课");
  });
  await run("教师提交：只显示一个空状态和第一步", async () => {
    await go(page, "todo-teacher");
    assert.equal(await content(page).locator(".ui-empty").count(), 1);
    assert.doesNotMatch(await text(), /已加载 \d+ 条|共 0 条/);
    assert.equal(
      await content(page).getByRole("button", { name: "查看未销课" }).count(),
      1,
    );
    await shot("待办-教师提交");
  });
  await run("跟进：只看我的开关按登录人筛选", async () => {
    await go(page, "todo-followup");
    const toggle = page.getByRole("switch", { name: "只看我的" });
    assert.equal(await toggle.getAttribute("aria-checked"), "false");
    await shot("待办-跟进");
    const req = page.waitForRequest(
      (r) =>
        r.url().includes("/api/c2/followups?group=today") &&
        !r.url().endsWith("owner="),
    );
    await toggle.click();
    await req;
    await page
      .getByRole("switch", { name: "只看我的", checked: true })
      .waitFor();
    await page.waitForLoadState("networkidle");
    await shot("待办-只看我的");
  });
  await run("续费：最近联系为北京时间日期，无 ISO 时间", async () => {
    await go(page, "todo-renewal");
    assert.match(await text(), /2026-10-30/);
    assert.doesNotMatch(await text(), /\d{4}-\d\d-\d\dT\d\d:\d\d[^\s]*\+08:00/);
    await shot("待办-续费");
  });
  await run("周课表：聚合块标签可见，点击可展开", async () => {
    await go(page, "schedule-week");
    const group = page.locator(".c2-overflow");
    assert.ok((await group.count()) >= 5);
    for (const item of await group.all())
      assert.match(await item.innerText(), /＋\d+ 节/);
    await shot("周课表");
    const target = group.filter({ hasText: "＋2 节" }).first();
    await shot("聚合特写", target);
    await target.click();
    await page.locator("dialog[open]").waitFor();
    assert.ok((await page.locator("dialog[open] button").count()) >= 3);
    await shot("聚合展开");
    await page.keyboard.press("Escape");
  });
  await run("招生：线索和推广中心可见，合作升学隐藏", async () => {
    await go(page, "enrol-leads");
    assert.doesNotMatch(await text(), /合作升学/);
    assert.equal(
      await content(page)
        .getByRole("button", { name: "推广中心", exact: true })
        .count(),
      1,
    );
    await shot("招生");
  });
  await context.close();

  const finance = await pageFor("finance");
  const fp = finance.page;
  const due = /¥24,440 · 另有 8 笔待核对/;
  await run("财务今天和收款页待收金额一致，且可按学员名检索", async () => {
    await go(fp, "today");
    assert.match(await content(fp).innerText(), due);
    await go(fp, "finance-income");
    assert.match(await content(fp).innerText(), due);
    const row = content(fp)
      .locator("tbody tr")
      .filter({ hasText: "¥4,000" })
      .first();
    assert.ok(await row.count(), await content(fp).innerText());
    const name = (await row.locator("td").nth(1).innerText()).trim();
    assert.ok(name);
    await content(fp).getByRole("searchbox").fill(name);
    assert.match(await row.innerText(), /¥4,000/);
    await content(fp).getByRole("searchbox").clear();
    await finance.shot("财务-收款");
  });
  await run("全部课时流水：学员姓名列有内容", async () => {
    await go(fp, "finance-packages");
    await content(fp)
      .getByRole("button", { name: "更多", exact: true })
      .first()
      .click();
    await fp.getByRole("button", { name: "全部课时流水", exact: true }).click();
    await content(fp).getByRole("button", { name: "返回课时包" }).waitFor();
    const cell = content(fp).locator("tbody tr").first().locator("td").nth(1);
    assert.ok((await cell.innerText()).trim());
    await finance.shot("财务-课时流水");
    await fp.keyboard.press("Escape");
  });
  await run("月报：六个月同一比例尺、图例、数值列对齐", async () => {
    await go(fp, "finance-reports");
    const chart = fp.locator(".c3-trend");
    assert.equal(await chart.locator(":scope > section").count(), 6);
    assert.match(
      await fp.locator(".c3-trend-legend").innerText(),
      /收入\s*课酬\s*成本/,
    );
    const scaled = await chart.locator("[role=img]").evaluateAll((nodes) =>
      nodes.map((e) => ({
        value: Number(e.getAttribute("aria-label").replace(/[^0-9.\-]/g, "")),
        height: e.getBoundingClientRect().height,
      })),
    );
    const max = Math.max(...scaled.map((x) => Math.abs(x.value)));
    assert.ok(max > 0);
    for (const { value, height } of scaled)
      assert.equal(height, Math.round((Math.abs(value) / max) * 20) * 4);
    const cells = await content(fp)
      .locator("tbody td.ui-number .ui-cell-body")
      .all();
    assert.ok(cells.length);
    assert.equal(
      await cells[0].evaluate((e) => getComputedStyle(e).justifyContent),
      "flex-end",
    );
    assert.doesNotMatch(await content(fp).innerText(), /¥-/);
    await finance.shot("月度报表");
  });
  await finance.context.close();

  const teacher = await pageFor("teacher", 390);
  const tp = teacher.page;
  const teacherNav = async (key) => {
    await tp.locator(".personal-nav button[data-key=" + key + "]").click();
    await tp.waitForFunction((value) => {
      const main = document.querySelector(".personal-content");
      return (
        main?.dataset.personalTab === value &&
        main.getAttribute("aria-busy") === "false"
      );
    }, key);
  };
  await run("教师今天：已开始未销课显示待点名", async () => {
    await teacherNav("today");
    const row = tp
      .locator(".c3-personal-course")
      .filter({ hasText: "15:30" })
      .filter({ hasText: "罗思远" });
    assert.match(await row.innerText(), /待点名/);
    assert.doesNotMatch(await row.innerText(), /待上课/);
    await teacher.shot("教师-今天");
  });
  await run("教师学生页：紧凑列表、可搜索、可打开记录", async () => {
    await teacherNav("students");
    const list = tp.locator(".c3-teacher-student");
    assert.ok((await list.count()) >= 11);
    assert.doesNotMatch(
      await tp.locator(".personal-content").innerText(),
      /排序范围|恢复默认顺序|当前完整结果/,
    );
    await teacher.shot("教师-学生");
    const name = await list.first().locator("strong").innerText();
    await tp.getByRole("searchbox").fill(name);
    await list.first().click();
    await tp
      .locator("dialog[open]")
      .getByRole("heading", { name: new RegExp(name + " · 上课记录") })
      .waitFor();
  });
  await teacher.context.close();

  const consoleView = await pageFor("console");
  await run("控制台隐藏合作升学推荐菜单", async () => {
    const side = consoleView.page.locator("aside");
    await side.getByRole("button", { name: "推广中心", exact: true }).waitFor();
    assert.doesNotMatch(await side.innerText(), /合作升学推荐/);
    await consoleView.shot("控制台菜单");
  });
  await consoleView.context.close();
} finally {
  await browser.close();
  const report = {
    cases: results.length,
    failed: results.filter((x) => !x.pass).length,
    results,
  };
  await writeFile(
    "work/reports/c-review/browser.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
  if (report.failed) process.exitCode = 1;
}
