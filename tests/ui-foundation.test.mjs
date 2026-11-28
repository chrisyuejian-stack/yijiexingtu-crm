import { test } from "node:test";
import assert from "node:assert/strict";
import { formatMoney, validDate, isoDate } from "../src/ui/components.js";
test("阶段A：金额仅省略零小数，分位/负数/缺失值不被改写", () => {
  for (const [input, want] of [
    [12, "¥12"],
    [12.3, "¥12.30"],
    [12.01, "¥12.01"],
    [0.01, "¥0.01"],
    [0, "¥0"],
    [-0, "¥0"],
    [-12.5, "-¥12.50"],
    [-12, "-¥12"],
    [1234.5, "¥1,234.50"],
    [null, "—"],
    [undefined, "—"],
    [NaN, "—"],
  ])
    assert.equal(formatMoney(input), want);
});
test("阶段A：日期选择校验闰日和月年边界，不把无效日期自动改日", () => {
  assert.equal(validDate("2028-02-29"), true);
  assert.equal(validDate("2026-02-29"), false);
  assert.equal(validDate("2026-11-31"), false);
  assert.equal(validDate("2026-1-02"), false);
  assert.equal(validDate(""), false);
  assert.equal(isoDate(2026, 12, 32), "2027-01-01");
  assert.equal(isoDate(2026, 11, 0), "2026-10-31");
  assert.equal(isoDate(2028, 2, 29), "2028-02-29");
});

test("阶段A/G-06：dateControl 支持键盘输入与格式归一、上下月翻页不关闭、Esc 不外泄且关闭后解绑监听", async () => {
  const prevDoc = globalThis.document, prevInnerH = globalThis.innerHeight, prevInnerW = globalThis.innerWidth;
  const listeners = new Map();
  class StubNode {
    constructor(tag) {
      this.tagName = tag.toUpperCase();
      this.children = [];
      this.attrs = {};
      this.events = {};
      this.value = "";
      this.hidden = false;
      this.disabled = false;
      this.className = "";
      this.parentNode = null;
      this.classList = {
        add: (...v) => (this.className = [...new Set(this.className.split(" ").filter(Boolean).concat(v))].join(" ")),
        remove: (...v) => (this.className = this.className.split(" ").filter(x => !v.includes(x)).join(" ")),
        toggle: (v, on) => ((on ?? !this.className.split(" ").includes(v)) ? this.classList.add(v) : this.classList.remove(v)),
      };
    }
    setAttribute(k, v) { this.attrs[k] = String(v); if (k === "class") this.className = String(v); }
    removeAttribute(k) { delete this.attrs[k]; }
    getAttribute(k) { return this.attrs[k] ?? null; }
    append(...xs) {
      for (const x of xs) {
        const n = typeof x === "object" && x ? x : { nodeType: 3, textContent: String(x ?? ""), parentNode: this };
        if (n instanceof StubNode) n.parentNode = this;
        this.children.push(n);
      }
    }
    replaceChildren(...xs) { this.children = []; this.append(...xs); }
    remove() {}
    closest() { return null; }
    contains(el) { return el === this || this.children.some(c => c instanceof StubNode && c.contains(el)); }
    getBoundingClientRect() { return { top: 0, bottom: 40, left: 0, right: 200 }; }
    focus() { globalThis.document.activeElement = this; }
    click() { this.events.click?.forEach(f => f({ target: this, preventDefault() {}, stopPropagation() {} })); }
    addEventListener(k, f) { (this.events[k] ||= []).push(f); }
    dispatchEvent(e) { (this.events[e.type] || []).forEach(f => f({ target: this, ...e })); }
    querySelectorAll(sel) {
      const out = [];
      const walk = (n) => {
        for (const c of n.children || []) {
          if (!(c instanceof StubNode)) continue;
          const m = (sel.startsWith(".") && c.className.split(" ").includes(sel.slice(1)))
            || (sel.startsWith("[aria-label=\"") && c.attrs["aria-label"] === sel.slice(13, -2))
            || (sel === "button" && c.tagName === "BUTTON")
            || (sel === '[tabindex="0"]' && c.attrs.tabindex === "0");
          if (m) out.push(c);
          walk(c);
        }
      };
      walk(this);
      return out;
    }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
    get textContent() { return this.children.map(c => c.textContent ?? "").join(""); }
    set textContent(v) { this.children = [{ textContent: String(v) }]; }
  }
  const body = new StubNode("body");
  globalThis.innerHeight = 900;
  globalThis.innerWidth = 1440;
  globalThis.document = {
    body,
    activeElement: null,
    createElement: (t) => new StubNode(t),
    createElementNS: (_ns, t) => new StubNode(t),
    createTextNode: (t) => ({ textContent: String(t) }),
    addEventListener(type, fn) { if (type === "pointerdown") listeners.set(fn, true); },
    removeEventListener(type, fn) { if (type === "pointerdown") listeners.delete(fn); },
  };
  try {
    const { dateControl } = await import("../src/ui/components.js?g06=" + Date.now());
    const changes = [];
    const dc = dateControl({ label: "日期", value: "2026-11-12", onChange: (v) => changes.push(v) });
    body.append(dc.element);
    assert.equal(listeners.size, 0, "未打开时不绑定全局 pointerdown");
    assert.equal(dc.input.value, "2026-11-12");

    dc.input.value = "20261205";
    dc.input.dispatchEvent({ type: "keydown", key: "Enter", preventDefault() {} });
    assert.equal(dc.value, "2026-12-05");
    assert.equal(dc.input.value, "2026-12-05");
    assert.deepEqual(changes, ["2026-12-05"]);

    dc.setValue("2027-01-15");
    assert.equal(dc.input.value, "2027-01-15");

    dc.trigger.click();
    assert.equal(listeners.size, 1, "打开后挂载 pointerdown");
    const popup = dc.element.querySelector(".ui-calendar");
    assert.equal(popup.hidden, false);
    popup.querySelector('[aria-label="下个月"]').click();
    assert.equal(popup.hidden, false);
    assert.match(popup.textContent, /2027年2月/);
    popup.querySelector('[aria-label="上个月"]').click();
    assert.equal(popup.hidden, false);
    assert.match(popup.textContent, /2027年1月/);

    let stopped = false;
    dc.element.dispatchEvent({ type: "keydown", key: "Escape", preventDefault() {}, stopPropagation() { stopped = true; } });
    assert.equal(popup.hidden, true);
    assert.equal(stopped, true);
    assert.equal(listeners.size, 0, "关闭后解绑全局 pointerdown");
    dc.destroy();
  } finally {
    globalThis.document = prevDoc;
    globalThis.innerHeight = prevInnerH;
    globalThis.innerWidth = prevInnerW;
  }
});

test("机构端细节优化（G-07/G-08/G-16/G-17/G-18）：引导跳转、品牌出错重试/清除二维码、favicon、模板用词与今日课程去重", async () => {
  const { readFile } = await import("node:fs/promises");
  const tenantHtml = await readFile("src/tenant/index.html", "utf8");
  const shareHtml = await readFile("src/share/index.html", "utf8");
  assert.match(tenantHtml, /<link[^>]+rel="icon"[^>]+data:image\/svg\+xml/);
  assert.match(shareHtml, /<link[^>]+rel="icon"[^>]+data:image\/svg\+xml/);

  const appJs = await readFile("src/tenant/app.js", "utf8");
  const homeJs = await readFile("src/tenant/yx-home.js", "utf8");
  const plansJs = await readFile("src/tenant/yx-plans.js", "utf8");
  const plan2Js = await readFile("src/tenant/yx-plan2.js", "utf8");
  const contentJs = await readFile("src/tenant/yx-content.js", "utf8");
  const settingsJs = await readFile("src/tenant/yx-settings.js", "utf8");
  const themeCss = await readFile("src/tenant/yx-theme.css", "utf8");
  const v2Js = await readFile("src/tenant/v2.js", "utf8");
  const v2TodayJs = await readFile("src/tenant/v2today.js", "utf8");

  assert.match(appJs, /请先在“课程与教室 › 报价课程与价目表”里导入学科包/);
  assert.match(homeJs, /去导入学科包[\s\S]*courses-quote/);
  assert.match(plansJs, /请先在“课程与教室 › 报价课程与价目表”导入学科/);
  assert.match(settingsJs, /← 返回报价课程与价目表[\s\S]*courses-quote/);

  assert.match(settingsJs, /品牌设置载入失败[\s\S]*重新加载/);
  assert.match(settingsJs, /清除二维码[\s\S]*qr !== initialQr/);
  assert.match(settingsJs, /el\("span", "咨询二维码"/);

  for (const [name, code] of [
    ["src/tenant/yx-home.js", homeJs],
    ["src/tenant/yx-plans.js", plansJs],
    ["src/tenant/yx-plan2.js", plan2Js],
    ["src/tenant/yx-content.js", contentJs],
  ]) {
    const nonComment = code.replace(/\/\/.*$/gm, "");
    assert.doesNotMatch(nonComment, /模版/, `${name} 不应再出现“模版”错别字`);
  }
  assert.match(themeCss, /\.yxs-course-panel > \.v-pad\s*\{[^}]*padding:\s*24px 16px/);

  assert.match(v2Js, /whoText !== row\.course_name/);
  assert.match(v2TodayJs, /whoLabel !== row\.course_name/);
  assert.match(appJs, /待办合计 " \+ n \+ " 项/);
});

