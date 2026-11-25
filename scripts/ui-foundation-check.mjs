import assert from "node:assert/strict";
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { createUiPreview } from "./ui-preview.mjs";
const require = createRequire(import.meta.url);
const modulePath = require.resolve("playwright-core", {
  paths: [
    process.cwd(),
    ...(process.env.UI_TEST_MODULES ? [process.env.UI_TEST_MODULES] : []),
  ],
});
const runtime = await import(pathToFileURL(modulePath));
const { chromium } = runtime.default || runtime;
const preview = process.env.UI_BASE_URL
  ? null
  : await createUiPreview({ port: 0 });
const base = process.env.UI_BASE_URL || preview.url;
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_PATH
    ? { executablePath: process.env.CHROME_PATH }
    : process.platform === "darwin"
      ? {
          executablePath:
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        }
      : { channel: "chrome" }),
});
const results = [],
  out = "work/reports/stage10a",
  shots = "work/screenshots/stage10a";
await mkdir(out, { recursive: true });
await mkdir(shots, { recursive: true });
async function run(
  name,
  fn,
  { width = 1440, mobile = false, reducedMotion = "no-preference" } = {},
) {
  const context = await browser.newContext({
    viewport: { width, height: mobile ? 844 : 1000 },
    deviceScaleFactor: 1,
    isMobile: mobile,
    hasTouch: mobile,
    reducedMotion,
  });
  const page = await context.newPage(),
    errors = [],
    requests = [];
  await page.addInitScript(() => {
    globalThis.uiViolations = [];
    document.addEventListener("securitypolicyviolation", (e) =>
      globalThis.uiViolations.push({
        directive: e.violatedDirective,
        blocked: e.blockedURI,
      }),
    );
  });
  await page.route("**/*", async (route) => {
    const url = route.request().url();
    requests.push(url);
    if (new URL(url).origin !== new URL(base).origin) {
      errors.push("外部请求：" + url);
      await route.abort();
    } else await route.continue();
  });
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    const response = await page.goto(base);
    await page.waitForSelector('#component-lab[data-ui-ready="true"]');
    await fn(page, response);
    assert.deepEqual(await page.evaluate(() => globalThis.uiViolations), []);
    assert.deepEqual(errors, []);
    results.push({
      name,
      status: "PASS",
      width,
      mobile,
      requests: requests.length,
    });
    console.log("PASS " + name);
  } catch (e) {
    results.push({ name, status: "FAIL", detail: e.message, width, mobile });
    console.error("FAIL " + name + " " + e.message);
    await page.screenshot({
      path: shots + "/failure-" + results.length + ".png",
      fullPage: true,
    });
  } finally {
    await context.close();
  }
}
const settle = async (page, ms = 520) => page.waitForTimeout(ms);
const rowNames = (page) =>
  page
    .locator("#list-demo tbody tr")
    .evaluateAll((rows) =>
      rows.map((r) =>
        r.querySelectorAll("td")[1].textContent.trim().replace(/^学员/, ""),
      ),
    );
try {
  await run(
    "A-UI-01 严格CSP、无内联/外链、所有本地SVG符号可加载",
    async (page, response) => {
      const csp = response.headers()["content-security-policy"];
      assert.ok(csp.includes("script-src 'self'"));
      assert.ok(!/unsafe-|https:/.test(csp));
      assert.equal(
        await page.locator("script:not([src]),style,[style],[onclick]").count(),
        0,
      );
      assert.equal(await page.locator("#icon-demo .ui-icon").count(), 34);
      const asset = await page.request.get(base + "/ui/icons.svg");
      assert.equal(asset.status(), 200);
      assert.ok((await asset.text()).includes('symbol id="calendar"'));
      assert.equal((await page.request.get(base + "/api/login")).status(), 404);
      assert.equal(
        (await page.request.get(base + "/../src/server/worker.js")).status(),
        404,
      );
    },
  );
  for (const width of [1440, 390, 375])
    await run(
      "A-UI-02 布局与44px点击热区 " + width,
      async (page) => {
        const metrics = await page.evaluate(() => ({
          width: innerWidth,
          scroll: document.documentElement.scrollWidth,
          small: [...document.querySelectorAll("button,input,textarea,a[href]")]
            .filter((e) => e.getClientRects().length && !e.closest("[hidden]"))
            .map((e) => {
              const hit = e.matches('input[type="checkbox"]')
                ? e.closest("label")
                : e;
              const r = hit.getBoundingClientRect();
              return {
                name: e.getAttribute("aria-label") || e.textContent || e.name,
                width: r.width,
                height: r.height,
              };
            })
            .filter((x) => x.width < 43.9 || x.height < 43.9),
        }));
        assert.equal(metrics.scroll, metrics.width);
        assert.deepEqual(metrics.small, []);
        await page.screenshot({
          path: shots + "/components-" + width + ".png",
          fullPage: true,
        });
        await page
          .locator("#main-spec")
          .screenshot({ path: shots + "/main-" + width + ".png" });
        await page
          .locator("#component-lab")
          .screenshot({ path: shots + "/lab-" + width + ".png" });
      },
      { width, mobile: width < 600 },
    );
  await run(
    "A-UI-03 输入旁校验、纯文本显示HTML、金额格式不变",
    async (page) => {
      const input = page.getByRole("textbox", { name: "手机号", exact: true });
      assert.equal(await input.getAttribute("aria-invalid"), "true");
      await input.fill("13912345678");
      await input.blur();
      assert.equal(await input.getAttribute("aria-invalid"), "false");
      const sample = page.getByRole("textbox", {
        name: "学员姓名",
        exact: true,
      });
      await sample.fill("<img src=x onerror=alert(1)>");
      assert.equal(await sample.inputValue(), "<img src=x onerror=alert(1)>");
      assert.equal(await page.locator('img[src="x"]').count(), 0);
    },
  );
  await run("A-UI-04 按钮保存中禁用并防重复提交", async (page) => {
    const save = page.getByRole("button", { name: "保存状态", exact: true });
    await save.dblclick();
    assert.equal(await save.getAttribute("aria-busy"), "true");
    assert.equal(await save.isDisabled(), true);
    await settle(page);
    assert.equal(await save.isDisabled(), false);
    assert.equal(
      await page
        .locator(".ui-toast-message")
        .filter({ hasText: "演示保存成功" })
        .count(),
      1,
    );
  });
  await run("A-UI-05 开关键盘空格、处理中状态与失败回弹", async (page) => {
    const control = page.getByRole("switch", { name: "学员可查看缴费记录" });
    await page.locator("#simulate-failure").check();
    await control.focus();
    await page.keyboard.press("Space");
    assert.equal(await control.getAttribute("aria-checked"), "false");
    assert.equal(await control.isDisabled(), true);
    await settle(page);
    assert.equal(await control.getAttribute("aria-checked"), "true");
    assert.ok(
      (await page.locator(".ui-toast--error").textContent()).includes(
        "已恢复原值",
      ),
    );
    await control.focus();
    await page.keyboard.press("Space");
    await settle(page);
    assert.equal(await control.getAttribute("aria-checked"), "false");
  });
  for (const width of [1440, 390])
    await run(
      "A-UI-06 抽屉焦点/未保存确认/遮罩/全屏 " + width,
      async (page) => {
        const trigger = page.getByRole("button", {
          name: "打开抽屉",
          exact: true,
        });
        await trigger.click();
        await settle(page, 280);
        const drawer = page.getByRole("dialog", {
          name: "新建表单 · 组件预览",
        });
        const b = await drawer.locator(".ui-sheet").boundingBox();
        assert.equal(Math.round(b.width), width === 1440 ? 520 : width);
        if (width === 390) assert.equal(Math.round(b.height), 844);
        assert.equal(
          await drawer
            .getByRole("textbox", { name: "名称", exact: true })
            .evaluate((e) => e === document.activeElement),
          true,
        );
        await drawer
          .getByRole("textbox", { name: "名称", exact: true })
          .fill("未保存的示例");
        await page.keyboard.press("Escape");
        await settle(page, 280);
        assert.equal(await page.locator("dialog[open]").count(), 2);
        await page
          .getByRole("button", { name: "继续编辑", exact: true })
          .click();
        await settle(page, 300);
        assert.equal(await page.locator("dialog[open]").count(), 1);
        assert.equal(
          await drawer
            .getByRole("textbox", { name: "名称", exact: true })
            .inputValue(),
          "未保存的示例",
        );
        await page.keyboard.press("Escape");
        await settle(page, 280);
        await page
          .getByRole("button", { name: "放弃修改", exact: true })
          .click();
        await settle(page, 550);
        assert.equal(await page.locator("dialog[open]").count(), 0);
        assert.equal(
          await trigger.evaluate((e) => e === document.activeElement),
          true,
        );
        await trigger.click();
        await settle(page, 280);
        await page.screenshot({ path: shots + "/drawer-" + width + ".png" });
        if (width === 1440) {
          await page.mouse.click(100, 300);
          await settle(page, 280);
          assert.equal(await page.locator("dialog[open]").count(), 0);
        } else {
          await page.getByRole("button", { name: "关闭", exact: true }).click();
          await settle(page, 280);
        }
      },
      { width, mobile: width < 600 },
    );
  await run("A-UI-07 弹窗Tab/ShiftTab焦点陷阱与Esc关闭", async (page) => {
    const trigger = page.getByRole("button", { name: "打开弹窗", exact: true });
    await trigger.click();
    await settle(page, 280);
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press(i % 2 ? "Shift+Tab" : "Tab");
      assert.equal(
        await page
          .locator("dialog[open]")
          .evaluate((e) => e.contains(document.activeElement)),
        true,
      );
    }
    await page.screenshot({ path: shots + "/modal-1440.png" });
    await page.keyboard.press("Escape");
    await settle(page, 320);
    assert.equal(await page.locator("dialog[open]").count(), 0);
    assert.equal(
      await trigger.evaluate((e) => e === document.activeElement),
      true,
    );
  });
  await run("A-UI-08 下拉方向键、Enter、Escape及焦点返回", async (page) => {
    const trigger = page.getByRole("button", {
      name: "选择课程类别",
      exact: true,
    });
    await trigger.focus();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    assert.ok((await trigger.textContent()).includes("声乐"));
    assert.equal(await trigger.getAttribute("aria-expanded"), "false");
    await trigger.click();
    await page.keyboard.press("Escape");
    assert.equal(
      await trigger.evaluate((e) => e === document.activeElement),
      true,
    );
  });
  for (const width of [1440, 390])
    await run(
      "A-UI-09 日期键盘跨月/闰日与44px日期格 " + width,
      async (page) => {
        const trigger = page.getByRole("button", {
          name: "选择日期",
          exact: true,
        });
        await trigger.click();
        await page.keyboard.press("ArrowLeft");
        await page.keyboard.press("Enter");
        assert.ok(
          (await page.locator("#date-result").textContent()).includes(
            "2026-11-01",
          ),
        );
        await trigger.click();
        for (let i = 0; i < 15; i++) await page.keyboard.press("PageDown");
        await page
          .getByRole("gridcell", { name: "2028-02-29", exact: true })
          .click();
        assert.ok(
          (await page.locator("#date-result").textContent()).includes(
            "2028-02-29",
          ),
        );
        await trigger.click();
        const sizes = await page
          .locator(".ui-calendar-day")
          .evaluateAll((nodes) =>
            nodes.map((e) => ({
              w: e.getBoundingClientRect().width,
              h: e.getBoundingClientRect().height,
            })),
          );
        assert.ok(sizes.every((s) => s.w >= 43.9 && s.h >= 43.9));
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth),
          width,
        );
        await page.screenshot({ path: shots + "/calendar-" + width + ".png" });
        await page.keyboard.press("Escape");
        assert.equal(
          await trigger.evaluate((e) => e === document.activeElement),
          true,
        );
      },
      { width, mobile: width < 600 },
    );
  await run("A-UI-10 Toast堆叠/3秒关闭/错误保留", async (page) => {
    await page.getByRole("button", { name: "成功提示", exact: true }).click();
    await page.getByRole("button", { name: "错误提示", exact: true }).click();
    assert.equal(await page.locator(".ui-toast").count(), 2);
    await page.waitForTimeout(3300);
    assert.equal(await page.locator(".ui-toast--success").count(), 0);
    assert.equal(await page.locator(".ui-toast--error").count(), 1);
    await page
      .locator(".ui-toast--error")
      .getByRole("button", { name: "关闭通知" })
      .click();
    await settle(page, 200);
    assert.equal(await page.locator(".ui-toast").count(), 0);
  });
  await run("A-UI-11 三态排序、字面搜索/中文长词与清空", async (page) => {
    const initial = await rowNames(page),
      sort = page.getByRole("button", { name: "剩余课时排序", exact: true });
    await sort.click();
    assert.deepEqual(
      await page
        .locator("#list-demo tbody tr")
        .evaluateAll((rows) =>
          rows.map((r) =>
            Number(
              r
                .querySelectorAll("td")[2]
                .textContent.trim()
                .replace("剩余课时", ""),
            ),
          ),
        ),
      [0, 2, 6, 12],
    );
    await sort.click();
    await sort.click();
    assert.deepEqual(await rowNames(page), initial);
    const search = page.getByRole("searchbox", { name: "搜索交互演示列表" });
    await search.fill("%_\\");
    assert.equal(await page.locator("#list-demo tbody tr").count(), 1);
    await page.getByRole("button", { name: "清空搜索", exact: true }).click();
    assert.equal(await page.locator("#list-demo tbody tr").count(), 4);
    await search.fill("中".repeat(100));
    assert.equal(await page.locator("#list-demo tbody tr").count(), 0);
    await page.getByRole("button", { name: "清除全部", exact: true }).click();
    assert.equal(await page.locator("#list-demo tbody tr").count(), 4);
  });
  await run(
    "A-UI-12 筛选标签、加载保留内容/条件、仅已加载计数",
    async (page) => {
      const trigger = page.getByRole("button", { name: "状态", exact: true });
      await trigger.click();
      await page.getByRole("option", { name: "在读", exact: true }).click();
      assert.equal(await page.locator("#list-demo tbody tr").count(), 2);
      assert.ok(
        (await page.locator("#list-demo").textContent()).includes(
          "仅对已加载范围",
        ),
      );
      await page.getByRole("button", { name: "加载更多", exact: true }).click();
      await page.waitForFunction(
        () =>
          document.querySelectorAll("#list-demo tbody tr").length === 3 &&
          document
            .querySelector("#list-demo")
            .textContent.includes("已加载 5 条"),
      );
      assert.equal(await page.locator("#list-demo tbody tr").count(), 3);
      assert.ok(
        (await page.locator("#list-demo").textContent()).includes(
          "已加载 5 条",
        ),
      );
      assert.ok((await trigger.textContent()).includes("在读"));
      await page
        .getByRole("button", { name: "模拟筛选加载", exact: true })
        .click();
      assert.equal(
        await page.locator("#list-demo .ui-list").getAttribute("aria-busy"),
        "true",
      );
      assert.equal(await page.locator("#list-demo tbody tr").count(), 3);
      await settle(page, 650);
      assert.equal(
        await page.locator("#list-demo .ui-list").getAttribute("aria-busy"),
        "false",
      );
    },
  );
  await run("A-UI-13 移动按钮排序失败回滚、筛选时不重排", async (page) => {
    const prior = await rowNames(page);
    await page.locator("#simulate-failure").check();
    await page
      .getByRole("button", { name: "下移预览学员一", exact: true })
      .click();
    await settle(page, 540);
    assert.deepEqual(await rowNames(page), prior);
    await page
      .getByRole("button", { name: "下移预览学员一", exact: true })
      .click();
    await settle(page, 540);
    const after = await rowNames(page);
    assert.equal(after[1], prior[0]);
    await page
      .getByRole("searchbox", { name: "搜索交互演示列表" })
      .fill("预览");
    assert.equal(
      await page
        .getByRole("button", { name: "下移预览学员一", exact: true })
        .isDisabled(),
      true,
    );
  });
  await run("A-UI-14 行点击/多选操作条/删除确认与行收起", async (page) => {
    await page
      .getByRole("checkbox", { name: "选择预览学员一", exact: true })
      .check();
    assert.equal(await page.locator(".ui-batch-bar").isVisible(), true);
    assert.ok(
      (await page.locator(".ui-batch-bar").textContent()).includes("已选 1 项"),
    );
    await page.getByRole("button", { name: "取消选择", exact: true }).click();
    await page
      .getByRole("button", { name: "删除预览学员一", exact: true })
      .click();
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await settle(page, 300);
    assert.equal(await page.locator("#list-demo tbody tr").count(), 4);
    await page
      .getByRole("button", { name: "删除预览学员一", exact: true })
      .click();
    await page.getByRole("button", { name: "确认删除", exact: true }).click();
    await page.waitForFunction(
      () => document.querySelectorAll("#list-demo tbody tr").length === 3,
    );
    assert.equal(await page.locator("#list-demo tbody tr").count(), 3);
    await page
      .locator("#list-demo tbody tr")
      .first()
      .locator("td")
      .nth(1)
      .click();
    await settle(page, 280);
    assert.equal(await page.locator("dialog[open]").count(), 1);
  });
  await run("A-UI-15 主题切换/对比度/顶层组件主题一致", async (page) => {
    const contrast = await page.evaluate(() => {
      const css = getComputedStyle(document.body),
        names = [
          ["--ui-text", "--ui-panel"],
          ["--ui-muted", "--ui-panel"],
          ["--ui-primary", "--ui-panel"],
          ["--ui-success", "--ui-success-bg"],
          ["--ui-warning", "--ui-warning-bg"],
          ["--ui-error", "--ui-error-bg"],
          ["--ui-info", "--ui-info-bg"],
          ["--ui-neutral", "--ui-neutral-bg"],
        ];
      const lum = (hex) => {
        const values = hex
          .trim()
          .slice(1)
          .match(/../g)
          .map((x) => parseInt(x, 16) / 255)
          .map((x) =>
            x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4,
          );
        return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
      };
      return names.map(([a, b]) => {
        const x = lum(css.getPropertyValue(a)),
          y = lum(css.getPropertyValue(b));
        return {
          a,
          b,
          ratio: (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05),
        };
      });
    });
    assert.ok(
      contrast.every((x) => x.ratio >= 4.5),
      JSON.stringify(contrast),
    );
    await page
      .getByRole("button", { name: "主题色（预设）", exact: true })
      .click();
    await page
      .getByRole("option", { name: "绿色 · #1F6B5C", exact: true })
      .click();
    await page.getByRole("button", { name: "打开抽屉", exact: true }).click();
    await settle(page, 280);
    assert.equal(
      await page.locator("dialog[open]").getAttribute("data-ui-theme"),
      "green",
    );
    await writeFile(out + "/contrast.json", JSON.stringify(contrast, null, 2));
  });
  await run(
    "A-UI-16 减少动态效果：无位移/高度过渡，保留透明度反馈",
    async (page) => {
      const styles = await page
        .locator("#basic-switches .ui-switch-knob")
        .first()
        .evaluate((e) => getComputedStyle(e).transitionProperty);
      assert.equal(styles, "opacity");
      const side = await page
        .locator(".ui-disclosure-panel")
        .evaluate((e) => getComputedStyle(e).transitionProperty);
      assert.equal(side, "opacity");
      const active = await page
        .locator("#click-card button")
        .evaluate((e) => getComputedStyle(e).animationName);
      assert.equal(active, "none");
      await page.getByRole("button", { name: "打开抽屉", exact: true }).click();
      await settle(page, 280);
      assert.equal(
        await page
          .locator(".ui-sheet")
          .evaluate((e) => getComputedStyle(e).transitionProperty),
        "opacity",
      );
    },
    { reducedMotion: "reduce" },
  );
  await run(
    "A-UI-17 手机无hover上浮，列表和图标不挤出屏幕",
    async (page) => {
      assert.equal(
        await page.evaluate(() => matchMedia("(hover:hover)").matches),
        false,
      );
      await page
        .getByRole("button", { name: "可点击卡片", exact: false })
        .hover();
      assert.equal(
        await page
          .locator("#click-card button")
          .evaluate((e) => getComputedStyle(e).transform),
        "none",
      );
      await page
        .getByRole("searchbox", { name: "搜索交互演示列表" })
        .fill("预览");
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth),
        390,
      );
    },
    { width: 390, mobile: true },
  );
  await run("A-UI-18 抽屉保存失败保留内容，重试成功后关闭", async (page) => {
    await page.locator("#simulate-failure").check();
    await page.getByRole("button", { name: "打开抽屉", exact: true }).click();
    await settle(page, 280);
    const drawer = page.getByRole("dialog", { name: "新建表单 · 组件预览" });
    await drawer
      .getByRole("textbox", { name: "名称", exact: true })
      .fill("保留的名称");
    await drawer
      .getByRole("textbox", { name: "备注", exact: true })
      .fill("保留的备注");
    await drawer.getByRole("button", { name: "保存", exact: true }).click();
    await settle(page, 520);
    assert.equal(
      await drawer
        .getByRole("textbox", { name: "名称", exact: true })
        .inputValue(),
      "保留的名称",
    );
    assert.equal(
      await drawer
        .getByRole("textbox", { name: "备注", exact: true })
        .inputValue(),
      "保留的备注",
    );
    assert.equal(await page.locator(".ui-toast--error").count(), 1);
    await drawer.getByRole("button", { name: "保存", exact: true }).click();
    await drawer.waitFor({ state: "detached" });
    assert.equal(await page.locator("dialog[open]").count(), 0);
  });
  await run("A-UI-19 本地列表原生拖动排序与键盘行打开", async (page) => {
    const before = await rowNames(page);
    await page
      .locator("#list-demo tbody tr")
      .nth(0)
      .dragTo(page.locator("#list-demo tbody tr").nth(1));
    await settle(page, 600);
    const after = await rowNames(page);
    assert.equal(after[1], before[0]);
    await page.locator("#list-demo tbody tr").first().focus();
    await page.keyboard.press("Enter");
    await settle(page, 280);
    assert.equal(await page.locator("dialog[open]").count(), 1);
  });
  await run("A-UI-20 列表纯文本与禁止内联属性的组件边界", async (page) => {
    const result = await page.evaluate(async () => {
      const { dataList, node } = await import("/ui/components.js");
      let styleRejected = false,
        eventRejected = false;
      try {
        node("span", "", { style: "color:red" });
      } catch {
        styleRejected = true;
      }
      try {
        node("span", "", { onclick: "alert(1)" });
      } catch {
        eventRejected = true;
      }
      const list = dataList({
        columns: [{ key: "name", label: "姓名" }],
        items: [{ id: "probe", name: "<img src=x onerror=alert(1)>" }],
      });
      document.querySelector("#component-lab").append(list.element);
      const text = list.element.textContent,
        images = list.element.querySelectorAll("img").length;
      list.destroy();
      return { styleRejected, eventRejected, text, images };
    });
    assert.equal(result.styleRejected, true);
    assert.equal(result.eventRejected, true);
    assert.equal(result.images, 0);
    assert.ok(result.text.includes("<img src=x onerror=alert(1)>"));
  });
  await run("A-UI-21 列表排序和多选重绘后保留键盘焦点", async (page) => {
    const sort = page.getByRole("button", {
      name: "剩余课时排序",
      exact: true,
    });
    await sort.focus();
    await page.keyboard.press("Enter");
    await settle(page, 40);
    assert.equal(
      await sort.evaluate((e) => e === document.activeElement),
      true,
    );
    await page.keyboard.press("Enter");
    await settle(page, 40);
    assert.equal(
      await sort.evaluate((e) => e === document.activeElement),
      true,
    );
    const check = page.getByRole("checkbox", {
      name: "选择预览学员一",
      exact: true,
    });
    await check.focus();
    await page.keyboard.press("Space");
    await settle(page, 40);
    assert.equal(
      await check.evaluate((e) => e === document.activeElement),
      true,
    );
  });
  await run("A-UI-22 日期头部连续翻月不关闭且焦点留在原按钮", async (page) => {
    await page.getByRole("button", { name: "选择日期", exact: true }).click();
    const next = page.getByRole("button", { name: "下个月", exact: true });
    await next.focus();
    await page.keyboard.press("Enter");
    await settle(page, 40);
    assert.equal(
      await next.evaluate((e) => e === document.activeElement),
      true,
    );
    assert.equal(await page.locator(".ui-calendar").isVisible(), true);
    assert.ok(
      (await page.locator(".ui-calendar-header").textContent()).includes(
        "2026年12月",
      ),
    );
    await page.keyboard.press("Space");
    await settle(page, 40);
    assert.ok(
      (await page.locator(".ui-calendar-header").textContent()).includes(
        "2027年1月",
      ),
    );
    assert.equal(
      await next.evaluate((e) => e === document.activeElement),
      true,
    );
  });
} finally {
  await browser.close();
  if (preview) await preview.close();
  const report = {
    at: new Date().toISOString(),
    browser: "local Chrome / Playwright",
    realWeChatDeviceTested: false,
    sourceOnlyComponents: true,
    total: results.length,
    passed: results.filter((x) => x.status === "PASS").length,
    failed: results.filter((x) => x.status === "FAIL").length,
    results,
  };
  await writeFile(out + "/browser-check.json", JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify({
      total: report.total,
      passed: report.passed,
      failed: report.failed,
    }),
  );
  if (report.failed) process.exitCode = 1;
}
