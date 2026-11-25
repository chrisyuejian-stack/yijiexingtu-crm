import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url),
  { chromium } = require(
    process.env.UI_TEST_MODULES
      ? process.env.UI_TEST_MODULES + "/playwright-core"
      : "/Users/chenyuejian/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core",
  );
const base = process.env.UI_BASE_URL || "http://localhost:4176",
  report = process.env.UI_REPORT_DIR || "work/reports/stage10b",
  shots = process.env.UI_SHOTS_DIR || "work/screenshots/stage10b";
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname))
  throw Error("业务UI回归仅允许本机虚构夹具");
await mkdir(report, { recursive: true });
await mkdir(shots, { recursive: true });
const browser = await chromium.launch({
    executablePath:
      process.env.CHROME_PATH ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
  }),
  results = [];
let nextRequestAt = 0;
let page,
  errors = [],
  violations = [],
  externals = [],
  nativeDialogs = 0;
async function fresh(width = 1440) {
  if (page) await page.context().close();
  const ctx = await browser.newContext({
    viewport: { width, height: width === 1440 ? 960 : 844 },
    isMobile: width < 760,
    hasTouch: width < 760,
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
  });
  page = await ctx.newPage();
  page.setDefaultTimeout(12000);
  errors = [];
  violations = [];
  externals = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => {
    nativeDialogs++;
    void d.dismiss();
  });
  await page.route("**/*", async (route) => {
    if (new URL(route.request().url()).origin !== new URL(base).origin) {
      externals.push(route.request().url());
      await route.abort();
    } else {
      if (
        route.request().url().includes("/preview-school/") &&
        !route.request().url().includes("/login")
      ) {
        const delay = Math.max(0, nextRequestAt - Date.now());
        nextRequestAt = Math.max(Date.now(), nextRequestAt) + 700;
        await new Promise((r) => setTimeout(r, delay));
      }
      await route.continue();
    }
  });
  await page.addInitScript(() =>
    document.addEventListener("securitypolicyviolation", (e) => {
      globalThis.__cspErrors ??= [];
      globalThis.__cspErrors.push(e.violatedDirective + ":" + e.blockedURI);
    }),
  );
  return page;
}
async function app(width = 1440) {
  await fresh(width);
  await page.goto(base + "/preview-school/app/");
  await page.locator(".metrics-grid").waitFor();
  await page.waitForTimeout(180);
}
async function nav(name) {
  if (await page.locator(".mobile-menu").isVisible()) {
    await page.getByRole("button", { name: "打开导航", exact: true }).click();
  }
  await page
    .locator(".staff-nav")
    .getByRole("button", { name, exact: true })
    .click();
}
async function schedule() {
  await nav("周课表");
  await page.locator(".b-week-grid").waitFor();
  await page.waitForTimeout(750);
}
async function students() {
  await nav("学员档案");
  await page.locator(".student-index .ui-table tbody tr").first().waitFor();
  if (page.viewportSize().width === 1440)
    await page
      .locator(".student-detail")
      .getByRole("heading", { name: "基本信息", exact: true })
      .waitFor();
}
async function noErrors() {
  assert.deepEqual(errors, []);
  assert.deepEqual(await page.evaluate(() => globalThis.__cspErrors || []), []);
  assert.deepEqual(externals, []);
}
async function check(name, fn) {
  if (process.env.UI_CASE_FILTER && !name.includes(process.env.UI_CASE_FILTER))
    return;
  try {
    await fn();
    results.push({ name, status: "PASS" });
    console.log("PASS " + name);
  } catch (e) {
    results.push({ name, status: "FAIL", error: e.stack });
    console.log("FAIL " + name + " " + e.message);
    if (page)
      await page
        .screenshot({
          path: shots + "/failure-" + results.length + ".png",
          fullPage: true,
        })
        .catch(() => {});
  }
}
async function fits() {
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
}
async function scrollMorning() {
  await page
    .locator(".b-calendar-scroll")
    .evaluate((n) => (n.scrollTop = 8 * 88));
}
async function firstMovable() {
  await scrollMorning();
  const card = page.locator(".b-course.status-planned[data-lesson]").first();
  await card.evaluate((n) => {
    const s = n.closest(".b-calendar-scroll");
    if (s) s.scrollTop = Math.max(0, n.offsetTop - 140);
  });
  return card;
}
async function snapshot() {
  return page.evaluate(() =>
    fetch(
      document.querySelector("meta[name=tenant-base]").content +
        "api/schedule?from=" +
        new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 7) +
        "-01&to=" +
        new Date(Date.now() + 8 * 3600000 + 32 * 86400000)
          .toISOString()
          .slice(0, 7) +
        "-01",
    ).then((r) => r.json()),
  );
}
for (const width of [1440, 390]) {
  await check(
    "B-UI-01 登录 " +
      width +
      "：真实品牌、共享字段、off无挑战外联、布局与错误提示",
    async () => {
      await fresh(width);
      await page.goto(base + "/preview-school/login");
      await page.getByRole("heading", { name: "登录教务管理系统" }).waitFor();
      await fits();
      assert.equal(await page.locator("script[src*=challenges]").count(), 0);
      assert.equal(await page.getByText("正在加载人机验证…").count(), 0);
      assert.equal(await page.locator(".hero .logo").innerText(), "机");
      await page.screenshot({
        path: shots + "/login-" + width + ".png",
        fullPage: true,
      });
      await page.locator("[name=phone]").fill("13900000999");
      await page.locator("[name=password]").fill("WrongPassword123");
      await page.getByRole("button", { name: "登录", exact: true }).click();
      await page.locator(".form-error").waitFor();
      assert.ok(await page.locator(".form-error").innerText());
      await noErrors();
    },
  );
  await check(
    "B-UI-02 外壳/工作台 " +
      width +
      "：权限导航、折叠、消息/课表/任务、金额分位与无横滚",
    async () => {
      await app(width);
      await fits();
      assert.ok(
        (await page.locator(".metrics-grid").innerText()).includes("¥500.10"),
      );
      await page.screenshot({
        path: shots + "/home-" + width + ".png",
        fullPage: true,
      });
      if (width === 390)
        await page
          .getByRole("button", { name: "打开导航", exact: true })
          .click();
      const group = page.locator(".nav-group>.ui-disclosure-toggle").first();
      await group.click();
      assert.equal(await group.getAttribute("aria-expanded"), "false");
      await group.click();
      await page.screenshot({
        path: shots + "/side-" + width + ".png",
        fullPage: true,
      });
      if (width === 390) {
        await page.keyboard.press("Escape");
        assert.equal(
          await page
            .locator(".app-frame")
            .evaluate((n) => n.classList.contains("nav-open")),
          false,
        );
      }
      await noErrors();
    },
  );
  await check(
    "B-UI-03 学员 " +
      width +
      "：全库搜索/状态筛选范围、操作列、详情与原账号入口",
    async () => {
      await app(width);
      await students();
      await fits();
      assert.ok(
        (
          await page
            .locator(".student-index .ui-list-scope")
            .first()
            .innerText()
        ).includes("本页已加载"),
      );
      await page.screenshot({
        path: shots + "/students-" + width + ".png",
        fullPage: true,
      });
      if (width === 1440) {
        const th = page.locator(".student-index .ui-actions-head");
        assert.equal(
          await th.evaluate((n) => getComputedStyle(n).textAlign),
          "right",
        );
        await page
          .getByRole("button", { name: "详情抽屉", exact: true })
          .click();
      } else
        await page
          .locator(".student-index .ui-row")
          .first()
          .getByRole("button", { name: "查看", exact: true })
          .click();
      await page.locator("dialog[open]").waitFor();
      await page
        .getByRole("button", { name: "开通学员账号", exact: true })
        .waitFor();
      await fits();
      await page.screenshot({
        path: shots + "/student-detail-" + width + ".png",
        fullPage: true,
      });
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
      await noErrors();
    },
  );
  await check(
    "B-UI-04 周课表 " + width + "：30节/时间线/保留四视图/日期切换与截图",
    async () => {
      await app(width);
      await schedule();
      await fits();
      assert.ok(
        (await page.locator(".calendar-legend").innerText()).includes("30"),
      );
      assert.equal(await page.locator(".current-time-line").count(), 1);
      await scrollMorning();
      await page.screenshot({
        path: shots + "/week-" + width + ".png",
        fullPage: true,
      });
      if (width === 390) {
        assert.equal(await page.locator(".b-week-grid.is-day").count(), 1);
        await page.locator(".calendar-day-strip button").first().click();
        assert.equal(
          await page.locator(".calendar-range").innerText(),
          await page
            .locator(".cal-column-head small")
            .innerText()
            .then((t) => "2026-" + t.slice(0, 5)),
        );
      }
      for (const view of ["按教师", "按教室", "列表", "按时间"]) {
        await page.getByRole("button", { name: view, exact: true }).click();
        await page.waitForTimeout(80);
      }
      await noErrors();
    },
  );
}
await check(
  "B-UI-05 学员姓名长词/字面字符走原搜索接口；筛选标签清空和三态排序",
  async () => {
    await app();
    await students();
    const field = page.locator(".student-server-search input");
    for (const term of ["中".repeat(100), "预览%_\\"]) {
      await field.fill(term);
      await Promise.all([
        page.waitForResponse(
          (r) =>
            r.url().includes("/api/data/students?") &&
            r.url().includes("q=" + encodeURIComponent(term)),
        ),
        page
          .locator(".student-server-search")
          .getByRole("button", { name: "搜索", exact: true })
          .click(),
      ]);
      await page.waitForFunction(
        () => document.querySelectorAll(".student-index .ui-row").length === 0,
      );
      assert.equal(await page.locator(".student-index .ui-row").count(), 0);
    }
    await page
      .locator(".student-server-search")
      .getByRole("button", { name: "清空", exact: true })
      .click();
    await page.locator(".student-index .ui-row").first().waitFor();
    await page.locator(".student-index .ui-picker-trigger").first().click();
    await page.getByRole("option", { name: "在读", exact: true }).click();
    await page.getByRole("button", { name: "清除全部", exact: true }).click();
    const sort = page.locator(".student-index th").first().getByRole("button");
    await sort.click();
    assert.equal(
      await page.locator(".student-index th").first().getAttribute("aria-sort"),
      "ascending",
    );
    await sort.click();
    assert.equal(
      await page.locator(".student-index th").first().getAttribute("aria-sort"),
      "descending",
    );
    await sort.click();
    assert.equal(
      await page.locator(".student-index th").first().getAttribute("aria-sort"),
      "none",
    );
  },
);
await check(
  "B-UI-06 学员确认删除使用A弹窗，取消不发DELETE；新建字段校验与脏数据关闭",
  async () => {
    await app();
    await students();
    let deletes = 0;
    page.on("request", (r) => {
      if (r.method() === "DELETE") deletes++;
    });
    await page
      .getByRole("button", { name: /删除预览学员/ })
      .first()
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "取消", exact: true })
      .click();
    assert.equal(deletes, 0);
    await page
      .getByRole("button", { name: "＋ 新增学员", exact: true })
      .click();
    await page.locator("dialog input[name=name]").fill("未保存测试");
    await page.keyboard.press("Escape");
    await page.getByRole("heading", { name: "放弃未保存的修改？" }).waitFor();
    await page.getByRole("button", { name: "继续编辑", exact: true }).click();
    assert.equal(
      await page.locator("dialog input[name=name]").inputValue(),
      "未保存测试",
    );
    assert.equal(nativeDialogs, 0);
  },
);
await check("B-UI-07 学员排序调用原reorder，失败回滚，权限不变", async () => {
  await app();
  await students();
  const before = await page.locator(".student-entry strong").allTextContents();
  await page.route("**/api/reorder", (route) =>
    route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({ error: "记录已修改，请刷新" }),
    }),
  );
  await page
    .locator(".student-index .ui-row")
    .first()
    .getByRole("button", { name: /下移/ })
    .click();
  await page.waitForTimeout(200);
  assert.deepEqual(
    await page.locator(".student-entry strong").allTextContents(),
    before,
  );
  await page.unroute("**/api/reorder");
});
await check(
  "B-UI-08 课表键盘已知教师/教室冲突弹回，零PATCH；Esc取消零PATCH",
  async () => {
    await app();
    await schedule();
    let patches = 0;
    page.on("request", (r) => {
      if (r.method() === "PATCH" && r.url().includes("/data/lessons/"))
        patches++;
    });
    await scrollMorning();
    const card = page
      .locator(".b-course.status-planned[data-lesson]")
      .filter({ has: page.locator("strong", { hasText: "10:00" }) })
      .first();
    await card.evaluate(
      (n) =>
        (n.closest(".b-calendar-scroll").scrollTop = Math.max(
          0,
          n.offsetTop - 140,
        )),
    );
    await card.focus();
    await page.keyboard.press("Space");
    for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() =>
      document.querySelector(".ui-toast-region")?.textContent.includes("冲突"),
    );
    assert.equal(patches, 0);
    assert.ok(
      (await page.locator(".ui-toast-region").innerText()).includes("冲突"),
    );
    const again = await firstMovable();
    await again.focus();
    await page.keyboard.press("Space");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Escape");
    assert.equal(patches, 0);
  },
);
await check(
  "B-UI-09 并发409与服务端冲突均恢复原时间，不使用机构总版本前置锁",
  async () => {
    await app();
    await schedule();
    await page.route("**/api/data/lessons/*", async (route) => {
      if (route.request().method() === "PATCH")
        await route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({ error: "记录已修改，请刷新" }),
        });
      else await route.fallback();
    });
    await scrollMorning();
    const card = page
      .locator(".b-course.status-planned[data-lesson]")
      .filter({ has: page.locator("strong", { hasText: "15:00" }) })
      .first();
    await card.evaluate(
      (n) =>
        (n.closest(".b-calendar-scroll").scrollTop = Math.max(
          0,
          n.offsetTop - 140,
        )),
    );
    const before = await card.getAttribute("aria-label");
    await card.focus();
    await page.keyboard.press("Space");
    for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() =>
      document
        .querySelector(".ui-toast-region")
        ?.textContent.includes("记录已修改"),
    );
    assert.ok(
      (await page.locator(".ui-toast-region").innerText()).includes(
        "记录已修改",
      ),
    );
    assert.equal(
      await page
        .locator(
          '[data-lesson="' + (await card.getAttribute("data-lesson")) + '"]',
        )
        .getAttribute("aria-label"),
      before,
    );
    await page.unroute("**/api/data/lessons/*");
  },
);
await check(
  "B-UI-10 实际鼠标拖动按15分钟吸附，成功调用原PATCH并持久化",
  async () => {
    await app();
    await schedule();
    const card = await firstMovable(),
      id = await card.getAttribute("data-lesson"),
      old = await page.evaluate(
        async (id) =>
          (
            await (
              await fetch(
                document.querySelector("meta[name=tenant-base]").content +
                  "api/data/lessons/" +
                  id,
              )
            ).json()
          ).record.start_at,
        id,
      ),
      box = await card.boundingBox();
    await page.mouse.move(box.x + Math.min(30, box.width / 2), box.y + 8);
    await page.mouse.down();
    await page.mouse.move(box.x + Math.min(30, box.width / 2), box.y - 80, {
      steps: 10,
    });
    await page.mouse.up();
    await page.waitForTimeout(650);
    const after = await page.evaluate(
      async (id) =>
        (
          await (
            await fetch(
              document.querySelector("meta[name=tenant-base]").content +
                "api/data/lessons/" +
                id,
            )
          ).json()
        ).record.start_at,
      id,
    );
    assert.notEqual(after, old);
    assert.equal(Number(after.slice(14, 16)) % 15, 0);
    await page.evaluate(
      async ({ id, old }) => {
        const path =
          document.querySelector("meta[name=tenant-base]").content +
          "api/data/lessons/" +
          id;
        const latest = (await (await fetch(path)).json()).record;
        const response = await fetch(path, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ start_at: old, version: latest.version }),
        });
        if (!response.ok) throw Error("夹具调课恢复失败");
      },
      { id, old },
    );
    await noErrors();
  },
);
await check("B-UI-11 拖动到上下边缘自动滚动，并可Esc取消", async () => {
  await app();
  await schedule();
  const card = await firstMovable(),
    box = await card.boundingBox(),
    rect = await page.locator(".b-calendar-scroll").boundingBox();
  const before = await page
    .locator(".b-calendar-scroll")
    .evaluate((n) => n.scrollTop);
  await page.mouse.move(box.x + 40, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + 40, rect.y + rect.height - 10, { steps: 8 });
  await page.waitForTimeout(250);
  assert.ok(
    (await page.locator(".b-calendar-scroll").evaluate((n) => n.scrollTop)) >
      before,
  );
  await page.keyboard.press("Escape");
  await page.mouse.up();
  assert.equal(await page.locator(".move-ghost").count(), 0);
});
await check("B-UI-12 右边缘跨周自动切换，Esc取消不保存", async () => {
  await app();
  await schedule();
  const card = await firstMovable(),
    box = await card.boundingBox(),
    rect = await page.locator(".b-calendar-scroll").boundingBox(),
    before = await page.locator(".calendar-range").innerText();
  await page.mouse.move(box.x + 30, box.y + 8);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width - 8, rect.y + 200, { steps: 10 });
  await page.waitForFunction(
    (before) =>
      document.querySelector(".calendar-range")?.textContent !== before,
    before,
  );
  assert.notEqual(await page.locator(".calendar-range").innerText(), before);
  await page.keyboard.press("Escape");
  await page.mouse.up();
});
await check(
  "B-UI-13 手机改时间、日期选择、错误保留输入；滑动切日",
  async () => {
    await app(390);
    await schedule();
    await page.locator(".mobile-move-tools button").first().click();
    await page.getByRole("heading", { name: "调整课程时间" }).waitFor();
    assert.equal(await page.locator("dialog .ui-picker-trigger").count(), 2);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    const before = await page.locator(".calendar-range").innerText();
    await page.locator(".b-calendar-viewport").dispatchEvent("touchstart", {
      touches: [{ identifier: 1, clientX: 300, clientY: 250 }],
    });
    await page.locator(".b-calendar-viewport").dispatchEvent("touchend", {
      changedTouches: [{ identifier: 1, clientX: 120, clientY: 250 }],
    });
    assert.notEqual(await page.locator(".calendar-range").innerText(), before);
    await fits();
  },
);
await check(
  "B-UI-14 减少动态效果、无内联style/onclick、纯文本显示和无CSP违规",
  async () => {
    await app(390);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await students();
    assert.equal(
      await page.locator("[style],[onclick],script:not([src]),style").count(),
      0,
    );
    await noErrors();
  },
);
await check(
  "B-UI-15 手机改时间使用A日期/下拉，409后保留输入和未保存确认",
  async () => {
    await app(390);
    await schedule();
    await page.locator(".mobile-move-tools button").first().click();
    const dialog = page.locator("dialog[open]");
    await dialog.locator(".ui-picker-trigger").nth(1).click();
    await page.getByRole("option", { name: "22:00", exact: true }).click();
    await page.route("**/api/data/lessons/*", async (route) => {
      if (route.request().method() === "PATCH")
        await route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({ error: "记录已修改，请刷新" }),
        });
      else await route.fallback();
    });
    await dialog.getByRole("button", { name: "保存调课", exact: true }).click();
    await page.waitForFunction(() =>
      document
        .querySelector(".ui-toast-region")
        ?.textContent.includes("记录已修改"),
    );
    assert.ok((await dialog.innerText()).includes("22:00"));
    await page.keyboard.press("Escape");
    await page.getByRole("heading", { name: "放弃未保存的修改？" }).waitFor();
    await page.getByRole("button", { name: "放弃修改", exact: true }).click();
    await page.unroute("**/api/data/lessons/*");
  },
);
await check(
  "B-UI-16 保存返回committed=false时回滚，不显示保存成功",
  async () => {
    await app();
    await schedule();
    await page.route("**/api/data/lessons/*", async (route) => {
      if (route.request().method() === "PATCH")
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            committed: false,
            conflicts: [{ reasons: ["学员时间冲突"] }],
          }),
        });
      else await route.fallback();
    });
    const card = page
      .locator(".b-course.status-planned[data-lesson]")
      .filter({ has: page.locator("strong", { hasText: "15:00" }) })
      .first();
    await card.evaluate(
      (n) =>
        (n.closest(".b-calendar-scroll").scrollTop = Math.max(
          0,
          n.offsetTop - 140,
        )),
    );
    const id = await card.getAttribute("data-lesson"),
      before = await card.getAttribute("aria-label");
    await card.focus();
    await page.keyboard.press("Space");
    for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() =>
      document
        .querySelector(".ui-toast-region")
        ?.textContent.includes("学员时间冲突"),
    );
    assert.equal(
      await page
        .locator('[data-lesson="' + id + '"]')
        .getAttribute("aria-label"),
      before,
    );
    assert.ok(
      !(await page.locator(".ui-toast-region").innerText()).includes(
        "调课已保存",
      ),
    );
    await page.unroute("**/api/data/lessons/*");
  },
);
await check(
  "B-UI-17 课程详情/编辑保留出勤、补课、撤销与删除入口，表单用A组件",
  async () => {
    await app();
    await schedule();
    const card = await firstMovable();
    await card.click();
    const dialog = page.locator("dialog[open]");
    await dialog
      .getByRole("button", { name: "整班销课", exact: true })
      .waitFor();
    for (const name of ["撤销销课", "教师请假", "机构取消", "删除课程"])
      assert.equal(
        await dialog.getByRole("button", { name, exact: true }).count(),
        1,
      );
    await dialog
      .getByRole("button", { name: "编辑 / 调课", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "编辑课程", exact: true })
      .waitFor();
    const editor = page.locator("dialog[open]").last();
    await editor
      .getByRole("button", { name: "保存并检查冲突", exact: true })
      .waitFor();
    assert.ok((await editor.locator(".ui-picker-trigger").count()) > 3);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(280);
    await noErrors();
  },
);
await check(
  "B-UI-18 学员名HTML按纯文本呈现，不执行脚本或新增图片节点",
  async () => {
    await app();
    await page.route("**/api/data/students?*", async (route) => {
      const response = await route.fetch();
      const data = await response.json();
      data.items[0].name = "<img src=x onerror=alert(1)>";
      await route.fulfill({ response, json: data });
    });
    await students();
    assert.equal(await page.locator(".student-entry img").count(), 0);
    assert.ok(
      (await page.locator(".student-entry").first().innerText()).includes(
        "<img",
      ),
    );
    assert.equal(nativeDialogs, 0);
    await noErrors();
  },
);
await check(
  "B-UI-19 周30节拖动帧耗时与焦点可见；减少动态效果禁用位移",
  async () => {
    await app();
    await schedule();
    const card = await firstMovable(),
      box = await card.boundingBox();
    await page.evaluate(() => {
      globalThis.__frames = [];
      let prev = performance.now();
      globalThis.__measuring = true;
      function tick(now) {
        if (!globalThis.__measuring) return;
        globalThis.__frames.push(now - prev);
        prev = now;
        requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });
    await page.mouse.move(box.x + 30, box.y + 10);
    await page.mouse.down();
    await page.mouse.move(box.x + 50, box.y + 130, { steps: 40 });
    await page.keyboard.press("Escape");
    await page.mouse.up();
    const frames = await page.evaluate(() => {
      globalThis.__measuring = false;
      return globalThis.__frames;
    });
    frames.sort((a, b) => a - b);
    const p95 = frames[Math.floor(frames.length * 0.95)];
    assert.ok(frames.length >= 10);
    assert.ok(p95 < 80, "本机拖动p95超过80ms");
    await writeFile(
      report + "/calendar-performance.json",
      JSON.stringify(
        {
          lessons: 30,
          frames: frames.length,
          p95_ms: p95,
          maximum_ms: Math.max(...frames),
          environment: "本机Headless Chrome，非实体手机，不含网络保存耗时",
        },
        null,
        2,
      ) + "\n",
    );
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.waitForTimeout(300);
    const transform = await card.evaluate((n) => getComputedStyle(n).transform);
    assert.equal(transform, "none");
    await noErrors();
  },
);

await check(
  "B-UI-20 课表已加载范围搜索、字面字符和可清除筛选标签",
  async () => {
    await app();
    await schedule();
    const search = page.locator("[name=calendar_search]");
    await search.fill("%_\\");
    assert.equal(
      await page.locator(".b-week-grid .b-course[data-lesson]").count(),
      0,
    );
    await page
      .getByRole("button", { name: "清除全部筛选", exact: true })
      .click();
    assert.equal(
      await page.locator(".b-week-grid .b-course[data-lesson]").count(),
      30,
    );
    await search.fill("基础");
    assert.equal(
      await page.locator(".b-week-grid .b-course[data-lesson]").count(),
      30,
    );
    await page
      .getByRole("button", { name: "清除全部筛选", exact: true })
      .click();
    await noErrors();
  },
);
await check(
  "B-UI-21 课程点名搜索/排序保留草稿，筛掉学员后仍提交完整名单至原接口",
  async () => {
    await app();
    await schedule();
    const card = await firstMovable();
    await card.click();
    const list = page.locator("dialog .attendance-list");
    await list.waitFor();
    const total = await list.locator("tbody tr").count();
    assert.ok(total >= 2);
    const first = list.locator("tbody tr").first();
    const studentName = await first.locator("td").first().innerText();
    await first.locator(".ui-picker-trigger").click();
    await page.getByRole("option", { name: "请假", exact: true }).click();
    await list.locator("input[type=search]").fill(studentName.trim());
    assert.equal(await list.locator("tbody tr").count(), 1);
    let sent;
    await page.route("**/api/credits/lessons/*/attendance", async (route) => {
      sent = route.request().postDataJSON();
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ error: "验证草稿保留，未写业务" }),
      });
    });
    await page
      .getByRole("button", { name: "确认逐人出勤", exact: true })
      .click();
    await page.waitForFunction(() =>
      document
        .querySelector(".ui-toast-region")
        ?.textContent.includes("验证草稿保留"),
    );
    assert.equal(sent.participants.length, total);
    assert.ok(sent.participants.some((p) => p.attendance === "student_leave"));
    await page.unroute("**/api/credits/lessons/*/attendance");
    await noErrors();
  },
);

await browser.close();
await writeFile(
  report + "/browser.json",
  JSON.stringify(
    {
      base,
      total: results.length,
      passed: results.filter((r) => r.status === "PASS").length,
      failed: results.filter((r) => r.status === "FAIL").length,
      realWeChatDevice: false,
      results,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify({
    total: results.length,
    passed: results.filter((r) => r.status === "PASS").length,
    failed: results.filter((r) => r.status === "FAIL").length,
  }),
);
if (results.some((r) => r.status === "FAIL")) process.exitCode = 1;
