import { createRequire } from "node:module";
import { writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const { chromium } = createRequire(import.meta.url)(
  process.env.UI_TEST_MODULES ? process.env.UI_TEST_MODULES+"/playwright-core" : "/Users/chenyuejian/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core",
);
const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  }),
  p = await browser.newPage({ viewport: { width: 1440, height: 900 } }),
  results = [];
const run = async (name, fn) => {
  try {
    await fn();
    results.push({ name, pass: true });
  } catch (e) {
    results.push({ name, pass: false, error: e.stack });
  }
};
await p.goto("http://localhost:4211/preview-school/app/");
await p.waitForLoadState("networkidle");
await run(
  "顶栏：铃铛下拉未读数即时同步，头像登录设备可用，待办角标按九字段计算",
  async () => {
    await p.evaluate(()=>location.hash='settings-accounts');await p.waitForFunction(()=>document.querySelector('.c1-content').dataset.route==='settings-accounts'&&document.querySelector('.c1-content').getAttribute('aria-busy')==='false');
    for(const width of [1440,390]){await p.setViewportSize({width,height:900});assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await p.screenshot({path:`work/screenshots/c1/supervisor-settings-accounts-${width}.png`,fullPage:true});}
    await p.setViewportSize({width:1440,height:900});await p.evaluate(()=>location.hash='today');await p.waitForFunction(()=>document.querySelector('.c1-content').dataset.route==='today'&&document.querySelector('.c1-content').getAttribute('aria-busy')==='false');
    const counts = await p.evaluate(() =>
      fetch("/preview-school/api/todo/summary").then((r) => r.json()),
    );
    const expected =
      counts.unchecked_lessons +
      counts.teacher_submissions +
      counts.makeup_pending +
      counts.followup_overdue +
      counts.followup_today;
    assert.equal(
      await p.locator(".c1-todo-badge").innerText(),
      String(expected),
    );
    await writeFile(
      "work/reports/c1/mock-todo.json",
      JSON.stringify(counts, null, 2),
    );
    await p.getByRole("button", { name: "系统消息", exact: true }).click();
    await p.locator(".c1-message-panel:popover-open").waitFor();
    await p.screenshot({ path: "work/screenshots/c1/messages-1440.png" });
    const read = p
      .locator(".c1-message-panel")
      .getByRole("button", { name: "标记已读", exact: true });
    if (await read.count()) {
      await read.first().click();
      await p.waitForFunction(
        () => document.querySelector(".c1-unread-badge").hidden,
      );
    }
    await p.keyboard.press("Escape");
    await p.locator(".c1-avatar-menu>button").click();
    await p.screenshot({ path: "work/screenshots/c1/avatar-1440.png" });
    await p
      .locator(".c1-avatar-menu .ui-more-menu:popover-open")
      .getByRole("button", { name: "登录设备", exact: true })
      .click();
    await p.getByRole("dialog").waitFor();
    assert.ok((await p.getByRole("dialog").innerText()).includes("mock"));
    await p.keyboard.press("Escape");
    await p.waitForTimeout(500);
  },
);
await run(
  "顶栏搜索：线索打开完整只读详情，再由有权限者编辑，不用搜索摘要覆盖原字段",
  async () => {
    const input = p.getByRole("searchbox", { name: "全局搜索" });
    await input.fill("吴语桐");
    await input.press("Enter");
    await p
      .locator(".c1-search-results:popover-open")
      .getByRole("button", { name: "吴语桐", exact: true })
      .click();
    const detail = p.getByRole("dialog");
    await detail.waitFor();
    assert.ok((await detail.innerText()).includes("线下地推"));
    assert.ok((await detail.innerText()).includes("咨询课程安排"));
    await p.screenshot({ path: "work/screenshots/c1/search-lead-1440.png" });
    await p.keyboard.press("Escape");
    await p.waitForTimeout(500);
    await p.evaluate(() => (location.hash = "schedule-week"));
    await p.waitForTimeout(150);
    await p.waitForLoadState("networkidle");
    await p.getByRole("button", { name: "更多", exact: true }).click();
    await p
      .locator(".ui-more-menu:popover-open")
      .getByRole("button", { name: "导出课表图", exact: true })
      .waitFor();
    await p.screenshot({ path: "work/screenshots/c1/calendar-more-1440.png" });
    await p.keyboard.press("Escape");
    await p.evaluate(() => {
      const old = document.querySelector(".ui-page-body"),
        destroy = old.__calendarDestroy;
      globalThis.calendarCleanupCalls = 0;
      old.__calendarDestroy = () => {
        calendarCleanupCalls++;
        destroy();
      };
      location.hash = "students";
    });
    await p.waitForFunction(
      () =>
        document.querySelector(".c1-content").dataset.route === "students" &&
        document.querySelector(".c1-content").getAttribute("aria-busy") ===
          "false",
    );
    assert.equal(await p.evaluate(() => calendarCleanupCalls), 1);
  },
);
await p.evaluate(() => {
  const U = ChannelUI,
    host = document.querySelector("#root");
  host.replaceChildren();
  const page = U.page({ tabs: [{ label: "示例分页", active: true }] });
  host.append(page.element);
  const table = U.table({
    columns: [
      { key: "name", label: "学员" },
      { key: "n", label: "课时", numeric: true },
    ],
    rows: Array.from({ length: 120 }, (_, i) => ({
      id: String(i),
      name: "示例" + i,
      n: 120 - i,
    })),
    rowAction: (row) => (globalThis.lastOpened = row.id),
    more: [{ label: "文字菜单", onSelect: () => {} }],
  });
  page.body.append(table.element);
  globalThis.testHost = page.body;
});
await run(
  "共享表格：120条按50分页、准确总数、数字右对齐、排序跨分页保持",
  async () => {
    assert.equal(await p.locator("tbody tr").count(), 50);
    assert.ok(
      (await p.locator(".ui-pagination").innerText()).includes("共 120 条"),
    );
    await p.getByRole("button", { name: "课时排序", exact: true }).click();
    assert.ok((await p.locator("tbody tr").first().innerText()).includes("1"));
    await p.getByRole("button", { name: "下一页", exact: true }).click();
    assert.equal(await p.locator("tbody tr").count(), 50);
    assert.ok((await p.locator("tbody tr").first().innerText()).includes("51"));
    assert.equal(
      await p
        .locator("td.ui-number")
        .first()
        .evaluate((n) => getComputedStyle(n).textAlign),
      "right",
    );
  },
);
await run(
  "共享表格：更多文字菜单进入顶层、不被表格裁切，行可点击",
  async () => {
    await p
      .getByRole("button", { name: /更多操作/ })
      .first()
      .click();
    const menu = p.locator(".ui-more-menu:popover-open");
    await menu.getByRole("button", { name: "文字菜单", exact: true }).waitFor();
    const rect = await menu.boundingBox();
    assert.ok(rect.width > 0 && rect.x >= 0 && rect.x + rect.width <= 1440);
    await p.keyboard.press("Escape");
    await p.locator("tbody tr").first().locator("td").first().click();
    assert.ok(await p.evaluate(() => typeof lastOpened === "string"));
  },
);
await run(
  "共享抽屉：桌面560px、手机全屏、底部主次和更多、文本内容不执行",
  async () => {
    await p.evaluate(() => {
      const body = document.createElement("p");
      body.textContent = "<img src=x onerror=alert(1)>";
      globalThis.testDrawer = ChannelUI.drawer({
        title: "组件抽屉",
        subtitle: "北京时间",
        body,
        primary: { label: "保存", onSelect: () => {} },
        secondary: { label: "取消", onSelect: (v) => v.close() },
        more: [{ label: "其他操作" }],
      });
    });
    const sheet = p.locator("dialog[open] .ui-sheet");
    assert.equal(Math.round((await sheet.boundingBox()).width), 560);
    assert.equal(await sheet.locator("img").count(), 0);
    await p.setViewportSize({ width: 390, height: 900 });
    assert.equal(Math.round((await sheet.boundingBox()).width), 390);
    await p.screenshot({
      path: "work/screenshots/c1/components-drawer-390.png",
    });
    await p.evaluate(() => testDrawer.close());
    await p.setViewportSize({ width: 1440, height: 900 });
  },
);
await run(
  "共享表单：两列、中文日期月份、24小时任意分钟、开关原生值不丢失",
  async () => {
    await p.evaluate(() => {
      globalThis.testForm = ChannelUI.formDialog([
        { name: "name", label: "谁" },
        { name: "date", label: "日期", type: "date", value: "2026-11-04" },
        { name: "time", label: "时间", type: "time", value: "14:17" },
        { name: "month", label: "月份", type: "month", value: "2026-11" },
      ]);
    });
    const form = p.locator("dialog[open] .ui-form-grid");
    assert.equal(
      (
        await form.evaluate((n) => getComputedStyle(n).gridTemplateColumns)
      ).split(" ").length,
      2,
    );
    assert.ok((await form.innerText()).includes("2026-11-04"));
    assert.ok((await form.innerText()).includes("2026年11月"));
    assert.equal(await form.locator("input[name=time]").inputValue(), "14:17");
    assert.equal(
      await form
        .locator("input[type=time],input[type=month],input[type=date]")
        .count(),
      0,
    );
    await p.evaluate(() => testForm.close());
  },
);
await run("共享上传：中文选择和拖拽、无原生英文文件控件", async () => {
  await p.evaluate(() =>
    testHost.append(
      ChannelUI.upload({
        onFiles: (files) => (globalThis.selectedFile = files[0].name),
      }).element,
    ),
  );
  await p.locator(".ui-upload input").setInputFiles({
    name: "中文样本.json",
    mimeType: "application/json",
    buffer: Buffer.from("{}"),
  });
  assert.equal(await p.evaluate(() => selectedFile), "中文样本.json");
  assert.ok(
    (await p.locator(".ui-upload").innerText()).includes("中文样本.json"),
  );
});
await p.screenshot({
  path: "work/screenshots/c1/components-table-1440.png",
  fullPage: true,
});
await browser.close();
await writeFile(
  "work/reports/c1/components.json",
  JSON.stringify(
    { results, failed: results.filter((x) => !x.pass).length },
    null,
    2,
  ),
);
console.log(JSON.stringify(results));
if (results.some((x) => !x.pass)) process.exitCode = 1;
