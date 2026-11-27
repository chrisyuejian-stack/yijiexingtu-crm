import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { installFoundation } from "./ui-dom-support.mjs";

class DomNode {
  constructor(tag = "div") {
    this.tag = tag;
    this.children = [];
    this.attrs = {};
    this.listeners = {};
    this._text = "";
    this.className = "";
    this.style = {};
    this.isConnected = true;
    this.parentElement = null;
    this._value = "";
    this.selectedIndex = -1;
  }
  set textContent(v) {
    this._text = String(v ?? "");
    this.children = [];
  }
  get textContent() {
    return this._text + this.children.map((c) => c.textContent || "").join("");
  }
  get value() {
    return this._value;
  }
  set value(v) {
    if (this.tag === "select") {
      // Match HTMLSelectElement behavior: null becomes "null", missing option leaves selectedIndex = -1.
      const str = String(v);
      const opts = this.children.filter((c) => c.tag === "option");
      const idx = opts.findIndex((o) => String(o.attrs.value ?? "") === str);
      this.selectedIndex = idx;
      this._value = idx >= 0 ? str : "";
      return;
    }
    this._value = String(v ?? "");
  }
  append(...nodes) {
    for (const n of nodes) {
      if (n && typeof n === "object") n.parentElement = this;
      this.children.push(n);
    }
  }
  replaceChildren(...nodes) {
    this._text = "";
    this.children = [];
    this.append(...nodes);
  }
  setAttribute(k, v) {
    this.attrs[k] = String(v);
    if (k === "class") this.className = String(v);
  }
  addEventListener(k, fn) {
    this.listeners[k] = fn;
  }
  dispatchEvent(e) {
    return this.listeners[e.type]?.(e);
  }
  click() {
    this.listeners.click?.({ preventDefault() {}, stopPropagation() {} });
  }
  querySelectorAll(selector) {
    const out = [];
    const walk = (n) => {
      for (const c of n.children || [])
        if (c && typeof c === "object") {
          out.push(c);
          walk(c);
        }
    };
    walk(this);
    const parts = selector.split(",").map((s) => s.trim());
    return out.filter((n) =>
      parts.some((sel) => {
        if (sel.startsWith(".")) return (n.className || "").split(" ").includes(sel.slice(1));
        if (sel === "dialog[open]") return n.tag === "dialog" && "open" in n.attrs;
        return n.tag === sel.split(/[:\[ ]/)[0];
      }),
    );
  }
  showModal() {
    this.attrs.open = "";
  }
  close() {
    delete this.attrs.open;
    this.listeners.close?.({});
  }
  getClientRects() {
    return [{ width: 10, height: 10 }];
  }
  contains(other) {
    return other === this || this.children.some((c) => c?.contains?.(other));
  }
}

test("G-02：控制台 choice() 传入 null/undefined 时默认选中“请选择”而非空白", async () => {
  const js = await readFile("src/console/app.js", "utf8");
  const start = js.indexOf("function choice(");
  const end = js.indexOf("async function announcementsPage(", start);
  assert.ok(start >= 0 && end > start);

  const document = {
    createElement: (tag) => new DomNode(tag),
  };
  const el = (tag, text, attrs = {}) => {
    const n = document.createElement(tag);
    if (text !== null && text !== undefined) n.textContent = text;
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    return n;
  };
  const context = vm.createContext({ el });
  vm.runInContext(js.slice(start, end), context);

  const form = el("form");
  const selNull = context.choice(form, "目标机构", "tenant", [{ id: "t1", name: "测试机构" }], null);
  assert.equal(selNull.selectedIndex, 0);
  assert.equal(selNull.value, "");
  assert.equal(selNull.children[0].textContent, "请选择");

  const selChosen = context.choice(form, "目标机构", "tenant", [{ id: "t1", name: "测试机构" }], "t1");
  assert.equal(selChosen.selectedIndex, 1);
  assert.equal(selChosen.value, "t1");

  assert.match(js, /choice\(form,\s*"目标机构",\s*"tenant",\s*tenants,\s*tenantId\)/);
});

test("G-09：UI.confirm 默认 danger=false（非破坏性主色按钮），破坏性调用显式传 danger: true", async () => {
  const body = new DomNode("body");
  const document = {
    body,
    createElement: (tag) => new DomNode(tag),
    querySelector: () => null,
    querySelectorAll: (sel) => body.querySelectorAll(sel),
    activeElement: null,
  };
  const context = vm.createContext({ document, globalThis: {}, setTimeout, clearTimeout });
  context.globalThis = context;
  await installFoundation(context, DomNode, document);
  const UI = context.ChannelUI;

  const p1 = UI.confirm({ title: "发送给家长？", consequence: "家长端会看到这一版。" });
  const dlg1 = body.querySelectorAll("dialog")[0];
  const btns1 = dlg1.querySelectorAll("button");
  const confirm1 = btns1.find((b) => b.textContent.includes("确认"));
  assert.ok(confirm1, "应存在确认按钮");
  assert.ok(confirm1.className.includes("ui-button--primary"), confirm1.className);
  assert.ok(!confirm1.className.includes("ui-button--danger"), confirm1.className);
  confirm1.click();
  assert.equal(await p1, true);

  body.replaceChildren();
  const p2 = UI.confirm({ title: "删除这个草稿？", consequence: "删除后不能恢复。", danger: true });
  const dlg2 = body.querySelectorAll("dialog")[0];
  const confirm2 = dlg2.querySelectorAll("button").find((b) => b.textContent.includes("确认"));
  assert.ok(confirm2.className.includes("ui-button--danger"), confirm2.className);
  confirm2.click();
  assert.equal(await p2, true);

  // 审计：破坏性提示仍显式带 danger: true
  const checks = [
    ["src/tenant/yx-plans.js", /归档这个方案？[^}]+danger:\s*true/],
    ["src/tenant/yx-plans.js", /删除阶段[^}]+danger:\s*true/],
    ["src/tenant/yx-plans.js", /替换现有阶段？[^}]+danger:\s*true/],
    ["src/tenant/yx-content.js", /删除这篇内容？[^}]+danger:\s*true/],
    ["src/tenant/yx-home.js", /删除模版[^}]+danger:\s*true/],
    ["src/tenant/yx-settings.js", /停用[^}]+danger:\s*true/],
    ["src/tenant/yx-settings.js", /删除维度[^}]+danger:\s*true/],
    ["src/tenant/yx-settings.js", /删除这张图片？[^}]+danger:\s*true/],
    ["src/tenant/yx.js", /的密码？[^}]+danger:\s*true/],
    ["src/tenant/v2p.js", /重置学员密码？[^}]+danger:\s*true/],
    ["src/tenant/v2p.js", /danger:\s*value !== "active"/],
    ["src/tenant/v2.js", /撤销销课？[^}]+danger:\s*true/],
    ["src/tenant/v2.js", /删除课程？[^}]+danger:\s*true/],
  ];
  for (const [file, pattern] of checks) {
    const src = await readFile(file, "utf8");
    assert.match(src, pattern, `${file} 缺少显式 danger: true`);
  }
});

test("G-03：Toast 位于顶栏下方（桌面）/ 编辑器底部（手机），不遮挡或拦截编辑器顶栏", async () => {
  const css = await readFile("src/ui/components.css", "utf8");
  const region = css.match(/\.ui-toast-region\s*\{([^}]*)\}/)?.[1] || "";
  const topPx = Number(region.match(/\btop:\s*(\d+)px/)?.[1] || 0);
  assert.ok(topPx >= 68, `期望 .ui-toast-region top >= 68px，实际为 ${topPx}px`);
  assert.match(region, /pointer-events:\s*none;/);
  assert.match(css, /body:has\(\.yxp-editor,\s*\.yxv-editor\)\s*>\s*\.ui-toast-region\s*\{[^}]*top:\s*auto;[^}]*bottom:/);
});

test("G-01：yx-plans 发送/签约/归档/恢复/调价成功后重载完整方案再渲染", async () => {
  const js = await readFile("src/tenant/yx-plans.js", "utf8");
  for (const fn of ["yxpSend", "yxpSign", "yxpArchive", "yxpRevisions", "yxpReprice"]) {
    const idx = js.indexOf("async function " + fn + "(");
    const slice = js.slice(idx, idx + 1500);
    assert.doesNotMatch(slice, /st\.doc\s*=\s*await api\([^)]*\/(?:send|sign|archive|restore|reprice)/, fn);
    assert.match(slice, /st\.doc\s*=\s*await api\("plans\/"\s*\+\s*encodeURIComponent\(st\.doc\.id\)\);/, fn);
  }
});
