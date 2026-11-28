"use strict";
const UI = globalThis.ChannelUI;
const fmt = UI.fmt;
const root = document.querySelector("#root"),
  base = document.querySelector("meta[name=tenant-base]").content,
  turnstileEnabled =
    document.querySelector("meta[name=turnstile-mode]")?.content !== "off";
let me,
  brand,
  challenge = "",
  widget;
function el(tag, text, attrs = {}) {
  const node = document.createElement(tag);
  if (text !== null && text !== undefined) node.textContent = text;
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else node.setAttribute(k, v);
  }
  return node;
}
function button(text, fn, kind = "") {
  const control = UI.button(text, {
    kind: kind.includes("primary")
      ? "primary"
      : kind.includes("danger")
        ? "danger"
        : kind.includes("link")
          ? "link"
          : "",
    onClick: fn,
  });
  control.classList.add("button");
  for (const part of kind.split(" ").filter(Boolean))
    control.classList.add(part);
  return control;
}
function notice(message, tone = "error") {
  const t = document.querySelector("#toast");
  t.textContent = message;
  t.hidden = true;
  UI.toast(message, { tone, duration: tone === "error" ? 0 : 3000 });
}
async function ask(message) {
  return UI.confirmDialog({
    title: "请确认操作",
    message,
    confirmLabel: "确认",
    danger: true,
  });
}
function requestReason(title, {
  message = "退回后不扣课、不计酬，教师可在窗口内修改并重新提交。",
  confirmLabel = "确认退回",
} = {}) {
  return new Promise((resolve) => {
    const view = UI.formDialog([
      { name: "reason", label: title, required: true, type: "textarea" },
    ], { title });
    view.body.prepend(
      el("p", message),
    );
    let resolved = false,
      closeValue = null;
    const finish = (value) => {
      if (resolved) return;
      resolved = true;
      resolve(value);
    };
    view.element.addEventListener("close", () => finish(closeValue));
    view.footer.append(
      button("取消", async () => {
        await view.close();
        finish(null);
      }),
      button(
        confirmLabel,
        async () => {
          const value = view.inputs.reason.input.value.trim();
          if (!value) {
            view.inputs.reason.setError(title);
            return;
          }
          closeValue = value;
          await view.close();
          finish(value);
        },
        "primary",
      ),
    );
  });
}
// 请求层提速（只影响读取）：
// 1) 同一时刻对同一地址的读取只发一次，其余共用结果；
// 2) 教师、教室、课程大类、细分课程、学员名单这几类“选项”缓存一段时间，打开表单不必每次重取；
// 3) 写操作只作废和它有关的选项（改学员只刷新学员名单，排课、缴费不动选项）；
//    服务器明确回复“没有保存”（committed:false，例如排课冲突）时什么都不作废；
// 4) 写操作进行中发出的旧读取，回来后不再写进缓存，避免把旧数据存回去；
// 5) 同一份名单的不同写法（例如带不带空的 q=）算作同一份。
// 缓存只在当前页面内存里；换账号会整页跳转到登录页，缓存随之清空，不会串号。
// 共用或缓存的结果给每个调用方一份拷贝，避免一处改动影响别处。
const apiCache = new Map(),
  apiInflight = new Map(),
  MIN = 60 * 1000,
  // 很少变、可以先存着的数据：kind＝类别，re＝哪些读取，ms＝最多存多久，writes＝哪些保存操作会让它过时。
  // 只放名单、设置这类数据；课程、点名、缴费、余额等每次都取最新（但页面会先显示上次画面、后台刷新）。
  API_CACHE_RULES = [
    { kind: "teachers", re: /^data\/teachers(\?|$)/, ms: 10 * MIN, writes: /(^|\/)teachers(\/|$|\?)|^accounts(\/|$|\?)/ },
    { kind: "locations", re: /^data\/locations(\?|$)/, ms: 10 * MIN, writes: /(^|\/)locations(\/|$|\?)/ },
    { kind: "course_types", re: /^data\/course_types(\?|$)/, ms: 10 * MIN, writes: /(^|\/)course_types(\/|$|\?)/ },
    { kind: "course_categories", re: /^data\/course_categories(\?|$)/, ms: 10 * MIN, writes: /(^|\/)course_categories(\/|$|\?)/ },
    { kind: "students", re: /^data\/students(\?|$)/, ms: 3 * MIN, writes: /(^|\/)students(\/|$|\?)|^accounts(\/|$|\?)/ },
    { kind: "student_schedule_blocks", re: /^data\/student_schedule_blocks(\?|$)/, ms: 5 * MIN, writes: /(^|\/)student_schedule_blocks(\/|$|\?)/ },
    { kind: "followup-assignees", re: /^followup-assignees$/, ms: 10 * MIN, writes: /^(accounts|rights|roles)(\/|$|\?)/ },
    { kind: "renewal-brand", re: /^renewal-brand$/, ms: 10 * MIN, writes: /^(renewal-settings|promo\/assets)(\/|$|\?)/ },
    { kind: "rates", re: /^finance\/rates(\?|$)/, ms: 5 * MIN, writes: /^finance\/rates(\/|$|\?)/ },
  ],
  // 切换页面先显示上次画好的内容，同时后台取最新；超过 30 分钟不用；任何写操作后全部作废。
  // 只缓存查看类页面；日历、学员详情带有自己的监听，不缓存。
  viewCache = new Map(),
  VIEW_CACHE_KEYS = /^(today|students|schedule-[a-z]+|todo-[a-z-]+|finance-[a-z-]+|enrol-[a-z-]+|settings-teachers)$/,
  VIEW_CACHE_MS = 30 * 60 * 1000;
// 每类数据一个“版本号”：作废时加一，进行中的旧读取据此知道自己过时了。
const apiEpoch = new Map();
// 保存操作计数：每次可能改了数据的写操作加一，页面自己的短期缓存据此判断是否还能用。
let apiWriteSeq = 0;
const apiRule = (path) => API_CACHE_RULES.find((r) => r.re.test(path));
const apiOptionKind = (path) => apiRule(path)?.kind || "";
// 统一写法：data/<选项>?offset=0&q= 与 data/<选项>?offset=0 是同一份数据。只去掉空的 q，其他参数原样保留。
function apiKey(path) {
  if (!apiOptionKind(path) || !path.includes("?")) return path;
  const [head, query] = path.split("?");
  const params = new URLSearchParams(query);
  if (params.get("q") === "") params.delete("q");
  const rest = params.toString();
  return rest ? head + "?" + rest : head;
}
// 一次写操作会影响哪些数据。返回 null 表示“影响面不明，全部作废”。
function apiAffects(path) {
  if (/^(imports?|reorder|data-tools|rebuild|settings|rights|roles|tenant|purge|restore|backup)(\/|$|\?)/.test(path)) return null;
  return API_CACHE_RULES.filter((r) => r.writes.test(path)).map((r) => r.kind);
}
function apiInvalidate(kinds) {
  for (const key of [...apiCache.keys(), ...apiInflight.keys()]) {
    const kind = apiOptionKind(key);
    if (kind && (kinds === null || kinds.includes(kind))) {
      apiCache.delete(key);
      apiInflight.delete(key);
    }
  }
  for (const kind of kinds === null ? API_CACHE_RULES.map((r) => r.kind) : kinds) apiEpoch.set(kind, (apiEpoch.get(kind) || 0) + 1);
}
async function api(path, method = "GET", data) {
  // “预览”类 POST 只做计算、不写数据，不必清空缓存。
  if (method !== "GET" && /\/preview$/.test(path)) return apiRequest(path, method, data);
  // 推广内容的“已读”、海报浏览/下载次数只是统计，不改变任何业务数据，也不清缓存。
  if (method === "POST" && /^promo\/[a-z0-9_]+\/(read|posters\/[a-z0-9_]+\/event)$/.test(path)) return apiRequest(path, method, data);
  if (method !== "GET") {
    const kinds = apiAffects(path);
    // 发出前先作废：写的过程中别人读到的旧名单不会被存回缓存。
    apiInvalidate(kinds);
    let result;
    try {
      result = await apiRequest(path, method, data);
      return result;
    } finally {
      // 服务器明确说“没有保存”时，页面数据也没变，保留页面缓存；其余情况（成功、出错、断网）都当作可能已改动。
      if (result?.committed !== false) {
        apiInvalidate(kinds);
        viewCache.clear();
        apiWriteSeq++;
      }
    }
  }
  const key = apiKey(path),
    kind = apiOptionKind(key),
    hit = apiCache.get(key);
  if (hit && Date.now() - hit.at < (apiRule(key)?.ms || 0)) return structuredClone(hit.value);
  if (apiInflight.has(key)) return structuredClone(await apiInflight.get(key));
  const epoch = apiEpoch.get(kind) || 0,
    pending = apiGet(path);
  apiInflight.set(key, pending);
  try {
    const value = await pending;
    if (kind && (apiEpoch.get(kind) || 0) === epoch) apiCache.set(key, { at: Date.now(), value: structuredClone(value) });
    return value;
  } finally {
    if (apiInflight.get(key) === pending) apiInflight.delete(key);
  }
}
// ---------- 自动合批读取 ----------
// 同一时刻发出的白名单内读取，合成一次 read-batch 请求（只验证一次身份、只占一次请求次数），
// 每一条仍按原接口的权限和结果单独返回、单独报错。只有一条时照常单发。
// 后端没有这个接口（旧版本、404/405）时自动关掉合批、逐条重发。白名单与后端 read-batch.js 一致。
const BATCH_EXACT = new Set([
  "c2/home", "schedule", "c2/unchecked", "submissions", "c2/makeups",
  "finance/receivable-summary", "c2/renewals", "system-messages", "c2/followups",
  "c2/students", "c2/students/counts", "credits/packages", "schedule-templates",
  "data/schedule_templates", "data/schedule_enrollments", "data/teachers", "data/locations",
  "data/course_types", "data/course_categories", "data/students", "promo/recommend", "todo/summary",
]);
const batchable = (path) => {
  const name = path.split("?")[0];
  return path.length <= 2048 && !/[\\#\s]/.test(path) &&
    (BATCH_EXACT.has(name) || /^(?:c2\/students\/[a-zA-Z0-9_-]+(?:\/history)?|data\/students\/[a-zA-Z0-9_-]+)$/.test(name));
};
let batchOff = false,
  batchQueue = [],
  batchTimer = 0;
function apiGet(path) {
  if (batchOff || !batchable(path)) return apiRequest(path, "GET");
  return new Promise((resolve, reject) => {
    batchQueue.push({ path, resolve, reject });
    if (batchQueue.length >= 12) flushBatch();
    else if (!batchTimer) batchTimer = setTimeout(flushBatch, 0);
  });
}
async function flushBatch() {
  clearTimeout(batchTimer);
  batchTimer = 0;
  const items = batchQueue.splice(0, 12);
  if (batchQueue.length) batchTimer = setTimeout(flushBatch, 0);
  if (!items.length) return;
  const single = (x) => apiRequest(x.path, "GET").then(x.resolve, x.reject);
  if (items.length === 1) return single(items[0]);
  let response;
  try {
    response = await fetch(base + "api/read-batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paths: items.map((x) => x.path) }),
      credentials: "same-origin",
    });
  } catch {
    // 断网等：逐条重发，让每条按原样报错。
    return items.forEach(single);
  }
  if (response.status === 404 || response.status === 405) {
    batchOff = true;
    return items.forEach(single);
  }
  let result;
  try {
    result = await response.json();
  } catch {
    result = null;
  }
  if (!response.ok || !Array.isArray(result?.results)) {
    // 整批被拒（登录过期、请求太频繁等）：按单条的规则处理。
    if (response.status === 401) location.assign(base + "login");
    const e = Error(result?.error || "操作失败");
    e.status = response.status;
    e.code = result?.code;
    return items.forEach((x) => x.reject(e));
  }
  items.forEach((x, i) => {
    const r = result.results[i];
    if (r && r.status >= 200 && r.status < 300) return x.resolve(r.body);
    const body = r && typeof r.body === "object" && r.body ? r.body : { error: "记录或页面不存在" };
    const e = Error(body.error || "操作失败");
    e.status = r?.status || 500;
    e.code = body.code;
    e.details = body.details;
    x.reject(e);
  });
}
async function apiRequest(path, method = "GET", data) {
  // 艺界星途：家长查看某个孩子时自动带上 student_id（见 yx.js）。
  // 只单独运行 app.js（旧登录回归测试）时没有 yx.js，下面几处都先判断函数是否存在。
  if (typeof yxScopedPath === "function") path = yxScopedPath(path);
  const response = await fetch(base + "api/" + path, {
    method,
    headers: method === "GET" ? {} : { "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
    credentials: "same-origin",
  });
  let result;
  try {
    result = await response.json();
  } catch {
    result = { error: "记录或页面不存在" };
  }
  if (!response.ok) {
    const loginRequest = typeof yxLoginPath === "function" ? yxLoginPath(path) : path.startsWith("login");
    if (response.status === 401 && !loginRequest)
      location.assign(base + "login");
    // 新接口错误为 {error: 代码, message: 中文}；旧接口为 {error: 中文, code}。两种都显示中文。
    const code = result.message ? result.error : result.code;
    if (response.status === 403 && code === "tenant_expired" && !loginRequest && typeof yxTenantPaused === "function")
      yxTenantPaused(result.message);
    const raw = result.message || result.error || "操作失败";
    // 学科没开通或没导入学科包时，后端只说“学科未开放”，这里告诉用户去哪里处理。
    const STO = { storage_full: "图库容量已满：请先删除不用的图片，或联系平台扩容。", storage_pending: "正在统计图库容量，请过几秒再上传。", storage_unavailable: "图库暂时连不上，请稍后再试。" };
    const e = Error(STO[code] ? STO[code] : raw === "学科未开放" ? "这个学科还没开放：请先在“机构设置 › 课程与教室 › 报价课程与价目表”里导入学科包；列表里没有这个学科时，请联系平台开通。" : raw);
    e.status = response.status;
    e.code = code;
    e.details = result.details;
    throw e;
  }
  return result;
}
function field(form, label, name, type = "text", value = "", required = true) {
  const f = UI.field({ label, name, type, value, required });
  f.element.classList.add("field");
  form.append(f.element);
  return f.input;
}
function submit(form, label, handler) {
  form.noValidate = true;
  const b = UI.button(label, { kind: "primary" });
  b.setAttribute("type", "submit");
  b.classList.add("button");
  form.append(b);
  // 侧边栏里的表单统一排版（见 standardForm）；页面内嵌的表单不动。
  void Promise.resolve().then(() => {
    if (!form.classList?.contains("v-std-form") && form.closest?.(".business-drawer"))
      standardForm(form);
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (b.disabled) return;
    form.querySelector(".form-error")?.remove();
    for (const c of form.querySelectorAll?.("input, select, textarea") || []) {
      if (c.disabled || c.type === "hidden" || c.closest?.("[hidden]")) continue;
      const raw = String(c.value || "").trim();
      const fieldLabel = (c.closest?.(".field, .ui-field, label")?.querySelector?.("span, label")?.textContent || c.getAttribute?.("aria-label") || "该项").replace(/\s*\*$/, "").trim();
      let msg = "";
      if (c.required && !raw) msg = (c.tagName === "SELECT" ? "请选择" : "请填写") + fieldLabel;
      else if (c.checkValidity && !c.checkValidity()) msg = /[\u4e00-\u9fff]/.test(c.validationMessage || "") ? c.validationMessage : "请检查“" + fieldLabel + "”的格式";
      if (msg) {
        c.focus?.();
        const feedback = el("p", msg, { class: "ui-field-error form-error", role: "alert" });
        const foot = form.querySelector(":scope > .v-form-foot");
        if (foot) foot.before(feedback);
        else form.append(feedback);
        return;
      }
    }
    b.disabled = true;
    b.setAttribute("aria-busy", "true");
    // 与通用按钮一致：0.3 秒内完成不变样；更久才变浅并显示“保存中…”。
    const text = b.querySelector(".ui-button-face > span:last-child");
    const verb = label.match(/^(保存|提交|确认|生成|登记|发送)/)?.[1];
    const timer = setTimeout(() => {
      b.classList.add("is-busy");
      if (verb && text) text.textContent = verb + "中…";
    }, 300);
    try {
      await handler(Object.fromEntries(new FormData(form)));
    } catch (e) {
      const feedback = el("p", e.message, {
        class: "ui-field-error form-error",
        role: "alert",
      });
      const foot = form.querySelector(":scope > .v-form-foot");
      if (foot) foot.before(feedback);
      else form.append(feedback);
      notice(e.message);
    } finally {
      clearTimeout(timer);
      b.classList.remove("is-busy");
      if (verb && text) text.textContent = label;
      b.removeAttribute("aria-busy");
      b.disabled = false;
    }
  });
}
function brandInitial() {
  return Array.from((brand.display_name || "").trim())[0] || "教";
}
function mark() {
  return brand.logo
    ? el("img", null, {
        src: brand.logo,
        alt: brand.display_name,
        class: "logo",
      })
    : el("span", brandInitial(), { class: "logo fallback" });
}
async function login() {
  // 艺界星途登录页（根地址 / 机构路径两种），见 yx.js；下面是原渠道版登录页，保留备查。
  if (globalThis.yxLoginPage) return yxLoginPage();
  root.replaceChildren();
  const layout = el("section", null, { class: "login-layout" }),
    hero = el("div", null, { class: "hero" });
  if (brand.login_bg || brand.login_bg_url)
    hero.append(
      el("img", null, { src: brand.login_bg || brand.login_bg_url, alt: "", class: "hero-image", decoding: "async" }),
    );
  const heading = el("div", null, { class: "hero-brand" });
  heading.append(mark(), el("strong", brand.display_name));
  hero.append(
    heading,
    el(
      "h1",
      brand.welcome_text || "让每一节课都有记录，\n每一位学员都被看见。",
    ),
  );
  const panel = el("div", null, { class: "login-panel" }),
    form = el("form");
  form.append(
    el("h2", "账号登录"),
    el("p", "员工、教师、学员均使用本机构开通的手机号登录", { class: "muted" }),
  );
  const phoneInput = field(form, "手机号", "phone", "tel");
  phoneInput.autocomplete = "username";
  phoneInput.placeholder = "请输入 11 位手机号";
  phoneInput.inputMode = "tel";
  const passwordInput = field(form, "密码", "password", "password");
  passwordInput.autocomplete = "current-password";
  passwordInput.placeholder = "请输入密码";
  const challengeNode = turnstileEnabled
    ? el("div", "正在加载人机验证…", {
        class: "challenge muted",
      })
    : null;
  if (challengeNode) form.append(challengeNode);
  submit(form, "登录", async (data) => {
    if (turnstileEnabled && !challenge) throw Error("请先完成人机验证");
    try {
      await api(
        "login",
        "POST",
        turnstileEnabled ? { ...data, turnstile: challenge } : data,
      );
      location.assign(base + "app/");
    } catch (e) {
      if (turnstileEnabled && window.turnstile && widget !== undefined)
        window.turnstile.reset(widget);
      challenge = "";
      throw e;
    }
  });
  form.append(
    el("p", "忘记密码？请联系机构教务重置", { class: "muted center" }),
  );
  form.append(el("p", "© " + brand.display_name, { class: "login-copyright" }));
  panel.append(form);
  layout.append(hero, panel);
  root.append(layout);
  if (!turnstileEnabled) return;
  const script = el("script", null, {
    src: "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit",
    async: "",
  });
  script.addEventListener("load", () => {
    window.turnstile.ready(() => {
      challengeNode.replaceChildren();
      widget = window.turnstile.render(challengeNode, {
        sitekey: document.querySelector("meta[name=turnstile-key]").content,
        action: "login",
        callback: (token) => (challenge = token),
        "expired-callback": () => (challenge = ""),
        "error-callback": () => {
          challenge = "";
          challengeNode.textContent = "人机验证暂时不可用，请刷新重试";
          notice("人机验证加载失败，请刷新重试");
        },
      });
    });
  });
  script.addEventListener("error", () => {
    challengeNode.textContent = "人机验证暂时不可用，请刷新重试";
    notice("人机验证加载失败，请刷新重试");
  });
  document.head.append(script);
}
function changePassword(container, forced = false) {
  const form = el("form", null, { class: "panel narrow" });
  form.append(
    el("h2", forced ? "请先修改初始密码" : "修改密码"),
    el("p", "8–64 位，包含字母和数字，请勿使用手机号片段或常见弱密码。", {
      class: "muted",
    }),
  );
  field(form, "原密码", "old_password", "password").autocomplete =
    "current-password";
  field(form, "新密码", "password", "password").autocomplete = "new-password";
  const confirm = field(form, "再次输入新密码", "confirm", "password");
  confirm.autocomplete = "new-password";
  submit(form, "保存并重新登录", async (data) => {
    if (data.password !== data.confirm) throw Error("两次输入的密码不一致");
    await api("password", "POST", data);
    location.assign(base + "login");
  });
  container.append(form);
}
// 后面各页面文件把自己的入口挂到这里（如 pageHooks.checkin），外壳只按名字调用。
const pageHooks = {};
// 第十阶段重构外壳：左侧两组导航（日常 / 机构管理），页头放标题、分页和本页动作；手机为底部五个标签。
let vHead = null;
function shell() {
  if (me.user.must_change) {
    root.replaceChildren();
    const frame = el("div", null, { class: "personal-frame c3-personal v-personal" }),
      header = el("header", null, { class: "personal-header" }),
      identity = el("div"),
      content = el("section", null, { class: "personal-content", "aria-busy": "false" });
    identity.append(el("strong", brand.display_name), el("small", me.user.name));
    header.append(mark(), identity);
    changePassword(content, true);
    content.append(button("退出登录", async () => {
      await api("logout", "POST", {});
      location.assign(base + "login");
    }));
    frame.append(header, content);
    root.append(frame);
    return;
  }
  if (me.user.roles.some((r) => ["teacher", "student"].includes(r)))
    return personalShell();
  root.replaceChildren();
  const roles = me.user.roles;
  const financeOnly =
    roles.includes("finance") &&
    !roles.some((r) => ["supervisor", "academic"].includes(r));
  const roleName =
    {
      supervisor: "机构主管",
      consultant: "顾问",
      academic: "教务",
      finance: "财务",
    }[roles.find((r) => ["supervisor", "consultant", "academic", "finance"].includes(r))] ||
    "";
  const frame = el("div", null, { class: "app-frame v-frame" }),
    aside = el("aside", null, { class: "v-side", "aria-label": "主菜单" }),
    branding = el("div", null, { class: "v-brand" }),
    copy = el("div");
  copy.append(el("strong", brand.display_name), el("small", "艺界星途"));
  if (brand.display_name) document.title = brand.display_name;
  branding.append(mark(), copy);
  aside.append(branding);
  const main = el("div", null, { class: "v-main" }),
    header = el("header", null, { class: "v-head" }),
    headTitle = el("div", null, { class: "v-head-title" }),
    title = el("h1", "今天", { "data-brand": brand.display_name }),
    sub = el("span", "", { class: "v-head-sub" }),
    headTabs = el("nav", null, { class: "v-head-tabs", "aria-label": "分页" }),
    headActions = el("div", null, { class: "v-head-actions" }),
    tools = el("div", null, { class: "v-head-tools" }),
    // 页面按钮单独一行：左边放本页筛选，右边放本页按钮；顶栏的搜索/新建/铃铛/头像始终保留。
    toolbar = el("div", null, { class: "v-toolbar" }),
    barLeft = el("div", null, { class: "v-toolbar-left" }),
    content = el("section", null, { class: "content v-content" });
  headTitle.append(title, sub);
  toolbar.append(barLeft, headActions);
  // 二级菜单下的蓝色横线：用一张单独的样式表设置位置（不写行内样式），切换时平滑滑过去。
  // 只用 transform 动画；系统设置了“减少动态效果”时直接跳到位。
  let inkSheet = null;
  const moveTabInk = (instant) => {
    const ink = headTabs.querySelector(":scope > .v-tab-ink"),
      on = headTabs.querySelector(':scope > .ui-button[aria-current="page"]');
    if (!ink || !globalThis.CSSStyleSheet?.prototype?.replaceSync) return;
    if (!inkSheet) {
      inkSheet = new CSSStyleSheet();
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, inkSheet];
    }
    headTabs.classList.add("has-ink");
    ink.classList.toggle("is-instant", !!instant);
    ink.classList.toggle("is-hidden", !on);
    if (!on || !on.offsetWidth) return;
    inkSheet.replaceSync(".v-head-tabs > .v-tab-ink{transform:translateX(" + on.offsetLeft + "px) scaleX(" + (on.offsetWidth / 100).toFixed(4) + ")}");
    if (instant) requestAnimationFrame(() => ink.classList.remove("is-instant"));
  };
  // 页面内容淡入（0.18 秒，轻微上移）；同一节点再次使用时能重新触发。
  const pageEnter = (node) => {
    node.classList.remove("v-enter");
    void node.offsetWidth;
    node.classList.add("v-enter");
    node.addEventListener("animationend", () => node.classList.remove("v-enter"), { once: true });
  };
  let inkTimer = 0;
  globalThis.addEventListener?.("resize", () => {
    clearTimeout(inkTimer);
    inkTimer = setTimeout(() => moveTabInk(true), 120);
  });
  document.fonts?.ready?.then(() => moveTabInk(true));
  vHead = {
    sub(text) {
      sub.textContent = text || "";
    },
    actions(...nodes) {
      headActions.replaceChildren(...nodes.filter(Boolean));
    },
    bar(...nodes) {
      barLeft.replaceChildren(...nodes.filter(Boolean));
    },
  };
  const routes = {};
  const register = (key, label, module, fn, action = "read") => {
    if (enabled(module, action)) {
      routes[key] = { key, label, fn };
      return routes[key];
    }
    return null;
  };
  const daily = [
    {
      key: "today",
      label: "今天",
      icon: "home",
      tabs: [register("today", "今天", "home", (c) => home(c))],
    },
    // 艺界星途：招生工具（工作台、课程方案），见 yx-home.js。
    ...(typeof yxNavGroups === "function" ? yxNavGroups(register) : []),
    ...(!financeOnly
      ? [
          {
            key: "todo",
            label: "待办",
            icon: "check",
            tabs: [
              // 原“未销课”和“教师提交”合成一个分页；旧地址 #todo-teacher 自动跳到这里的第二个小分页。
              register("todo-unchecked", "点名销课", "schedule", (c) =>
                pageHooks.checkin
                  ? pageHooks.checkin(c)
                  : globalThis.ChannelRebuild.unchecked(c),
              ),
              register("todo-makeup", "请假待补课", "attendance", (c) =>
                globalThis.ChannelRebuild.makeups(c),
              ),
              register("todo-followup", "跟进任务", "followup", (c) =>
                followupPage(c),
              ),
              register("todo-renewal", "续费提醒", "packages", (c) =>
                renewalsPage(c),
              ),
            ],
          },
        ]
      : []),
    {
      key: "schedule",
      label: "课表",
      icon: "calendar",
      tabs: [
        register("schedule-week", "周课表", "schedule", (c) => schedulePage(c)),
        ...(enabled("students")
          ? [register("schedule-student", "按学员", "schedule", (c) => globalThis.ChannelV2.studentScheduleView(c))]
          : []),
        register("schedule-fixed", "固定排课", "templates", (c) =>
          templatesPage(c),
        ),
        register("schedule-classes", "班级", "classes", (c) => classesPage(c)),
      ],
    },
    {
      key: "students",
      label: "学员",
      icon: "user",
      tabs: [register("students", "学员", "students", (c) => studentsPage(c))],
    },
    ...(!financeOnly
      ? [
          {
            key: "teachers",
            label: "教师",
            icon: "users",
            tabs: [
              register("settings-teachers", "教师", "settings", (c) =>
                recordsPage(c, "teachers"),
              ),
              // 原“课酬标准总表”并到教师页，作为第二个分页。
              register(
                "teachers-rates",
                "课酬标准",
                "teacher_pay",
                (c) => pageHooks.rates(c),
              ),
            ],
          },
          {
            key: "enrol",
            label: "招生",
            icon: "link",
            tabs: [
              register("enrol-leads", "线索", "leads", (c) => leadsPage(c)),
              register("enrol-referrals", "合作升学", "referrals", (c) =>
                referralsPage(c),
              ),
              register("enrol-promo", "推广中心", "promo", (c) =>
                promoCenter(c),
              ),
            ],
          },
        ]
      : []),
    ...(roles.some((r) => ["supervisor", "finance"].includes(r))
      ? [
          {
            key: "finance",
            label: "财务",
            icon: "wallet",
            tabs: [
              register("finance-income", "收款", "tuition", (c) =>
                creditPage(c, "payments"),
              ),
              register("finance-packages", "课时包", "packages", (c) =>
                creditPage(c),
              ),
              register("finance-pay", "月度结算", "teacher_pay", (c) =>
                financePage(c),
              ),
              // 财务账号没有“教师”菜单：课酬标准放在财务里（同一个页面）。
              ...(financeOnly
                ? [
                    register("finance-rates", "课酬标准", "teacher_pay", (c) =>
                      pageHooks.rates(c),
                    ),
                  ]
                : []),
              register("finance-costs", "其他成本", "settlements", (c) =>
                financeRecords(c, "costs"),
              ),
              register("finance-reports", "报表", "reports", (c) =>
                reportsPage(c),
              ),
            ],
          },
        ]
      : []),
  ];
  const manage = financeOnly
    ? [
        enabled("logs", "read_finance")
          ? {
              key: "logs",
              label: "操作记录",
              icon: "shield",
              tabs: [
                (routes["settings-logs"] = {
                  key: "settings-logs",
                  label: "操作记录",
                  fn: (c) => logs(c),
                }),
              ],
            }
          : null,
      ]
    : [
        {
          key: "courses",
          label: "课程与教室",
          icon: "book",
          tabs: [
            register(
              "admin-courses",
              "课程与教室",
              "settings",
              (c) => settingsPage(c),
            ),
          ],
        },
        {
          key: "accounts",
          label: "账号与权限",
          icon: "shield",
          tabs: [
            register("settings-accounts", "账号", "accounts", (c) =>
              accounts(c),
            ),
            // 角色权限矩阵：只有机构主管能改。
            roles.includes("supervisor")
              ? register("settings-rights", "角色权限", "accounts", (c) =>
                  pageHooks.rights(c),
                )
              : null,
          ],
        },
        {
          key: "institution",
          label: "机构设置",
          icon: "settings",
          tabs: [
            register("settings-institution", "机构设置", "settings", (c) =>
              settingsPage(c),
            ),
          ],
        },
        {
          key: "import",
          label: "数据导入导出",
          icon: "upload",
          tabs: [
            register("settings-import", "导入", "imports", (c) =>
              importWizard(c),
            ),
            // 导出集中在这里（各页面原有的导出按钮保留）。
            register("settings-export", "导出", "exports", (c) =>
              pageHooks.exports(c),
              "export",
            ),
          ],
        },
        enabled("logs") || enabled("logs", "read_finance")
          ? {
              key: "logs",
              label: "操作记录",
              icon: "shield",
              tabs: [
                (routes["settings-logs"] = {
                  key: "settings-logs",
                  label: "操作记录",
                  fn: (c) => logs(c),
                }),
              ],
            }
          : null,
      ];
  // 艺界星途：按设计稿 v3 把招生工具和设置挂进原有分组（yx-home.js）。
  if (typeof yxNavRework === "function") yxNavRework(daily, manage, register);
  const tidy = (list) =>
    list
      .filter(Boolean)
      .map((g) => ({ ...g, tabs: g.tabs.filter(Boolean) }))
      .filter((g) => g.tabs.length);
  const dailyGroups = tidy(daily),
    manageGroups = tidy(manage),
    groups = [...dailyGroups, ...manageGroups];
  register("settings-messages", "系统消息", "home", (c) => systemMessages(c));
  const nav = el("nav", null, { class: "v-nav staff-nav", "aria-label": "员工导航" });
  const navButton = (g) => {
    const item = button(g.label, () => navigate(g.tabs[0].key));
    item.classList.add("v-nav-item");
    item.dataset.group = g.key;
    return item;
  };
  if (dailyGroups.length) {
    nav.append(el("p", "日常", { class: "v-nav-label" }));
    for (const g of dailyGroups) nav.append(navButton(g));
  }
  if (manageGroups.length) {
    nav.append(el("p", "机构管理", { class: "v-nav-label" }));
    for (const g of manageGroups) nav.append(navButton(g));
  }
  aside.append(nav);
  // 手机底部五个标签：今天 / 课表 / 学员 / 待办 / 更多。
  const tabbar = el("nav", null, { class: "v-tabbar", "aria-label": "底部导航" });
  const primaryKeys = ["today", "schedule", "students", "todo"];
  for (const key of primaryKeys) {
    const g = groups.find((x) => x.key === key);
    if (!g) continue;
    const item = el("button", null, {
      type: "button",
      class: "v-tab",
      "data-group": g.key,
    });
    item.append(UI.icon(g.icon), el("span", g.label));
    item.addEventListener("click", () => navigate(g.tabs[0].key));
    tabbar.append(item);
  }
  const moreTab = el("button", null, { type: "button", class: "v-tab" });
  moreTab.append(UI.icon("more"), el("span", "更多"));
  moreTab.addEventListener("click", () => {
    const sheet = UI.overlay({ title: "更多", kind: "modal" });
    sheet.element.classList.add("v-more-sheet");
    const list = el("div", null, { class: "v-more-list" });
    for (const g of groups.filter((x) => !primaryKeys.includes(x.key))) {
      const b = el("button", null, { type: "button", class: "v-more-item" });
      b.append(UI.icon(g.icon), el("span", g.label));
      b.addEventListener("click", async () => {
        await sheet.close();
        navigate(g.tabs[0].key);
      });
      list.append(b);
    }
    sheet.body.append(list);
  });
  tabbar.append(moreTab);
  let todoCounts = null;
  const tabCount = (key) =>
    !todoCounts
      ? null
      : {
          "todo-unchecked":
            (todoCounts.unchecked_lessons || 0) +
            (enabled("attendance", "confirm")
              ? todoCounts.teacher_submissions || 0
              : 0),
          "todo-makeup": todoCounts.makeup_recent ?? todoCounts.makeup_pending,
          "todo-followup":
            (todoCounts.followup_overdue || 0) +
            (todoCounts.followup_today || 0),
          "todo-renewal":
            (todoCounts.renewal_zero || 0) +
            (todoCounts.renewal_low || 0) +
            (todoCounts.renewal_expiring || 0),
        }[key];
  let routeSequence = 0;
  const navigate = (key) => {
    if (key === "todo-teacher") {
      pageHooks.pickCheckin?.("teacher");
      key = "todo-unchecked";
    }
    if (!routes[key]) key = groups[0]?.tabs[0].key || "today";
    if (globalThis.location && location.hash !== "#" + key) location.hash = key;
    else void render(key);
  };
  const render = async (key) => {
    if (key === "todo-teacher") {
      pageHooks.pickCheckin?.("teacher");
      return navigate("todo-unchecked");
    }
    const studentRoute = globalThis.ChannelRebuild?.parseStudentHash(key);
    if (studentRoute && enabled("students"))
      routes[key] = {
        key,
        label: "学员",
        fn: (c) => globalThis.ChannelRebuild.studentDetail(c, ...studentRoute),
      };
    const route = routes[key];
    if (!route) {
      navigate(groups[0]?.tabs[0]?.key || "today");
      return;
    }
    const sequence = ++routeSequence;
    // 同页内切换（如学员列表里换一个学员、详情里换分页）：页面自己只更新变化的那一块，
    // 不清空整页、不闪骨架、不重新请求列表。页面通过 body.__soft(key) 声明能否处理。
    const current = content.querySelector(":scope > .ui-page-body");
    if (current?.__soft?.(key)) {
      content.dataset.route = key;
      frame.dataset.route = key;
      return;
    }
    content.dataset.route = key;
    content.setAttribute("aria-busy", "true");
    // 换页时释放上一页生成的海报/课表图片占用的内存。
    promoClearImages();
    content.querySelector(".ui-page-body")?.__calendarDestroy?.();
    content.__calendarDestroy?.();
    content.__calendarDestroy = null;
    const group = studentRoute
      ? groups.find((g) => g.key === "students")
      : groups.find((g) => g.tabs.some((t) => t.key === key));
    title.textContent = group?.label || route.label;
    vHead.sub("");
    vHead.actions();
    vHead.bar();
    for (const item of [
      ...nav.querySelectorAll("button"),
      ...tabbar.querySelectorAll("button"),
    ])
      item.setAttribute(
        "aria-current",
        item.dataset.group && item.dataset.group === group?.key
          ? "page"
          : "false",
      );
    // 同一组里切换二级菜单：不重建这排按钮（以前整排删掉重建，选中状态和数字会闪一下），只改选中项，
    // 下面的蓝色横线滑到新位置。换到另一组时才重建。
    const sameGroup = group && headTabs.dataset.group === group.key && !headTabs.dataset.inner && headTabs.childElementCount;
    if (!sameGroup) {
      headTabs.replaceChildren();
      delete headTabs.dataset.inner;
      delete headTabs.dataset.group;
      if (group?.tabs.length > 1) {
        headTabs.dataset.group = group.key;
        for (const t of group.tabs) {
          const b = button(t.label, () => navigate(t.key));
          b.dataset.tabKey = t.key;
          headTabs.append(b);
        }
        headTabs.append(el("span", null, { class: "v-tab-ink", "aria-hidden": "true" }));
      }
    }
    for (const b of headTabs.querySelectorAll(":scope > .ui-button[data-tab-key]")) {
      b.setAttribute("aria-current", b.dataset.tabKey === key ? "page" : "false");
      const n = tabCount(b.dataset.tabKey);
      const tag = b.querySelector(".ui-tab-count");
      if (n === undefined || n === null) tag?.remove();
      else if (tag) tag.textContent = String(n);
      else b.append(el("span", String(n), { class: "ui-tab-count" }));
    }
    moveTabInk(!sameGroup);
    headTabs.querySelector(':scope > .ui-button[aria-current="page"]')?.scrollIntoView?.({ inline: "nearest", block: "nearest" });
    frame.dataset.route = key;
    const saveView = (node) => {
      if (!VIEW_CACHE_KEYS.test(key) || node.__calendarDestroy || node.__soft) return;
      viewCache.set(key, {
        body: node,
        sub: sub.textContent,
        actions: [...headActions.childNodes],
        bar: [...barLeft.childNodes],
        at: Date.now(),
      });
    };
    const cached = VIEW_CACHE_KEYS.test(key) ? viewCache.get(key) : null;
    if (cached && Date.now() - cached.at < VIEW_CACHE_MS) {
      // 先显示上次的内容（淡入），顶部细条表示正在更新；数据回来后原地换成最新的。
      content.replaceChildren(cached.body);
      pageEnter(cached.body);
      vHead.sub(cached.sub);
      vHead.actions(...cached.actions);
      vHead.bar(...cached.bar);
      content.setAttribute("aria-busy", "false");
      frame.classList.add("is-refreshing");
      const next = el("section", null, { class: "ui-page-body v-body" });
      next.hidden = true;
      content.append(next);
      try {
        await route.fn(next);
        if (sequence !== routeSequence) {
          next.remove();
          return;
        }
        const ae = document.activeElement;
        if (ae && content.contains(ae) && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) {
          next.remove();
          return;
        }
        const scroller = document.scrollingElement,
          top = scroller ? scroller.scrollTop : 0;
        next.hidden = false;
        content.replaceChildren(next);
        if (scroller) scroller.scrollTop = top;
        saveView(next);
      } catch (e) {
        if (sequence === routeSequence) {
          next.remove();
          const at = new Date(cached.at);
          notice(
            "显示的是 " +
              String(at.getHours()).padStart(2, "0") +
              ":" +
              String(at.getMinutes()).padStart(2, "0") +
              " 的数据，更新失败：" +
              e.message,
          );
        }
      } finally {
        if (sequence === routeSequence) frame.classList.remove("is-refreshing");
      }
      return;
    }
    const body = el("section", null, { class: "ui-page-body v-body" });
    // 第一次进入查看类页面：先不清空当前页面（变淡、不可点），新页面在后台画好后淡入替换；
    // 0.2 秒内还没好才换成灰色骨架。这样数据很快时不会出现“内容→骨架→内容”的两次闪动。
    // 日历等需要量尺寸的页面仍按原方式（先骨架，再原地画）。
    const olds = VIEW_CACHE_KEYS.test(key) ? [...content.children] : [];
    let reveal = () => {};
    if (olds.length) {
      for (const o of olds) {
        o.classList.add("v-leaving");
        o.inert = true;
      }
      body.hidden = true;
      content.append(body);
      let skel = null;
      const dropOld = () => {
        for (const o of olds) {
          o.classList.remove("v-leaving");
          o.inert = false;
          o.remove();
        }
      };
      const timer = setTimeout(() => {
        if (sequence !== routeSequence || !body.hidden) return;
        dropOld();
        skel = el("section", null, { class: "ui-page-body v-body" });
        skel.append(UI.tableSkeleton());
        content.insertBefore(skel, body);
      }, 200);
      reveal = () => {
        clearTimeout(timer);
        dropOld();
        skel?.remove();
        body.hidden = false;
        pageEnter(body);
      };
    } else {
      content.replaceChildren(body);
      body.replaceChildren(UI.tableSkeleton());
    }
    frame.classList.add("is-refreshing");
    try {
      await route.fn(body);
      if (sequence !== routeSequence) return;
      reveal();
      saveView(body);
    } catch (e) {
      if (sequence === routeSequence) {
        reveal();
        body.replaceChildren(
          UI.empty({
            text: e.message,
            action: { label: "重试", onSelect: () => render(key) },
          }),
        );
        notice(e.message);
      }
    } finally {
      if (sequence === routeSequence) {
        content.setAttribute("aria-busy", "false");
        frame.classList.remove("is-refreshing");
      }
    }
  };
  vHead.navigate = (key) => navigate(key);
  // 页面内部的左侧小菜单（.c3-settings > nav）统一提到顶栏做分页；
  // 这一组本来就有顶栏分页时，改放到页面按钮行左边。页面重画时会重新生成小菜单，这里随之再提一次。
  const hoistInnerNav = () => {
    const inner = content.querySelector(".c3-settings > nav:not([data-hoisted])");
    if (!inner) return;
    inner.dataset.hoisted = "1";
    inner.hidden = true;
    inner.parentElement.classList.add("is-hoisted");
    const items = [...inner.children];
    if (headTabs.children.length && !headTabs.dataset.inner) {
      const seg = el("div", null, { class: "v-inner-tabs", role: "group", "aria-label": inner.getAttribute("aria-label") || "分类" });
      seg.append(...items);
      vHead.bar(seg);
    } else {
      headTabs.dataset.inner = "1";
      headTabs.replaceChildren(...items);
    }
  };
  if (globalThis.MutationObserver) new MutationObserver(hoistInnerNav).observe(content, { childList: true, subtree: true });
  // 头像菜单只留：修改密码、登录设备、退出。
  const avatar = UI.actionMenu({
    label: me.user.name || "个人菜单",
    items: [
      {
        label: "修改密码",
        onSelect: () => {
          const d = UI.overlay({ title: "修改密码", kind: "modal" });
          changePassword(d.body);
          d.body.querySelector("h2")?.remove();
        },
      },
      { label: "登录设备", onSelect: () => devices() },
      {
        label: "退出登录",
        onSelect: async () => {
          await api("logout", "POST", {});
          location.assign(base + "login");
        },
      },
    ],
  });
  avatar.element.classList.add("v-avatar");
  const face = avatar.element.querySelector(".ui-button-face");
  if (face) {
    const who = el("span", null, { class: "v-avatar-who" });
    who.append(
      el("strong", me.user.name || "我"),
      el("small", roleName),
    );
    face.replaceChildren(
      el("span", (me.user.name || "我").slice(0, 1), {
        class: "v-avatar-mark",
        "aria-hidden": "true",
      }),
      who,
    );
  }
  const search = el("form", null, { class: "v-search c1-global-search" }),
    input = el("input", null, {
      type: "search",
      maxlength: "100",
      placeholder: "搜索学员、教师、线索",
      "aria-label": "全局搜索",
    }),
    searchResults = el("div", null, {
      class: "ui-root c1-search-results",
      popover: "auto",
    });
  let searchSequence = 0;
  search.append(UI.icon("search"), input, searchResults);
  search.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const request = ++searchSequence;
      const data = await api("search?q=" + encodeURIComponent(input.value));
      if (request !== searchSequence) return;
      searchResults.replaceChildren();
      for (const [kind, label] of [
        ["students", "学员"],
        ["teachers", "教师"],
        ["leads", "线索"],
      ]) {
        const rows = data.groups[kind];
        if (!rows) continue;
        searchResults.append(el("h3", label));
        for (const row of rows)
          searchResults.append(
            button(
              kind === "students" ? UI.studentDisplay(row, rows) : row.name,
              async () => {
                searchResults.hidePopover();
                if (kind === "leads") return searchLeadDetail(content, row.id);
                await recordDetails(content, kind, row);
              },
            ),
          );
      }
      if (!searchResults.children.length)
        searchResults.append(el("p", "没有匹配记录"));
      searchResults.showPopover({ source: input });
    } catch (error) {
      notice(error.message);
    }
  });
  const create = [];
  if (enabled("lessons", "create"))
    create.push({ label: "排课", onSelect: () => lessonForm(content) });
  if (enabled("students", "create"))
    create.push({
      label: "新增学员",
      onSelect: () => recordForm(content, "students"),
    });
  if (enabled("leads", "create"))
    create.push({ label: "新增线索", onSelect: () => leadForm(content) });
  if (enabled("tuition", "create"))
    create.push({
      label: "登记缴费",
      onSelect: () => creditForm(content, "payments"),
    });
  const searchToggle = UI.iconButton("搜索", "search", () => {
    frame.classList.toggle("v-search-open");
    if (frame.classList.contains("v-search-open")) input.focus();
  });
  searchToggle.classList.add("v-search-toggle");
  tools.append(search, searchToggle);
  if (create.length) {
    const menu = UI.actionMenu({ label: "新建", items: create });
    menu.element.classList.add("v-create");
    menu.element.querySelector(".ui-button")?.classList.add("ui-button--primary");
    menu.element.querySelector(".ui-button")?.setAttribute("aria-label", "新建");
    menu.element.querySelector(".ui-button-face")?.prepend(UI.icon("plus"));
    tools.append(menu.element);
  }
  let unreadBadge = null;
  if (enabled("home")) {
    const messagePanel = el("section", null, {
      class: "ui-root c1-message-panel",
      popover: "auto",
      "aria-label": "系统消息",
    });
    // 点下立刻打开面板，先放灰色占位，数据回来再换上；不再等数据才弹出。
    let bellSequence = 0;
    const bell = UI.iconButton("系统消息", "bell", () => {
      const request = ++bellSequence;
      const skel = el("div", null, { class: "v-msg-skel", "aria-label": "正在加载通知" });
      for (let i = 0; i < 5; i++) skel.append(el("span"));
      messagePanel.replaceChildren(skel);
      messagePanel.showPopover({ source: bell });
      void (async () => {
        try {
          // 消息页先取数据、取到后才清空容器，所以占位会一直留到内容出现。
          await systemMessages(messagePanel);
          if (request !== bellSequence) return;
          await refreshCounts();
        } catch (error) {
          if (request === bellSequence) messagePanel.replaceChildren(el("p", error.message, { class: "v-muted" }));
        }
      })();
    });
    bell.classList.add("v-bell");
    bell.setAttribute("aria-haspopup", "dialog");
    unreadBadge = el("span", "", { class: "c1-unread-badge", hidden: "" });
    bell.append(unreadBadge);
    tools.append(bell, messagePanel);
  }
  tools.append(avatar.element);
  header.append(headTitle, headTabs, el("div", null, { class: "v-spacer" }), tools);
  main.append(header, toolbar, content);
  frame.append(aside, main, tabbar);
  root.append(frame);
  async function refreshCounts() {
    try {
      // 待办数字和未读消息同时请求，不再排队。
      const wantCounts = !financeOnly && enabled("home");
      const countsRequest = wantCounts ? api("todo/summary") : null;
      const messagesRequest = unreadBadge ? api("system-messages?offset=0") : null;
      countsRequest?.catch(() => {});
      messagesRequest?.catch(() => {});
      if (wantCounts) {
        const counts = await countsRequest;
        todoCounts = counts;
        for (const tab of headTabs.querySelectorAll("[data-tab-key]")) {
          const n = tabCount(tab.dataset.tabKey);
          tab.querySelector(".ui-tab-count")?.remove();
          if (n !== undefined && n !== null)
            tab.append(el("span", String(n), { class: "ui-tab-count" }));
        }
        moveTabInk(true);
        const n =
          (counts.unchecked_lessons || 0) +
          (counts.teacher_submissions || 0) +
          (counts.makeup_recent ?? counts.makeup_pending ?? 0) +
          (counts.followup_overdue || 0) +
          (counts.followup_today || 0);
        for (const item of [
          ...nav.querySelectorAll("button"),
          ...tabbar.querySelectorAll("button"),
        ].filter((x) => x.dataset.group === "todo")) {
          item.querySelector(".c1-todo-badge")?.remove();
          if (n)
            (item.querySelector(".ui-button-face") || item).append(
              el("span", String(n), { class: "c1-todo-badge" }),
            );
        }
      }
      if (unreadBadge) {
        const data = await messagesRequest;
        unreadBadge.textContent = String(data.unread_count || 0);
        unreadBadge.hidden = !data.unread_count;
        globalThis.ChannelV2Promo?.navBadge?.(data);
      }
    } catch (e) {
      notice(e.message);
    }
  }
  vHead.refresh = () => refreshCounts();
  globalThis.addEventListener?.("hashchange", () => {
    if (typeof yxDisposeEditors === "function") yxDisposeEditors();
    const hash = globalThis.location?.hash?.slice(1) || "today";
    if (/^[A-Za-z0-9-]+$/.test(hash)) void render(hash);
  });
  void render(
    routes[globalThis.location?.hash?.slice(1)] ||
      globalThis.ChannelRebuild?.parseStudentHash(
        globalThis.location?.hash?.slice(1) || "",
      )
      ? location.hash.slice(1)
      : "today",
  );
  void refreshCounts();
}

async function searchLeadDetail(c, id) {
  const { record } = await api("tools/leads/" + id);
  const view = UI.drawer({
    title: "线索详情",
    subtitle: record.name,
    primary:
      enabled("leads", "update") && !record.student_id
        ? {
            label: "编辑",
            onSelect: async () => {
              await view.close();
              await leadForm(c, record);
            },
          }
        : undefined,
  });
  for (const [label, key] of [
    ["姓名", "name"],
    ["年级", "grade"],
    ["来源", "source"],
    ["专业方向", "direction"],
    ["阶段", "stage"],
    ["下次跟进", "next_followup"],
    ["试听时间", "trial_at"],
    ["备注", "note"],
  ]) {
    const value = record[key];
    if (value)
      view.body.append(
        el(
          "p",
          label +
            "：" +
            (key === "stage"
              ? me.labels.lead_stages[value]
              : key === "trial_at"
                ? value.slice(0, 16).replace("T", " ")
                : value),
          { class: "preserve-text" },
        ),
      );
  }
}
function pageIdentity(title) {
  const heading = document.querySelector(".header-title");
  if (document.querySelector(".c1-content, .v-content")) return;
  if (heading) heading.textContent = title;
  for (const item of document.querySelectorAll?.(".staff-nav .ui-button") ||
    []) {
    if (item.textContent.trim() === title)
      item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  }
}
async function home(c) {
  pageIdentity("今天");
  c.dataset.page = "home";
  c.replaceChildren(UI.tableSkeleton());
  const data = await api("workbench");
  if (
    me.user.roles.includes("finance") &&
    !me.user.roles.some((r) => ["supervisor", "academic"].includes(r))
  )
    return financialToday(c, data);
  c.replaceChildren();
  c.append(el("p", fmt.day(todayBJ()) + " · 北京时间", { class: "muted" }));
  const metrics = el("div", null, { class: "metrics-grid" });
  for (const [label, value, action] of [
    [
      "今日课程",
      data.lessons?.length,
      enabled("schedule") ? () => schedulePage(c) : null,
    ],
    [
      "待确认提交",
      data.pending,
      enabled("attendance", "confirm") ? () => submissionQueue(c) : null,
    ],
    [
      "课时不足 / 续费预警",
      data.renewals?.length,
      enabled("packages") ? () => renewalsPage(c) : null,
    ],
    [
      "本月实收学费",
      !enabled("tuition") || data.tuition_amount === undefined
        ? undefined
        : UI.formatMoney(data.tuition_amount),
      null,
    ],
  ]) {
    if (value === undefined) continue;
    const metric = card(label);
    metric.append(el("strong", String(value), { class: "metric-value" }));
    if (action) metric.append(button("查看详情", action, "link"));
    metrics.append(metric);
  }
  const month = el("p", "本月课次：" + (data.lesson_count ?? "暂无统计"), {
    class: "muted home-month-count",
  });
  metrics.firstElementChild?.append(month);
  c.append(metrics);
  const grid = el("div", null, { class: "workbench-grid" }),
    today = card("今日课程"),
    side = el("div", null, { class: "home-side" });
  if (enabled("schedule"))
    today.append(
      button("打开周课表", () => schedulePage(c), "link panel-link"),
    );
  for (const row of data.lessons || []) {
    const line = el("div", null, { class: "home-lesson" }),
      copy = el("div");
    copy.append(
      el("strong", row.course_name),
      el("small", row.teacher_name + " · " + (row.location_name || "线上课"), {
        class: "muted",
      }),
    );
    line.append(
      el("time", row.start_at.slice(11, 16)),
      copy,
      UI.badge(
        cnLesson(row.status),
        row.status === "completed"
          ? "success"
          : row.status === "planned"
            ? "info"
            : "neutral",
      ),
    );
    line.append(button("查看", () => lessonDetail(c, row), "link"));
    today.append(line);
  }
  if (!data.lessons?.length)
    today.append(
      UI.emptyState("今天暂无课程", "可从周课表查看其他日期的安排。", {
        action: enabled("schedule")
          ? button("打开课表", () => schedulePage(c))
          : undefined,
      }),
    );
  if (data.renewals) {
    const p = card("续费预警");
    for (const row of data.renewals.slice(0, 5)) {
      const line = el("div", null, { class: "home-renewal" });
      line.append(
        el("strong", row.student_name),
        el("small", row.course_name, { class: "muted" }),
        UI.badge("剩 " + row.balance + " 课时", "warning"),
      );
      p.append(line);
    }
    if (!data.renewals.length)
      p.append(el("p", "暂无续费预警", { class: "muted" }));
    if (enabled("packages"))
      p.append(button("查看全部预警", () => renewalsPage(c), "link"));
    side.append(p);
  }
  const tasks = card("待处理事项");
  if (data.pending !== undefined && enabled("attendance", "confirm"))
    tasks.append(
      button("教师提交待确认", () => submissionQueue(c), "task-line"),
    );
  if (data.overdue !== undefined && enabled("attendance", "confirm"))
    tasks.append(
      button(
        "已过窗口仍未提交",
        () => submissionQueue(c, "overdue"),
        "task-line",
      ),
    );
  const taskButtons = tasks.querySelectorAll("button");
  for (const control of taskButtons) {
    const value = control.textContent.includes("已过窗口")
      ? data.overdue
      : data.pending;
    control
      .querySelector(".ui-button-face")
      .append(el("strong", String(value), { class: "task-count" }));
  }
  for (const task of data.tasks || [])
    tasks.append(
      el(
        "p",
        task.due_date +
          " · " +
          (task.student_name || "未关联学员") +
          " · " +
          task.title +
          " · " +
          (task.assignee_name || "待指派"),
        { class: "task-line" },
      ),
    );
  side.append(tasks);
  grid.append(today, side);
  c.append(grid);
  if (enabled("promo")) {
    const promos = await api("promo");
    const latest = promos.items[0];
    if (latest) {
      const news = button(
        "合作资讯" + (latest.is_read ? "" : " · 新") + " · " + latest.title,
        () => promoDetail(c, latest.id),
        "promo-banner",
      );
      c.append(news);
      const nav = [...document.querySelectorAll(".staff-nav button")].find(
        (x) => x.textContent.startsWith("推广中心"),
      );
      if (nav)
        nav.setAttribute(
          "data-unread",
          String(promos.items.some((x) => !x.is_read)),
        );
    }
  }
}
function drawer(title) {
  let dirty = false;
  const view = UI.drawer({ title, isDirty: () => dirty });
  view.element.classList.add("business-drawer");
  view.body.addEventListener("input", () => {
    dirty = true;
  });
  view.body.addEventListener("change", () => {
    dirty = true;
  });
  return {
    panel: view.body,
    close: () => {
      dirty = false;
      return view.close();
    },
  };
}
function showSecret(data) {
  const { panel } = drawer("初始密码 · 仅显示一次");
  panel.append(
    el("p", "请通过可信渠道交给账号使用人，首次登录必须修改。"),
    el("code", data.temporary_password, { class: "secret" }),
    button("复制密码", async () => {
      try {
        await navigator.clipboard.writeText(data.temporary_password);
        notice("已复制", "success");
      } catch {
        notice("请手动选中密码复制");
      }
    }),
  );
}
async function accounts(c, offset = 0) {
  c.replaceChildren(el("h1", "账号与权限"));
  const { items } = await api("accounts?offset=" + offset),
    tools = el("div", null, { class: "row" });
  tools.append(
    el(
      "p",
      `员工账号上限 ${me.limits.staff} · 学员账号上限 ${me.limits.student}`,
      { class: "muted" },
    ),
    button("＋ 新增账号", () => newAccount(c), "primary"),
  );
  c.append(tools);
  const table = el("table"),
    head = el("tr");
  for (const h of ["姓名", "手机号", "角色", "状态", "操作"])
    head.append(el("th", h));
  table.append(head);
  for (const u of items) {
    const row = el("tr"),
      actions = el("td");
    for (const v of [
      u.name,
      u.phone,
      u.roles
        .map(
          (role) =>
            ({
              supervisor: "主管",
              academic: "教务",
              finance: "财务",
              teacher: "教师",
              student: "学员",
            })[role],
        )
        .join("、"),
      u.active === false ? "停用" : u.must_change ? "待修改密码" : "启用",
    ])
      row.append(el("td", v));
    if (!u.roles.includes("supervisor")) {
      actions.append(
        button("编辑", () => editAccount(c, u)),
        button("重置密码", async () => {
          if (!(await ask("重置后此账号所有设备会下线，继续吗？"))) return;
          try {
            showSecret(
              await api("accounts/" + u.id + "/reset-password", "POST", {}),
            );
          } catch (e) {
            notice(e.message);
          }
        }),
      );
    }
    actions.append(
      button("登录设备", () => devices(u.id)),
      button("查看号码", async () => {
        try {
          const result = await api("accounts/" + u.id + "/phone", "POST", {});
          notice(result.phone + "（已记录查看操作）");
        } catch (e) {
          notice(e.message);
        }
      }),
    );
    row.append(actions);
    table.append(row);
  }
  c.append(el("div", null, { class: "table-wrap" }));
  c.lastChild.append(table);
  const pager = el("div", null, { class: "row" });
  if (offset)
    pager.append(
      button("上一页", () => accounts(c, Math.max(0, offset - 200))),
    );
  if (items.length === 200)
    pager.append(button("下一页", () => accounts(c, offset + 200)));
  c.append(pager);
  const controls = el("section", null, { class: "panel" });
  controls.append(el("h2", "教师与学员端开关"));
  for (const [key, label] of [
    ["student_view_payments", "学员可查看缴费记录"],
    ["student_view_balance", "学员可查看课时余额"],
    ["teacher_self_checkin", "教师可自助提交出勤"],
    ["academic_can_create_accounts", "教务可开教师与学员账号"],
    ["academic_can_reset_accounts", "教务可重置教师与学员账号密码"],
  ]) {
    const checked = [
      "academic_can_create_accounts",
      "academic_can_reset_accounts",
    ].includes(key)
      ? me.policy.settings[key] !== false
      : !!me.policy.settings[key];
    const control = UI.switch({
      label,
      checked,
      onCommit: async (value) => {
        await api("settings", "PUT", { key, value });
        me.policy.settings[key] = value;
      },
    });
    controls.append(control.element);
  }
  c.append(controls);
  const form = el("form", null, { class: "panel" });
  form.append(
    el("h2", "调整教务／财务权限"),
    el("p", "权限变更会使本机构所有在线账号重新登录。", { class: "muted" }),
  );
  const select = (label, name, options) => {
    const wrap = el("label", label, { class: "field" }),
      s = el("select", null, { name });
    s.required = true;
    for (const [value, text] of options)
      s.append(el("option", text, { value }));
    wrap.append(s);
    form.append(wrap);
  };
  select("角色", "role", [
    ["academic", "教务"],
    ["finance", "财务"],
  ]);
  select("模块", "module", [
    ["settings", "基础设置（教师／教室）"],
    ["packages", "课时包"],
    ["tuition", "学费收款"],
    ["teacher_pay", "教师课酬"],
    ["settlements", "月度结算与成本"],
    ["reports", "统计报表"],
    ["exports", "导出"],

    ["logs", "操作记录"],
  ]);
  select("操作", "action", [
    ["read", "查看"],
    ["create", "新增"],
    ["update", "修改"],
    ["delete", "删除"],
    ["export", "导出"],
    ["adjust", "手工课时调整（课时包模块）"],
    ["transfer", "课时转换（课时包模块）"],
  ]);
  select("授权", "allowed", [
    ["true", "允许"],
    ["false", "禁止"],
  ]);
  submit(form, "保存权限", async (data) => {
    if (!(await ask("修改权限将使所有在线会话失效，继续吗？"))) return;
    await api("rights", "PUT", { ...data, allowed: data.allowed === "true" });
    location.assign(base + "login");
  });
  c.append(form);
}
// 艺界星途：员工角色可以组合（顾问 / 教务 / 财务），至少选一个；教师、学员、家长账号不在这里建。
const STAFF_ROLES = [
  ["consultant", "顾问", "招生、方案、内容"],
  ["academic", "教务", "排课、学员、反馈"],
  ["finance", "财务", "收款、课酬、报表"],
];
function staffRoleField(form, selected = []) {
  const box = el("fieldset", null, { class: "field yx-roles" });
  box.append(el("legend", "角色（可多选）"));
  for (const [value, label, hint] of STAFF_ROLES) {
    const line = el("label", null, { class: "yx-role" }),
      input = el("input", null, { type: "checkbox", name: "role_" + value, value: "1" });
    input.checked = selected.includes(value);
    line.append(input, el("span", label), el("small", hint));
    box.append(line);
  }
  form.append(box);
  return () => STAFF_ROLES.map(([v]) => v).filter((v) => form.elements["role_" + v]?.checked);
}
function newAccount(c) {
  const { panel, close } = drawer("新增员工账号"),
    form = el("form");
  field(form, "姓名", "name");
  field(form, "手机号", "phone", "tel");
  const picked = staffRoleField(form, ["academic"]);
  form.append(
    el("p", "顾问、教务、财务都计入管理账号数量，一人多角色只算一个。教师、学员和家长账号请从对应档案里开通。", { class: "muted" }),
  );
  submit(form, "创建账号", async (d) => {
    const roles = picked();
    if (!roles.length) throw Error("请至少选择一个角色");
    const result = await api("accounts", "POST", { name: d.name, phone: d.phone, roles });
    close();
    await accounts(c);
    showSecret(result);
  });
  panel.append(form);
}
function editAccount(c, u) {
  const { panel, close } = drawer("编辑账号"),
    form = el("form");
  field(form, "姓名", "name", "text", u.name);
  const active = field(form, "启用账号", "active", "checkbox", "1", false);
  active.checked = u.active !== false;
  const personal = u.roles.some((x) => ["teacher", "student", "parent"].includes(x));
  let picked = () => u.roles;
  if (personal)
    form.append(
      el("p", "角色：" + ({ teacher: "教师", student: "学员", parent: "家长" }[u.roles[0]] || u.roles[0]) + "（个人账号不能改成员工角色）", { class: "muted" }),
    );
  else picked = staffRoleField(form, u.roles);
  submit(form, "保存并使该账号下线", async (d) => {
    const roles = picked();
    if (!roles.length) throw Error("请至少选择一个角色");
    await api("accounts/" + u.id, "PATCH", {
      name: d.name,
      roles,
      active: active.checked,
      version: u.version,
    });
    close();
    await accounts(c);
  });
  panel.append(form);
}
async function devices(user) {
  try {
    const { items } = await api(
        user ? "accounts/" + user + "/sessions" : "sessions",
      ),
      { panel } = drawer("登录设备");
    for (const item of items) {
      const row = el("div", null, { class: "panel" });
      row.append(
        el("p", item.ua),
        el(
          "p",
          item.ip +
            " · " +
            new Date(item.last_seen_at).toLocaleString("zh-CN", {
              timeZone: "Asia/Shanghai",
              hour12: false,
            }),
        ),
        button("强制下线", async () => {
          try {
            await api(
              (user ? "accounts/" + user + "/sessions/" : "sessions/") +
                item.id,
              "DELETE",
              {},
            );
            row.remove();
          } catch (e) {
            notice(e.message);
          }
        }),
      );
      panel.append(row);
    }
    if (!items.length) panel.append(el("p", "暂无在线设备"));
  } catch (e) {
    notice(e.message);
  }
}
async function logs(c) {
  c.replaceChildren(el("h1", "操作与登录记录"));
  c.append(
    button("操作记录", () => load("audit")),
    button("登录记录", () => load("login")),
  );
  const list = el("section", null, { class: "panel" });
  c.append(list);
  async function load(kind, offset = 0) {
    try {
      const { items } = await api("logs?kind=" + kind + "&offset=" + offset);
      list.replaceChildren();
      for (const item of items)
        list.append(
          el(
            "p",
            new Date(item.at).toLocaleString("zh-CN", {
              timeZone: "Asia/Shanghai",
              hour12: false,
            }) +
              " · " +
              (item.actor_label || item.phone_last4 || "") +
              " · " +
              (item.summary || me.labels.events[item.event] || "账号操作"),
          ),
        );
      if (!items.length) list.append(el("p", "暂无记录"));
      if (offset)
        list.append(
          button("上一页", () => load(kind, Math.max(0, offset - 200))),
        );
      if (items.length === 200)
        list.append(button("下一页", () => load(kind, offset + 200)));
    } catch (e) {
      notice(e.message);
    }
  }
  await load("audit");
}
function profile(c) {
  c.replaceChildren(el("h1", "个人中心"));
  changePassword(c);
  c.append(
    button("我的登录设备", () => devices()),
    button("系统消息", () => systemMessages(c)),
  );
}
// 主题色不单独请求一份样式表（它会挡住页面脚本启动）；品牌数据到手后直接设置。
let themeSheet = null;
function applyTheme(color) {
  if (!/^#[0-9a-f]{6}$/i.test(color || "") || !globalThis.CSSStyleSheet?.prototype?.replaceSync) return;
  if (!themeSheet) {
    themeSheet = new CSSStyleSheet();
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, themeSheet];
  }
  themeSheet.replaceSync(":root{--theme:" + color + "}");
}
(async () => {
  try {
    // 品牌和“我是谁”互不依赖，同时发出，少等一次往返。
    // 艺界星途：课程方案公开分享页 /s/{token} 复用本脚本，只渲染方案，不请求登录信息、不进入 CRM 外壳。
    if (/^\/s\/[^/]+$/.test(location.pathname) && typeof yxSharePage === "function") return yxSharePage();
    const isLogin = location.pathname.endsWith("/login");
    const rootBase = typeof yxIsRoot === "function" && yxIsRoot();
    const meRequest = isLogin ? null : api("me");
    meRequest?.catch(() => {});
    // 轻量品牌：不含登录背景大图（背景改为单独的图片地址，可长期缓存）；Logo 也是图片地址。
    // 艺界星途：根地址（管理者入口）没有机构路径，登录页用平台品牌，登录后再按 me 的机构代号取机构品牌；不做本机缓存。
    const brandRequest = rootBase ? Promise.resolve(yxPlatformBrand()) : api("public/brand?lite=1");
    // 登录后不必等品牌数据（里面有一张约 100KB 的登录背景图）：用这台设备上次记下的机构名称、Logo、主题色先进系统，
    // 后台再取最新的并记下来。按机构地址分开记，不会串到别的机构；登录背景图不记。第一次在这台设备上打开时照旧等待。
    const brandKey = "fq_brand:" + base;
    let saved = null;
    if (!isLogin && !rootBase)
      try {
        saved = JSON.parse(localStorage.getItem(brandKey) || "null");
      } catch {
        saved = null;
      }
    const remember = (b) => {
      try {
        const { login_bg, ...rest } = b || {};
        localStorage.setItem(brandKey, JSON.stringify(rest));
      } catch {
        // 存不下或浏览器禁止存储时忽略，下次照旧等待。
      }
    };
    if (saved?.display_name) {
      brand = saved;
      void brandRequest.then((fresh) => {
        remember(fresh);
        if (fresh?.theme_color !== saved.theme_color) applyTheme(fresh.theme_color);
        Object.assign(brand, fresh);
      }, () => {});
    } else {
      brand = await brandRequest;
      if (!isLogin && !rootBase) remember(brand);
    }
    applyTheme(brand?.theme_color);
    if (isLogin) await login();
    else {
      me = await meRequest;
      if (rootBase && me.tenant_slug) {
        brand = await yxTenantBrand(me.tenant_slug);
        yxApplyTheme(brand.theme_color);
      }
      if (me.user.roles.includes("parent") && typeof yxParentShell === "function") return yxParentShell();
      scheduleView = me.policy.settings.default_schedule_view || "calendar";
      shell();
    }
  } catch (e) {
    if (e.code !== "tenant_expired") root.replaceChildren(el("p", e.message, { class: "loading" }));
  }
})();

// 第二阶段页面只负责收集输入和显示，归属、权限、冲突与写入均由服务器执行。
const businessLabels = {
  students: "学员档案",
  teachers: "教师档案",
  course_categories: "课程大类",
  course_types: "细分课程",
  locations: "教室与地点",
  student_schedule_blocks: "不可排时段",
  schedule_templates: "固定课",
  schedule_enrollments: "固定课报名",
};
async function choices(resource, query = "") {
  const result = [];
  for (let offset = 0; offset <= 2000; offset += 200) {
    const page = await api(
      "data/" +
        resource +
        "?offset=" +
        offset +
        "&q=" +
        encodeURIComponent(query),
    );
    result.push(...page.items);
    if (page.next_offset === null) break;
  }
  return result;
}
function selectField(form, label, name, options, value) {
  const s = el("select", null, {
    name,
    class: "ui-native-select",
    "aria-hidden": "true",
    tabindex: "-1",
    "aria-label": label,
  });
  s.required = true;
  s.append(el("option", "请选择", { value: "" }));
  for (const item of options)
    s.append(
      el("option", item.name ?? item.label ?? item.id, { value: item.id }),
    );
  s.value = value ?? "";
  const picker = UI.selectControl({
    label,
    value: String(s.value),
    options: [
      { value: "", label: "请选择" },
      ...options.map((item) => ({
        value: String(item.id),
        label: String(item.name ?? item.label ?? item.id),
      })),
    ],
    onChange: (next) => {
      s.value = next;
      s.dispatchEvent(new Event("change", { bubbles: true }));
    },
  });
  picker.element.classList.add("field");
  const descriptor = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(s),
    "value",
  );
  if (descriptor?.set)
    Object.defineProperty(s, "value", {
      get() {
        return descriptor.get.call(this);
      },
      set(next) {
        descriptor.set.call(this, next);
        picker.setValue(descriptor.get.call(this));
      },
    });
  s.addEventListener("invalid", (event) => {
    event.preventDefault();
    picker.trigger.focus();
    let feedback = picker.element.querySelector(".ui-field-error");
    if (!feedback) {
      feedback = el("p", null, { class: "ui-field-error", role: "alert" });
      picker.element.append(feedback);
    }
    feedback.textContent = "请选择" + label;
  });
  s.addEventListener("change", () =>
    picker.element.querySelector(".ui-field-error")?.remove(),
  );
  picker.element.append(s);
  form.append(picker.element);
  return s;
}
function enabled(module, action = "read") {
  // 合作升学推荐由平台开关控制：关闭时所有入口隐藏（后端同样返回 403）。
  if (module === "referrals" && me.features?.referrals === false) return false;
  return !!me.capabilities[module]?.[action];
}
async function recordsPage(c, resource, offset = 0, query = "") {
  if (resource === "students") return studentsPage(c, offset, query);
  c.replaceChildren(el("h1", businessLabels[resource]));
  const module =
    resource === "students"
      ? "students"
      : ["schedule_templates", "schedule_enrollments"].includes(resource)
        ? "templates"
        : resource === "student_schedule_blocks"
          ? "students"
          : "settings";
  if (enabled(module, "create"))
    c.append(button("＋ 新增", () => recordForm(c, resource), "primary"));
  if (
    [
      "students",
      "teachers",
      "course_categories",
      "course_types",
      "locations",
    ].includes(resource)
  ) {
    const search = el("form", null, { class: "row" }),
      input = field(search, "按名称搜索", "q", "search", query, false);
    submit(search, "搜索", async (d) => recordsPage(c, resource, 0, d.q));
    c.append(search);
  }
  const { items, next_offset } = await api(
      "data/" +
        resource +
        "?offset=" +
        offset +
        "&q=" +
        encodeURIComponent(query),
    ),
    table = el("table"),
    head = el("tr");
  for (const x of ["名称 / 关联", "状态 / 时间", "操作"])
    head.append(el("th", x));
  table.append(head);
  let draggedId = null;
  for (const row of items) {
    const tr = el("tr"),
      ops = el("td");
    if (
      [
        "students",
        "teachers",
        "course_categories",
        "course_types",
        "locations",
      ].includes(resource) &&
      enabled(module, "update")
    ) {
      tr.draggable = true;
      tr.addEventListener("dragstart", () => {
        draggedId = row.id;
      });
      tr.addEventListener("dragover", (e) => e.preventDefault());
      tr.addEventListener("drop", async (e) => {
        e.preventDefault();
        try {
          const ordered = [...items],
            from = ordered.findIndex((x) => x.id === draggedId),
            to = ordered.findIndex((x) => x.id === row.id);
          if (from < 0 || from === to) return;
          const [moved] = ordered.splice(from, 1);
          ordered.splice(to, 0, moved);
          await api("reorder", "PUT", {
            resource,
            offset,
            records: ordered.map((x) => ({ id: x.id, version: x.version })),
          });
          await recordsPage(c, resource, offset);
        } catch (e) {
          notice(e.message);
        }
      });
    }
    tr.append(
      el(
        "td",
        row.name ||
          (row.student_name
            ? row.student_name + " · " + (row.course_name || row.label || "")
            : row.course_name
              ? row.course_name + " · " + row.teacher_name
              : "未命名记录"),
      ),
      el(
        "td",
        row.status
          ? UI.personStatus(row, resource)
          : row.start_time
            ? `周${["一", "二", "三", "四", "五", "六", "日"][row.weekday]} ${row.start_time} · ${row.date_from || ""} ${row.date_to || ""}`
            : row.date_from
              ? `${row.date_from} 至 ${row.date_to}`
              : row.active === 0
                ? "停用"
                : "启用",
      ),
    );
    ops.append(button("详情", () => recordDetails(c, resource, row)));
    if (enabled(module, "update"))
      ops.append(button("编辑", () => recordForm(c, resource, row)));
    if (enabled(module, "delete"))
      ops.append(
        button("删除", async () => {
          if (
            !(await ask(
              "确认删除这条记录？已有引用时服务器会拒绝，请改用归档或停用。",
            ))
          )
            return;
          await api("data/" + resource + "/" + row.id, "DELETE", {
            version: row.version,
          });
          await recordsPage(c, resource, offset);
        }),
      );
    tr.append(ops);
    table.append(tr);
  }
  const wrap = el("div", null, { class: "table-wrap" });
  wrap.append(table);
  c.append(wrap);
  if (!items.length)
    c.append(el("p", "暂无记录，请先新增。", { class: "muted" }));
  if (offset)
    c.append(
      button("上一页", () =>
        recordsPage(c, resource, Math.max(0, offset - 200), query),
      ),
    );
  if (next_offset !== null)
    c.append(
      button("下一页", () => recordsPage(c, resource, next_offset, query)),
    );
}
async function recordDetails(c, resource, row) {
  const detail = (await api("data/" + resource + "/" + row.id)).record,
    { panel } = drawer(businessLabels[resource] + "详情");
  for (const [label, key] of [
    ["姓名", "name"],
    ["年级", "grade"],
    ["学校", "school"],
    ["专业方向", "direction"],
    ["备注", "notes"],
    ["状态", "status"],
  ])
    if (detail[key])
      panel.append(
        el(
          "p",
          label +
            "：" +
            (key === "status"
              ? UI.personStatus(detail, resource)
              : detail[key]),
        ),
      );
  if (!["students", "teachers"].includes(resource)) {
    if (row.course_name) panel.append(el("h2", row.course_name));
    if (row.student_name) panel.append(el("p", "学员：" + row.student_name));
    if (row.teacher_name) panel.append(el("p", "教师：" + row.teacher_name));
    for (const [label, key] of [
      ["每周星期", "weekday"],
      ["开始时间", "start_time"],
      ["结束时间", "end_time"],
      ["生效开始", "date_from"],
      ["生效结束", "date_to"],
      ["分钟", "duration"],
      ["课时数", "units"],
      ["说明", "label"],
    ])
      if (detail[key] !== undefined)
        panel.append(
          el(
            "p",
            label +
              "：" +
              (key === "weekday"
                ? ["周一", "周二", "周三", "周四", "周五", "周六", "周日"][
                    detail[key]
                  ]
                : detail[key]),
          ),
        );
  }
  if (["students", "teachers"].includes(resource)) {
    const role = resource === "students" ? "student" : "teacher";
    panel.append(
      el(
        "p",
        detail.account_id
          ? "账号已关联" + (detail.account_active ? " · 启用" : " · 停用")
          : "尚未开通账号",
        { class: "muted" },
      ),
    );
    if (me.user.roles.includes("supervisor") && enabled("accounts")) {
      if (detail.account_id) panel.append(activationButton(detail));
      panel.append(
        button("查看完整联系方式", async () => {
          const result = await api(
            "data/" + resource + "/" + detail.id + "/contact",
            "POST",
            {},
          );
          notice(
            "联系电话：" + (result.phone || "未填写") + "（已记录查看操作）",
          );
        }),
      );
    }
    if (
      !detail.account_id &&
      (me.user.roles.includes("supervisor") ||
        (me.user.roles.includes("academic") &&
          me.policy.settings.academic_can_create_accounts !== false))
    )
      panel.append(
        button("开通" + (role === "student" ? "学员" : "教师") + "账号", () =>
          personalAccount(resource, detail),
        ),
      );
    if (
      detail.account_id &&
      (me.user.roles.includes("supervisor") ||
        (me.user.roles.includes("academic") &&
          me.policy.settings.academic_can_reset_accounts !== false))
    )
      panel.append(
        button("重置个人账号密码", async () => {
          if (!(await ask("将使该账号所有设备下线，继续吗？"))) return;
          showSecret(
            await api(
              "accounts/" + detail.account_id + "/reset-password",
              "POST",
              {},
            ),
          );
        }),
      );
    if (resource === "students") {
      panel.append(
        button("不可排时段", async () => {
          const blocks = await choices("student_schedule_blocks");
          const section = el("section");
          section.append(el("h2", "不可排时段"));
          for (const b of blocks.filter((x) => x.student_id === row.id))
            section.append(
              el(
                "p",
                `周${["一", "二", "三", "四", "五", "六", "日"][b.weekday]} ${b.start_time}–${b.end_time} ${b.label}`,
              ),
            );
          section.append(
            button("＋ 新增时段", () =>
              recordForm(c, "student_schedule_blocks", { student_id: row.id }),
            ),
          );
          panel.append(section);
        }),
      );
    }
  }
}
function personalAccount(resource, row) {
  const { panel, close } = drawer("开通个人账号"),
    form = el("form");
  form.append(el("p", "关联档案：" + row.name, { class: "muted" }));
  field(form, "手机号", "phone", "tel");
  submit(form, "生成初始密码", async (d) => {
    const role = resource === "students" ? "student" : "teacher";
    const result = await api("accounts", "POST", {
      name: row.name,
      phone: d.phone,
      roles: [role],
      [role + "_id"]: row.id,
    });
    close();
    showSecret(result);
  });
  panel.append(form);
}
async function recordForm(c, resource, row = {}) {
  const { panel, close } = drawer(
      (row.id ? "编辑" : "新增") + businessLabels[resource],
    ),
    form = el("form");
  const text = (label, key, type = "text", fallback = "") =>
    field(form, label, key, type, row[key] ?? fallback);
  const select = (label, key, options) =>
    selectField(form, label, key, options, row[key]);
  // 颜色用色块点选，不出现颜色代码。
  const colorField = (label, key, options) => {
    const s = select(label, key, options);
    const holder = s.closest(".ui-field");
    holder.classList.add("v-color-field");
    const row2 = el("div", null, { class: "v-swatches", role: "radiogroup", "aria-label": label });
    const sync = () => {
      for (const b of row2.children) b.setAttribute("aria-checked", String(b.dataset.value === s.value));
    };
    options.forEach((o, i) => {
      const b = el("button", null, {
        type: "button",
        class: "v-swatch v-swatch-" + (i + 1),
        role: "radio",
        "aria-label": "颜色 " + (i + 1),
        "data-value": o.id,
      });
      b.addEventListener("click", () => {
        s.value = o.id;
        s.dispatchEvent(new Event("change", { bubbles: true }));
        sync();
      });
      row2.append(b);
    });
    holder.querySelector(".ui-picker-trigger").hidden = true;
    holder.append(row2);
    void Promise.resolve().then(sync);
    return s;
  };
  if (
    [
      "students",
      "teachers",
      "course_categories",
      "course_types",
      "locations",
    ].includes(resource)
  )
    text(
      {
        students: "姓名",
        teachers: "姓名",
        course_categories: "大类名称",
        course_types: "课程名称",
        locations: "教室名称",
      }[resource],
      "name",
    );
  // 号码只在修改时才有“不改就留空”的说明；新建时不出现。
  const keepHint = (input) => {
    if (row.id)
      input.closest(".ui-field")?.append(
        el("p", "已有号码不显示；不改就留空", { class: "ui-field-hint" }),
      );
    return input;
  };
  if (["students", "teachers"].includes(resource)) {
    keepHint(text(resource === "students" ? "学员手机" : "手机号", "phone", "tel")).required = false;
    select("状态", "status", [
      { id: "active", name: UI.personStatus({ status: "active" }, resource) },
      { id: "paused", name: UI.personStatus({ status: "paused" }, resource) },
      {
        id: "archived",
        name: resource === "teachers" ? "离职（归档）" : "归档",
      },
    ]).value = row.status || "active";
    if (resource === "students") {
      for (const [label, key] of [
        ["学校", "school"],
        ["年级", "grade"],
        ["专业方向", "direction"],
        ["家长称呼", "parent_name"],
      ])
        text(label, key).required = false;
      keepHint(text("家长手机", "parent_phone", "tel")).required = false;
      text("备注", "notes", "textarea").required = false;
      // 艺界星途新增：AI 写反馈、报告时对孩子的称呼；家长是否同意展示照片和全名。
      const nick = text("AI 称呼（如“周同学”，不填按姓自动生成）", "nickname");
      nick.required = false;
      if (!row.nickname || row.nickname === "X 同学") nick.value = "";
      nick.placeholder = (typeof yxNickname === "function" && yxNickname(row.name)) || "例如：周同学";
      nick.maxLength = 20;
      const consent = text("家长同意在成长报告、宣传中展示孩子照片和全名", "parent_consent_media", "checkbox", "1");
      consent.required = false;
      consent.checked = !!row.parent_consent_media;
    } else {
      select("聘用类型", "employment", [
        { id: "full_time", name: "全职" },
        { id: "part_time", name: "兼职" },
      ]).value = row.employment || "part_time";
      // B7：关掉后，这位老师的课不出现在发给家长的对外课表图里；普通课表不受影响。
      const shown = text("对外课表图显示这位老师的课", "show_in_timetable", "checkbox", "1");
      shown.required = false;
      shown.checked = row.show_in_timetable !== 0;
    }
  }
  if (
    [
      "course_categories",
      "course_types",
      "locations",
      "schedule_templates",
      "student_schedule_blocks",
    ].includes(resource)
  ) {
    const active = text("启用", "active", "checkbox", "1");
    active.required = false;
    active.checked = row.active !== 0;
  }
  if (
    [
      "students",
      "teachers",
      "course_categories",
      "course_types",
      "locations",
    ].includes(resource)
  )
    text("排序", "sort_order", "number", 0);
  if (resource === "course_categories")
    colorField(
      "课程颜色",
      "color",
      [
        "#8B7BB5",
        "#5B8DB8",
        "#62A598",
        "#C99A54",
        "#B7768C",
        "#7B93AB",
        "#A48B69",
        "#8C9D62",
      ].map((id) => ({ id, name: id })),
    ).value = row.color || "#8B7BB5";
  if (resource === "students")
    select("收费模式", "billing_mode", [
      { id: "package", name: "课时包扣课" },
      { id: "overall", name: "整体收费（只记出勤课时）" },
    ]).value = row.billing_mode || "package";
  if (resource === "teachers")
    field(
      form,
      "教授科目（多个用逗号分开）",
      "subjects",
      "text",
      JSON.parse(row.subjects || "[]").join("，"),
      false,
    );
  if (resource === "course_types") {
    select("所属大类", "category_id", await choices("course_categories"));
    select("形式", "format", [
      { id: "individual", name: "一对一" },
      { id: "group", name: "小组课" },
      { id: "class", name: "班课" },
    ]).value = row.format || "individual";
    select(
      "默认分钟",
      "default_minutes",
      [30, 45, 60].map((id) => ({ id, name: String(id) })),
    ).value = row.default_minutes || 45;
    const lessonUnits = text("每节课时", "units_per_lesson", "number", 1);
    lessonUnits.min = "1";
    lessonUnits.step = "0.01";
    text("人数上限", "capacity", "number", 1);
  }
  if (resource === "locations") {
    text("校区 / 地点备注", "campus").required = false;
    text("容量", "capacity", "number", 1);
    const offsite = text("校外地点", "offsite", "checkbox", "1");
    offsite.required = false;
    offsite.checked = !!row.offsite;
  }
  if (
    [
      "schedule_templates",
      "schedule_enrollments",
      "student_schedule_blocks",
    ].includes(resource)
  ) {
    if (resource !== "schedule_templates")
      select("学员", "student_id", await choices("students"));
    if (resource === "schedule_enrollments")
      select(
        "固定模板",
        "template_id",
        (await choices("schedule_templates")).map((x) => ({
          ...x,
          name:
            "周" +
            ["一", "二", "三", "四", "五", "六", "日"][x.weekday] +
            " " +
            x.start_time +
            " · " +
            (x.course_name || "") +
            " · " +
            (x.teacher_name || ""),
        })),
      );
    if (resource !== "schedule_enrollments") {
      select(
        "星期",
        "weekday",
        Array.from({ length: 7 }, (_, i) => ({
          id: String(i),
          name: "周" + ["一", "二", "三", "四", "五", "六", "日"][i],
        })),
      );
      text("开始时间", "start_time", "time", "09:00");
    }
    if (resource === "student_schedule_blocks") {
      text("结束时间", "end_time", "time", "10:00");
      text("说明", "label").required = false;
    } else {
      const today = new Date().toLocaleDateString("sv-SE", {
        timeZone: "Asia/Shanghai",
      });
      text("生效开始", "date_from", "date", row.date_from ? row.date_from : today);
      // 结束日期可以不填，不填就是“长期”（服务器按 2099-12-31 保存）。
      field(form, "结束日期（不填 = 长期）", "date_to", "date", row.date_to && row.date_to < "2099-01-01" ? row.date_to : "", false);
    }
  }
  if (resource === "schedule_templates") {
    await courseFields(form, row);
    form.append(
      el(
        "p",
        "保存后在“固定排课”页点这张卡片添加学员；关联班级的固定课自动用班级名单。生成未来课程前会先预览。",
        {
          class: "muted",
        },
      ),
    );
  }
  const saveLabel = "保存" + ({ students: "学员", teachers: "教师" }[resource] || "");
  submit(form, saveLabel, async (d) => {
    for (const key of [
      "sort_order",
      "capacity",
      "default_minutes",
      "units_per_lesson",
      "weekday",
      "duration",
      "units",
    ])
      if (d[key] !== undefined) d[key] = Number(d[key]);
    for (const key of ["active", "offsite"])
      if (form.elements[key]) d[key] = form.elements[key].checked;
    if (resource === "teachers" && form.elements.show_in_timetable)
      d.show_in_timetable = form.elements.show_in_timetable.checked ? 1 : 0;
    if (resource === "teachers")
      d.subjects = String(d.subjects || "")
        .split(/[,，]/)
        .map((x) => x.trim())
        .filter(Boolean);
    for (const key of ["phone", "parent_phone"])
      if (d[key] === "") delete d[key];
    if (resource === "students") {
      d.parent_consent_media = !!form.elements.parent_consent_media?.checked;
      d.nickname = String(d.nickname || "").trim() || (typeof yxNickname === "function" ? yxNickname(d.name) : "");
      if (!d.nickname) delete d.nickname;
    }
    if (["schedule_templates", "schedule_enrollments"].includes(resource) && "date_to" in d && !d.date_to)
      d.date_to = "2099-12-31";
    await api(
      "data/" + resource + (row.id ? "/" + row.id : ""),
      row.id ? "PATCH" : "POST",
      {
        ...d,
        ...(row.class_id ? { class_id: row.class_id } : {}),
        ...(row.id ? { version: row.version } : {}),
      },
    );
    close();
    await recordsPage(c, resource);
  });
  standardForm(form, FORM_LAYOUT[resource], close);
  panel.append(form);
}
// 表单侧边栏统一规范：按内容分组、短字段两列、必填打 *、很少用的收进“高级设置”、
// 保存/取消固定在底部。字段本身、字段名和提交内容都不变，只重新排列。
const FORM_LAYOUT = {
  students: {
    groups: [
      ["基本信息", ["name", "status", "school", "grade", "direction"]],
      ["联系方式", ["parent_name", "parent_phone", "phone"]],
      ["家长端与 AI", ["nickname", "parent_consent_media"]],
      ["收费与备注", ["billing_mode", "notes"]],
    ],
    advanced: ["sort_order"],
  },
  teachers: {
    groups: [
      ["基本信息", ["name", "status", "employment", "phone", "subjects"]],
      ["对外课表图", ["show_in_timetable"]],
    ],
    wide: ["subjects"],
    advanced: ["sort_order"],
  },
  course_categories: { groups: [["", ["name", "active", "color"]]], wide: ["color"], advanced: ["sort_order"] },
  course_types: {
    groups: [["", ["name", "category_id", "format", "default_minutes", "units_per_lesson", "capacity", "active"]]],
    advanced: ["sort_order"],
  },
  locations: { groups: [["", ["name", "campus", "capacity", "offsite", "active"]]], advanced: ["sort_order"] },
  schedule_templates: {
    groups: [
      ["时间", ["weekday", "start_time", "duration"]],
      ["有效期", ["date_from", "date_to"]],
      ["课程", ["course_type_id", "teacher_id", "assistant_id", "location_id", "mode", "units"]],
    ],
  },
  schedule_enrollments: { groups: [["", ["student_id", "template_id", "date_from", "date_to"]]] },
  student_schedule_blocks: { groups: [["", ["student_id", "weekday", "start_time", "end_time", "label", "active"]]] },
};
function standardForm(form, layout = {}, close) {
  form.classList.add("v-std-form");
  const submitButton = form.querySelector(":scope > button[type=submit]");
  const holderOf = (name) => {
    const control = form.elements[name];
    const one = control instanceof RadioNodeList ? control[0] : control;
    return one?.closest?.(".ui-field, .field") || null;
  };
  const used = new Set();
  const groupBox = (title) => {
    const g = el("section", null, { class: "v-fgroup" });
    if (title) g.append(el("h3", title));
    return g;
  };
  const place = (g, name) => {
    const h = holderOf(name);
    if (!h || used.has(h)) return;
    used.add(h);
    const control = form.elements[name];
    if (
      (layout.wide || []).includes(name) ||
      control?.type === "checkbox" ||
      control?.tagName === "TEXTAREA" ||
      h.querySelector(".ui-filter-bar.ui-inner-pick, fieldset")
    )
      h.classList.add("is-wide");
    g.append(h);
  };
  const groups = (layout.groups || [["", []]]).map(([title, names]) => {
    const g = groupBox(title);
    for (const name of names) place(g, name);
    return g;
  });
  const adv = (layout.advanced || []).map(holderOf).filter(Boolean);
  for (const h of adv) used.add(h);
  // 没写进布局的字段和说明文字按原顺序放进最后一组，避免漏掉。
  const last = groups.at(-1);
  for (const child of [...form.children]) {
    if (child === submitButton || used.has(child) || child.classList.contains("v-fgroup")) continue;
    if (child.matches(".ui-field, .field")) {
      used.add(child);
      if (child.querySelector("textarea, input[type=checkbox], .ui-filter-bar.ui-inner-pick, fieldset"))
        child.classList.add("is-wide");
    } else child.classList.add("is-wide");
    last.append(child);
  }
  for (const g of groups) if (g.querySelector(".ui-field, .field, p")) form.append(g);
  if (adv.length) {
    const box = el("details", null, { class: "v-fadv" });
    box.append(el("summary", "高级设置"));
    const inner = el("div", null, { class: "v-fgroup is-flat" });
    inner.append(...adv);
    box.append(inner);
    form.append(box);
  }
  // 必填项在标签后打红色 *。
  for (const control of form.elements)
    if (control.required && control.name) holderOf(control.name)?.classList.add("is-required");
  const foot = el("div", null, { class: "v-form-foot" });
  const note = form.querySelector(".is-required") ? el("span", null, { class: "v-form-foot-note" }) : el("span");
  if (note.className) note.append("带 ", el("b", "*"), " 的必须填写");
  foot.append(note);
  // 取消＝点抽屉右上角的关闭，已填内容时同样会先确认。
  const cancel = UI.button("取消");
  cancel.addEventListener("click", () => {
    const x = form.closest(".ui-overlay")?.querySelector(".ui-sheet-header button");
    if (x) x.click();
    else close?.();
  });
  if (form.closest(".ui-overlay") || close) foot.append(cancel);
  if (submitButton) foot.append(submitButton);
  form.append(foot);
}
async function courseFields(form, row = {}) {
  // 教师、课程、教室三份名单互不依赖，同时去取（命中缓存时一个请求都不发）。
  const [teachers, types, rooms] = await Promise.all([choices("teachers"), choices("course_types"), choices("locations")]);
  selectField(form, "教师", "teacher_id", teachers, row.teacher_id);
  selectField(form, "助教（可不选）", "assistant_id", teachers, row.assistant_id).required = false;
  const course = selectField(
    form,
    "课程",
    "course_type_id",
    types,
    row.course_type_id,
  );
  const location = selectField(form, "教室（线下课必填）", "location_id", rooms, row.location_id);
  const mode = selectField(
    form,
    "上课方式",
    "mode",
    [
      { id: "offline", name: "线下" },
      { id: "online", name: "线上" },
    ],
    row.mode || "offline",
  );
  const syncMode = () => {
    location.disabled = mode.value === "online";
    location.required = mode.value !== "online";
  };
  syncMode();
  mode.addEventListener("change", syncMode);
  course.addEventListener("change", () => {
    const type = types.find((x) => x.id === course.value);
    if (type) {
      form.elements.duration.value = type.default_minutes;
      form.elements.units.value = type.units_per_lesson;
    }
  });
  selectField(
    form,
    "时长（分钟）",
    "duration",
    [30, 45, 60].map((id) => ({ id, name: String(id) })),
    row.duration || 45,
  );
  const units = field(form, "课时数", "units", "number", row.units || 1);
  units.step = "0.01";
  units.min = "1";
  field(form, "备注", "note", "text", row.note || "", false);
}
let scheduleWeek = new Date().toLocaleDateString("sv-SE", {
    timeZone: "Asia/Shanghai",
  }),
  scheduleView = me?.policy?.settings?.default_schedule_view || "calendar";
const moveDate = (date, n) =>
  new Date(Date.parse(date + "T12:00:00Z") + n * 86400000)
    .toISOString()
    .slice(0, 10);
async function schedulePage(c) {
  pageIdentity("周课表");
  c.dataset.page = "schedule";
  return ChannelCalendar.mount({
    container: c,
    UI,
    api,
    choices,
    enabled,
    week: scheduleWeek,
    initialDate: scheduleWeek,
    view: scheduleView,
    today: todayBJ(),
    onNavigate: (date, view) => {
      scheduleWeek = date;
      scheduleView = view;
    },
    onOpen: (row) => lessonDetail(c, row),
    onCreate: (row) => lessonForm(c, row),
    onTemplates: () => templatesPage(c),
    onExport: () => staffTimetable(c),
    onError: notice,
    labels: me.labels.lessons,
  });
}
function courseCard(c, row) {
  const b = button(
    "",
    () => lessonDetail(c, row),
    "course-card color-" +
      [
        "#8B7BB5",
        "#5B8DB8",
        "#62A598",
        "#C99A54",
        "#B7768C",
        "#7B93AB",
        "#A48B69",
        "#8C9D62",
      ].indexOf(row.category_color) +
      " status-" +
      row.status,
  );
  b.append(
    el(
      "strong",
      row.start_at.slice(11, 16) + " " + (row.course_name || "课程"),
    ),
    el(
      "small",
      (row.teacher_name || "") +
        " · " +
        (row.mode === "online" ? "线上课" : row.location_name || ""),
    ),
    el(
      "small",
      row.source_course_id
        ? row.duration + "分钟 · " + partnerLabel(row)
        : row.duration +
            "分钟 · " +
            row.units +
            "课时 · " +
            (me.labels.lessons[row.status] || "未知状态"),
    ),
  );
  b.append(el("small", row.start_at.slice(0, 10)));
  return b;
}
async function lessonDetail(c, row) {
  const data = (await api("data/lessons/" + row.id)).record,
    { panel, close } = drawer("课程详情");
  if (data.source_course_id) {
    panel.append(
      el("h2", "合作课程"),
      el(
        "p",
        data.start_at.slice(0, 16).replace("T", " ") +
          " · " +
          data.duration +
          "分钟",
      ),
      el("p", "合作课次由合作方统一维护，不参与机构销课、扣课和课酬。"),
    );
    return;
  }
  data.participants.sort(
    (a, b) =>
      a.student_name.localeCompare(b.student_name, "zh-CN") ||
      a.id.localeCompare(b.id),
  );
  panel.append(
    el("h2", data.start_at.slice(0, 16).replace("T", " ")),
    el("p", data.duration + "分钟 · " + data.units + "课时"),
  );
  panel.append(
    button("出勤提案与课后点评", async () => {
      const { panel: reviewPanel } = drawer("出勤提案与课后点评");
      const view = el("section");
      reviewPanel.append(view);
      await reviewScreen(view, data.id, () => reviewScreen(view, data.id));
    }),
  );
  const attendanceForm = el("form"),
    op = operation();
  const attendanceDraft = new Map(
    data.participants.map((p) => [p.id, p.attendance]),
  );
  const participantList = UI.dataList({
    label: "课程点名名单",
    items: data.participants.map((p) => ({ ...p, status: p.attendance })),
    searchable: true,
    loadedLabel: "",
    total: data.participants.length,
    columns: [
      { key: "student_name", label: "学员", sortable: true },
      {
        key: "attendance",
        label: "出勤",
        searchValue: (p) => String(attendanceNames[attendanceDraft.get(p.id)]),
        render: (p) => {
          const wrap = el("div", null, { class: "participant-control" });
          if (enabled("attendance", "update")) {
            const control = selectField(
              wrap,
              p.student_name + " · 已扣 " + p.deducted + " 课时",
              p.id,
              Object.entries(attendanceNames).map(([id, name]) => ({
                id,
                name,
              })),
              attendanceDraft.get(p.id),
            );
            control.addEventListener("change", () => {
              attendanceDraft.set(p.id, control.value);
              p.status = control.value;
            });
          } else
            wrap.append(
              el(
                "span",
                attendanceNames[p.attendance] +
                  " · 已扣 " +
                  p.deducted +
                  " 课时",
              ),
            );
          if (enabled("attendance", "create"))
            wrap.append(
              button("为 " + p.student_name + " 安排补课", () =>
                makeupForm(c, data, p),
              ),
            );
          return wrap;
        },
      },
    ],
    filters: Object.entries(attendanceNames).map(([value, label]) => ({
      value,
      label,
    })),
  });
  participantList.element.classList.add("attendance-list");
  attendanceForm.append(participantList.element);
  if (enabled("attendance", "update")) {
    attendanceForm.append(
      el(
        "p",
        "确认后将会：按缺勤规则重新计算课时，追加扣课或回补流水；关联补课同步重新计算。任一学员余额不足时整笔不保存。",
        { class: "impact-note" },
      ),
    );
    submit(attendanceForm, "确认逐人出勤", async () => {
      await creditWrite(
        "lessons/" + data.id + "/attendance",
        {
          lesson_version: data.version,
          participants: data.participants.map((p) => ({
            id: p.id,
            version: p.version,
            attendance: attendanceDraft.get(p.id),
          })),
        },
        "POST",
        op,
      );
      close();
      await schedulePage(c);
    });
    for (const [label, action, status] of [
      ["整班销课", "status", "completed"],
      ["撤销销课", "undo", null],
      ["教师请假", "status", "teacher_leave"],
      ["机构取消", "status", "cancelled"],
    ])
      attendanceForm.append(
        button(label, async () => {
          if (
            !(await ask("确认" + label + "？将按规则重新计算并保留审计流水。"))
          )
            return;
          await creditWrite("lessons/" + data.id + "/" + action, {
            lesson_version: data.version,
            status,
          });
          close();
          await schedulePage(c);
        }),
      );
  }
  panel.append(attendanceForm);
  if (enabled("lessons", "update"))
    panel.append(
      button("编辑 / 调课", () => {
        close();
        lessonForm(c, data);
      }),
    );
  if (enabled("lessons", "delete") && enabled("attendance", "delete"))
    panel.append(
      button("删除课程", async () => {
        if (
          !(await ask(
            "删除课程及参与记录，并回补已扣课时？有补课关联或月份已锁定时无法删除。",
          ))
        )
          return;
        await api("data/lessons/" + data.id, "DELETE", {
          version: data.version,
        });
        close();
        await schedulePage(c);
      }),
    );
}
async function lessonForm(c, row = {}) {
  const { panel, close } = drawer(row.id ? "编辑课程" : "新建课程"),
    form = el("form");
  // 学员名单和教师/课程/教室同时去取；第一次打开时先显示一行提示，不让窗口空着。
  const studentsRequest = choices("students"),
    waiting = el("p", "正在准备表单…", { class: "v-muted v-form-wait" });
  panel.append(waiting);
  field(
    form,
    "北京时间",
    "start_at",
    "datetime-local",
    (row.start_at || scheduleWeek + "T09:00").slice(0, 16),
  );
  let students;
  try {
    [, students] = await Promise.all([courseFields(form, row), studentsRequest]);
  } finally {
    waiting.remove();
  }
  // 学员选择：搜索框 + 已选姓名卡片，可按班级或按课程一键加入（原来是全部学员的长勾选列表）。
  const picker = studentPicker(form, {
    students: students.filter((s) => s.status === "active" || row.participants?.some((p) => p.student_id === s.id)),
    selected: (row.participants || []).map((p) => p.student_id),
    locked: !!row.class_id,
    legend: row.class_id ? "班级固定名单（在班级页调整）" : "学员",
    courseOf: () => form.elements.course_type_id?.value || "",
  });
  form.append(picker.element);
  // 实时冲突预查：时间、时长、老师、助教、教室、学员任何一项变了，半秒内按当天课表重算。
  const live = el("div", null, { class: "v-live-check", "aria-live": "polite" });
  form.append(live);
  const optionText = (name, id) => [...(form.elements[name]?.options || [])].find((o) => o.value === id)?.textContent || "";
  const studentName = new Map(students.map((x) => [x.id, x.name]));
  let liveSeq = 0,
    liveTimer = 0;
  async function liveCheck() {
    const seq = ++liveSeq,
      v = (k) => form.elements[k]?.value || "";
    const start = v("start_at");
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(start) || !v("teacher_id")) {
      live.replaceChildren();
      live.className = "v-live-check";
      return;
    }
    // 已有结果时只把它变淡，算完再换，不让这一块跳来跳去；第一次才显示“正在检查”。
    if (live.childElementCount) live.classList.add("is-stale");
    else {
      live.className = "v-live-check is-wait";
      live.replaceChildren(el("span", "正在按当天课表检查冲突…"));
    }
    let rows;
    try {
      rows = await liveDayRows(start.slice(0, 10));
    } catch {
      if (seq !== liveSeq) return;
      live.className = "v-live-check";
      live.replaceChildren(el("span", "暂时没法预查冲突，保存时系统会再检查。", { class: "v-muted" }));
      return;
    }
    if (seq !== liveSeq) return;
    const hits = liveConflicts(
      {
        from: liveMin(start),
        duration: Number(v("duration")) || 0,
        teacher_id: v("teacher_id"),
        assistant_id: v("assistant_id"),
        location_id: v("location_id"),
        mode: v("mode"),
        student_ids: [...form.querySelectorAll("[name=student_ids]:checked")].map((i) => i.value),
        exclude_id: row.id,
      },
      rows,
      { teacher: (id) => optionText("teacher_id", id) || optionText("assistant_id", id), room: (id) => optionText("location_id", id), student: (id) => studentName.get(id) },
    );
    if (!hits.length) {
      live.className = "v-live-check is-ok";
      live.replaceChildren(el("strong", "没有发现冲突"), el("span", "老师、教室、所选学员这个时段都空着（保存时系统会再确认一次）。"));
      return;
    }
    live.className = "v-live-check is-bad";
    const list = el("ul");
    for (const h of hits) list.append(el("li", h.text));
    live.replaceChildren(el("strong", "发现 " + hits.length + " 处冲突"), list);
  }
  const scheduleLive = () => {
    clearTimeout(liveTimer);
    liveTimer = setTimeout(() => void liveCheck(), 350);
  };
  // Keep validation inside the native modal's top layer so users can see it.
  const conflictNotice = el("p", "", {
    class: "ui-field-error v-conflict-error",
    role: "alert",
    tabindex: "-1",
    hidden: "",
  });
  form.append(conflictNotice);
  // “仍强制保存”只在服务器查出冲突后才出现。
  const force = field(
    form,
    "已知冲突，仍强制保存（写入操作记录）",
    "force",
    "checkbox",
    "1",
    false,
  );
  const forceBox = force.closest(".ui-field, .field, label") || force;
  forceBox.hidden = true;
  forceBox.classList.add("v-force-row");
  const clearConflict = (event) => {
    if (event.target === force) return;
    scheduleLive();
    conflictNotice.hidden = true;
    force.checked = false;
    forceBox.hidden = true;
    delete forceBox.dataset.why;
  };
  form.addEventListener("input", clearConflict);
  form.addEventListener("change", clearConflict);
  form.addEventListener("click", (event) => {
    // Calendar and student cards update hidden inputs without input/change events.
    if (event.target.closest?.(".ui-calendar-day, .v-spick-tile, .v-spick-clear, .v-spick-card button"))
      clearConflict(event);
  });
  scheduleLive();
  submit(form, "保存并检查冲突", async (d) => {
    const result = await api(
      "data/lessons" + (row.id ? "/" + row.id : ""),
      row.id ? "PATCH" : "POST",
      {
        ...d,
        ...(row.class_id ? { class_id: row.class_id } : {}),
        assistant_id: d.assistant_id || null,
        location_id: d.location_id || null,
        duration: Number(d.duration),
        units: Number(d.units),
        student_ids: [
          ...form.querySelectorAll("[name=student_ids]:checked"),
        ].map((i) => i.value),
        force: force.checked,
        ...(row.id ? { version: row.version } : {}),
      },
    );
    if (result.committed === false) {
      const why = result.conflicts.map((x) => x.reasons.join("、")).join("；");
      conflictNotice.textContent =
        "未保存：" + why + "。请调整时间、教师或教室后重试。";
      conflictNotice.hidden = false;
      forceBox.hidden = false;
      forceBox.dataset.why = why;
      conflictNotice.focus({ preventScroll: true });
      conflictNotice.scrollIntoView({ block: "center", behavior: "instant" });
      return;
    }
    close();
    await schedulePage(c);
  });
  panel.append(form);
}
// ---------- 实时冲突预查（只在页面里算，帮助挑时间；保存时仍以服务器检查为准） ----------
// 按当天课表算：老师/助教同时段有课、教室同时段被占（线上课不占教室）、学员同时段有课。
const LIVE_IDLE = ["cancelled", "rescheduled", "teacher_leave"];
const liveDays = new Map();
// 同一天的课表 30 秒内复用；期间有保存操作就重取。
function liveDayRows(date) {
  const hit = liveDays.get(date);
  if (hit && hit.seq === apiWriteSeq && Date.now() - hit.at < 30000) return hit.p;
  const p = (async () => {
    const items = [];
    for (let offset = 0; ; ) {
      const d = await api("schedule?from=" + date + "&to=" + dateShift(date, 1) + "&offset=" + offset);
      items.push(...(d.items || []));
      if (d.next_offset === null || d.next_offset === undefined) return items;
      offset = d.next_offset;
    }
  })().catch((e) => {
    liveDays.delete(date);
    throw e;
  });
  liveDays.set(date, { at: Date.now(), seq: apiWriteSeq, p });
  return p;
}
const liveMin = (iso) => Number(String(iso).slice(11, 13)) * 60 + Number(String(iso).slice(14, 16));
const liveHm = (m) => String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
// 返回 [{ who: "teacher"|"room"|"student", text, from, to, label }]
function liveConflicts(plan, rows, names = {}) {
  const out = [];
  const from = plan.from,
    to = plan.from + plan.duration,
    teachers = [plan.teacher_id, plan.assistant_id].filter(Boolean),
    students = new Set(plan.student_ids || []);
  for (const r of rows) {
    if (r.id === plan.exclude_id || LIVE_IDLE.includes(r.status)) continue;
    const a = liveMin(r.start_at),
      b = a + Number(r.duration || 0);
    if (from >= b || to <= a) continue;
    const when = liveHm(a) + "–" + liveHm(b),
      course = r.course_name || "课程";
    const hitTeacher = teachers.find((id) => id === r.teacher_id || id === r.assistant_id);
    if (hitTeacher) out.push({ who: "teacher", from: a, to: b, label: course, text: (names.teacher?.(hitTeacher) || "老师") + " " + when + " 已有「" + course + "」" });
    if (plan.location_id && plan.mode !== "online" && r.mode !== "online" && r.location_id === plan.location_id)
      out.push({ who: "room", from: a, to: b, label: course, text: (names.room?.(plan.location_id) || "教室") + " " + when + " 被「" + course + "」占用" });
    const ids = r.participant_student_ids || (r.participants || []).map((p) => p.student_id);
    for (const id of ids)
      if (students.has(id)) out.push({ who: "student", from: a, to: b, label: course, text: (names.student?.(id) || "学员") + " " + when + " 在上「" + course + "」" });
  }
  return out;
}
// 选学员：已选的人在最上一行，搜索框是“快速筛选”，下面常驻学员卡片（一排多个，点一下选中、再点取消）。
// 筛选认汉字、全拼、拼音首字母（后端给每个学员一组 search_keys，如 ["tangyixin","tyx"]）。
const pickKey = (v) => String(v ?? "").toLowerCase().replace(/\s+/g, "");
function pickMatches(student, q) {
  if (!q) return true;
  if (pickKey(student.name).includes(q)) return true;
  if ((student.phone || "").includes(q)) return true;
  return (student.search_keys || []).some((k) => String(k).includes(q));
}
function studentPicker(form, { students, selected = [], locked = false, legend = "学员", single = false, onChange }) {
  const chosen = new Set(selected),
    byId = new Map(students.map((s) => [s.id, s])),
    sorted = [...students].sort((x, y) => String(x.name).localeCompare(String(y.name), "zh-Hans-CN-u-co-pinyin")),
    box = el("fieldset", null, { class: "v-spick is-wide" }),
    chips = el("div", null, { class: "v-spick-cards", "aria-live": "polite" }),
    hidden = el("div", null, { hidden: "" }),
    count = el("span", "", { class: "v-spick-count" });
  const head = el("legend");
  head.append(el("span", legend), count);
  box.append(head);
  const tiles = new Map();
  let meta = null,
    empty = null;
  function sync() {
    chips.replaceChildren();
    hidden.replaceChildren();
    for (const id of chosen) {
      const st = byId.get(id);
      const chip = el("span", null, { class: "v-spick-card" });
      chip.append(el("span", st?.name || "学员"));
      if (!locked) {
        const x = el("button", "×", { type: "button", "aria-label": "移除 " + (st?.name || "学员") });
        x.addEventListener("click", () => {
          chosen.delete(id);
          sync();
        });
        chip.append(x);
      }
      chips.append(chip);
      const input = el("input", null, { type: "checkbox", name: "student_ids", value: id });
      input.checked = true;
      hidden.append(input);
    }
    if (!locked && chosen.size) {
      const clear = el("button", "清空", { type: "button", class: "v-spick-clear" });
      clear.addEventListener("click", () => {
        chosen.clear();
        sync();
      });
      chips.append(clear);
    }
    count.textContent = chosen.size ? "已选 " + chosen.size + " 人" : "还没选";
    if (!chosen.size) chips.append(el("span", locked ? "这个班级还没有学员" : "点下面的学员卡片选择", { class: "v-muted" }));
    for (const [id, tile] of tiles) {
      const on = chosen.has(id);
      tile.classList.toggle("is-on", on);
      tile.setAttribute("aria-pressed", String(on));
    }
  }
  if (!single) box.append(chips);
  else count.hidden = true;
  if (!locked) {
    const search = el("input", null, {
        type: "search",
        placeholder: "搜索：姓名 / 拼音 / 首字母，例如 唐、tang、ta",
        "aria-label": "筛选学员",
        autocomplete: "off",
        class: "v-spick-input",
      }),
      grid = el("div", null, { class: "v-spick-grid", role: "group", "aria-label": "学员" });
    meta = el("div", "", { class: "v-spick-meta v-muted" });
    empty = el("p", "", { class: "v-muted v-spick-empty", hidden: "" });
    for (const s of sorted) {
      const tile = el("button", null, { type: "button", class: "v-spick-tile", "aria-pressed": "false" });
      tile.append(el("span", Array.from(s.name || "?")[0], { class: "v-spick-av", "aria-hidden": "true" }), el("span", s.name, { class: "v-spick-name" }));
      tile.addEventListener("click", () => {
        if (single) {
          onChange?.(s.id);
          return;
        }
        if (chosen.has(s.id)) chosen.delete(s.id);
        else chosen.add(s.id);
        sync();
      });
      tiles.set(s.id, tile);
      grid.append(tile);
    }
    const filter = () => {
      const q = pickKey(search.value);
      let shown = 0;
      for (const s of sorted) {
        const ok = pickMatches(s, q);
        tiles.get(s.id).hidden = !ok;
        if (ok) shown++;
      }
      meta.textContent = q ? "找到 " + shown + " 人" : "共 " + sorted.length + " 人（按拼音）";
      empty.hidden = shown > 0;
      empty.textContent = shown ? "" : "没有找到“" + search.value.trim() + "”的在读学员";
    };
    search.addEventListener("input", filter);
    search.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const first = [...tiles.values()].find((t) => !t.hidden);
      first?.click();
    });
    box.append(search, meta, grid, empty);
    filter();
  }
  box.append(hidden);
  sync();
  return { element: box, chosen };
}
async function templatesPage(c) {
  await recordsPage(c, "schedule_templates");
  const tools = el("section", null, { class: "panel" });
  tools.append(
    button("管理模板报名", () => recordsPage(c, "schedule_enrollments")),
  );
  const form = el("form");
  field(form, "生成开始日", "from", "date", scheduleWeek);
  field(form, "生成结束日", "to", "date", moveDate(scheduleWeek, 30));
  submit(form, "批量生成并校验", async (d) => {
    const result = await api("templates/generate", "POST", d);
    if (!result.committed)
      notice("整批未写入：发现 " + result.conflicts.length + " 项冲突");
    else
      notice(
        "已生成 " +
          result.generated +
          " 节，跳过重复 " +
          result.skipped +
          " 节",
      );
  });
  tools.append(form);
  c.prepend(tools);
}
async function settingsPage(c) {
  c.replaceChildren(el("h1", "基础设置"));
  for (const resource of ["course_categories", "course_types", "locations"])
    c.append(button(businessLabels[resource], () => recordsPage(c, resource)));
  c.append(
    button("缺勤规则", async () => {
      const { panel } = drawer("缺勤规则"),
        current = await api("absence-policies"),
        form = el("form");
      for (const [key, label] of [
        ["student_leave", "学员请假"],
        ["student_no_show", "学员旷课"],
        ["teacher_leave", "教师请假"],
        ["cancelled", "机构取消"],
      ])
        for (const [flag, text] of [
          ["deduct", "扣课时"],
          ["teacherPaid", "计课酬"],
        ]) {
          const input = field(
            form,
            label + " · " + text,
            key + "_" + flag,
            "checkbox",
            "1",
            false,
          );
          input.checked = !!current.policies[key]?.[flag];
        }
      if (me.user.roles.includes("supervisor"))
        submit(form, "保存规则", async () => {
          const policies = {};
          for (const key of [
            "student_leave",
            "student_no_show",
            "teacher_leave",
            "cancelled",
          ])
            policies[key] = {
              deduct: form.elements[key + "_deduct"].checked,
              teacherPaid: form.elements[key + "_teacherPaid"].checked,
            };
          await api("absence-policies", "PUT", { policies });
          notice("规则已保存，后续出勤操作按该规则计算", "success");
        });
      panel.append(form);
    }),
  );
}
let studentListState = {};
async function studentsPage(c, offset = 0, query = "", selectedId = null) {
  pageIdentity("学员档案");
  c.dataset.page = "students";
  const old = c.querySelector(".ui-list");
  old?.setAttribute("aria-busy", "true");
  if (!old) c.replaceChildren(UI.tableSkeleton());
  const { items, next_offset, total } = await api(
    "data/students?offset=" + offset + "&q=" + encodeURIComponent(query),
  );
  let loadedPackages = [];
  let completePackages = false;
  if (enabled("packages")) {
    const page = await api("credits/packages?offset=0");
    loadedPackages = page.items;
    completePackages = page.next_offset === null;
  }
  const heading = el("div", null, { class: "page-heading" });
  heading.append(el("h1", "学员档案"));
  if (enabled("exports", "export")) heading.append(exportLink("students"));
  if (enabled("students", "create"))
    heading.append(
      button("＋ 新增学员", () => recordForm(c, "students"), "primary"),
    );
  const split = el("div", null, { class: "student-split" }),
    list = el("section", null, { class: "panel student-index" }),
    detailHost = el("section", null, { class: "student-detail" }),
    search = el("form", null, { class: "student-server-search" });
  const input = field(search, "全库姓名搜索", "q", "search", query, false);
  input.placeholder = "输入学员姓名";
  input.maxLength = 100;
  submit(search, "搜索", async (d) => {
    studentListState = {};
    await studentsPage(c, 0, d.q);
  });
  if (query)
    search.append(
      button("清空", () => {
        studentListState = {};
        return studentsPage(c);
      }),
    );
  list.append(search);
  let selected = items.find((x) => x.id === selectedId) || items[0],
    detailSequence = 0;
  const listing = UI.dataList({
    label: "学员档案",
    items,
    pageSize: 50,
    total,
    state: studentListState,
    compactActions: true,
    loadedLabel:
      "仅在本页已加载的 " +
      items.length +
      " 条内排序和筛选；姓名搜索查询全库。",
    columns: [
      {
        key: "name",
        label: "学员",
        sortable: true,
        render: (student) => {
          const entry = el("span", null, { class: "student-entry" }),
            copy = el("span");
          copy.append(el("strong", UI.studentDisplay(student, items)));
          const packs = loadedPackages.filter(
            (p) => p.student_id === student.id,
          );
          const tags = el("span", null, { class: "student-course-tags" });
          for (const name of new Set(
            packs.map((p) => p.course_name).filter(Boolean),
          ))
            tags.append(UI.badge(name, "info"));
          copy.append(tags);
          entry.append(
            el("span", Array.from(student.name)[0], { class: "avatar" }),
            copy,
          );
          if (completePackages)
            entry.append(
              el(
                "span",
                String(packs.reduce((n, p) => n + Number(p.balance || 0), 0)) +
                  " 课时",
                { class: "student-row-balance" },
              ),
            );
          return entry;
        },
      },
    ],
    filters: [
      { value: "active", label: "在读" },
      { value: "paused", label: "暂停" },
      { value: "archived", label: "归档" },
    ],
    onOpen: async (student) => {
      if (c.dataset.manualStudentOrder) {
        await c.__closeManualOrder?.();
        globalThis.ChannelRebuild.goStudent(student.id);
        return;
      }
      selected = student;
      await renderDetail(matchMedia("(max-width: 1050px)").matches);
    },
    manual: enabled("students", "update") && !query,
    onReorder:
      enabled("students", "update") && !query
        ? async (ordered) => {
            await api("reorder", "PUT", {
              resource: "students",
              offset,
              records: ordered.map((x) => ({ id: x.id, version: x.version })),
            });
            studentListState = listing.getState();
            await studentsPage(c, offset, query, selected?.id);
          }
        : undefined,
    onDelete: enabled("students", "delete")
      ? async (row) => {
          await api("data/students/" + row.id, "DELETE", {
            version: row.version,
          });
          if (selected?.id === row.id) {
            selected = null;
            detailHost.replaceChildren(
              UI.emptyState("请选择学员", "点击列表查看学员档案。"),
            );
          }
        }
      : undefined,
    deleteMessage:
      "确认删除该学员？已有课程或课时记录引用时服务器会拒绝，请编辑为归档。",
  });
  list.append(listing.element);
  const pageTools = UI.pagination({
    loaded: items.length,
    offset,
    nextOffset: next_offset,
    onPage: (next) => {
      studentListState = listing.getState();
      return studentsPage(c, next, query);
    },
  });
  list.append(pageTools);
  split.append(list, detailHost);
  c.replaceChildren(heading, split);
  async function renderDetail(inDrawer = false) {
    const requestSequence = ++detailSequence;
    const detail = inDrawer ? drawer("学员详情").panel : detailHost;
    detail.replaceChildren();
    if (!selected) {
      detail.append(
        el("section", "暂无学员，请先新增档案", { class: "panel" }),
      );
      return;
    }
    const row = (await api("data/students/" + selected.id)).record,
      head = el("section", null, { class: "panel" }),
      tools = el("div", null, { class: "row" });
    if (requestSequence !== detailSequence) return;
    const avatar = el("span", Array.from(row.name)[0], {
      class: "avatar student-avatar",
    });
    tools.append(
      avatar,
      el("h2", row.name),
      UI.badge(
        { active: "在读", paused: "暂停", archived: "归档" }[row.status] ||
          "未填写",
        row.status === "active" ? "success" : "neutral",
      ),
    );
    if (enabled("students", "update"))
      tools.append(button("编辑档案", () => recordForm(c, "students", row)));
    if (!inDrawer) tools.append(button("详情抽屉", () => renderDetail(true)));
    head.append(
      tools,
      el(
        "p",
        (row.grade || "未填年级") +
          " · " +
          (row.direction || "未填方向") +
          " · " +
          { active: "在读", paused: "暂停", archived: "归档" }[row.status],
      ),
    );
    detail.append(head);
    const tabs = el("div", null, { class: "row" }),
      body = el("section", null, { class: "panel" });
    let viewGeneration = 0;
    tabs.append(
      button("学习概况", overview),
      button("个人周课表", courses),
      ...(enabled("followup")
        ? [
            button("教务跟进", () => {
              viewGeneration++;
              return followupPage(body, row.id);
            }),
          ]
        : []),
      ...(enabled("referrals")
        ? [
            button("合作升学服务", () => {
              viewGeneration++;
              return referralsPage(body, row.id);
            }),
          ]
        : []),
      button("不可排时段", blocks),
      ...(enabled("packages")
        ? [button("课时包与流水", () => creditPage(c, "packages", row.id))]
        : []),
      ...(enabled("students")
        ? [button("学习阶段", () => creditPage(c, "stages", row.id))]
        : []),
      ...(enabled("tuition")
        ? [button("缴费记录", () => creditPage(c, "payments", row.id))]
        : []),
    );
    detail.append(tabs, body);
    await overview();
    async function overview() {
      const generation = ++viewGeneration;
      body.replaceChildren();
      const summaries = el("div", null, { class: "student-metrics" });
      body.append(summaries);
      if (enabled("packages")) {
        const packs = [];
        for (let offset = 0; ; offset += 200) {
          const page = await api(
            "credits/packages?student_id=" + row.id + "&offset=" + offset,
          );
          packs.push(...page.items);
          if (page.next_offset === null) break;
        }
        if (generation !== viewGeneration) return;
        const metric = card("剩余课时");
        metric.append(
          el(
            "strong",
            String(packs.reduce((n, p) => n + Number(p.balance || 0), 0)),
            { class: "metric-value" },
          ),
        );
        summaries.append(metric);
      }
      if (enabled("tuition")) {
        const payments = [];
        for (let offset = 0; ; offset += 200) {
          const page = await api(
            "credits/payments?student_id=" + row.id + "&offset=" + offset,
          );
          payments.push(...page.items);
          if (page.next_offset === null) break;
        }
        if (generation !== viewGeneration) return;
        const metric = card("累计缴费");
        metric.append(
          el(
            "strong",
            UI.formatMoney(
              payments.reduce((n, p) => n + Number(p.amount || 0), 0),
            ),
            { class: "metric-value" },
          ),
        );
        summaries.append(metric);
      }
      if (enabled("schedule")) {
        const now = Date.now(),
          today = todayBJ(),
          month = today.slice(0, 7),
          start = month + "-01",
          end = new Date(
            Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1),
          )
            .toISOString()
            .slice(0, 10);
        const read = async (from, to) => {
          const rows = [];
          for (let offset = 0; ; offset += 200) {
            const page = await api(
              "schedule?from=" +
                from +
                "&to=" +
                to +
                "&student_id=" +
                row.id +
                "&offset=" +
                offset,
            );
            rows.push(...page.items);
            if (page.next_offset === null) return rows;
          }
        };
        const [monthly, past, future] = await Promise.all([
          read(start, end),
          read(moveDate(today, -31), today),
          read(today, moveDate(today, 31)),
        ]);
        if (generation !== viewGeneration) return;
        const attended = card("本月上课次数");
        attended.append(
          el(
            "strong",
            String(
              monthly.filter(
                (l) =>
                  l.own_attendance === "attended" &&
                  Date.parse(l.start_at) <= now,
              ).length,
            ) + " 次",
            { class: "metric-value" },
          ),
        );
        summaries.append(attended);
        const next = future
          .filter((l) => Date.parse(l.start_at) > now && l.status === "planned")
          .sort((a, b) => a.start_at.localeCompare(b.start_at))[0];
        const nextCard = card("下次课");
        nextCard.append(
          el(
            "strong",
            next
              ? next.start_at.slice(5, 16).replace("T", " ")
              : "未来31天暂无排课",
          ),
          el(
            "small",
            next ? next.course_name + " · " + next.teacher_name : "",
            { class: "muted" },
          ),
        );
        summaries.append(nextCard);
        const recent = card("最近上课与点评");
        const seen = [
          ...new Map([...past, ...monthly].map((l) => [l.id, l])).values(),
        ]
          .filter((l) => Date.parse(l.start_at) <= now)
          .sort((a, b) => b.start_at.localeCompare(a.start_at))
          .slice(0, 5);
        for (const lesson of seen) {
          const line = el("section", null, { class: "student-recent-lesson" });
          line.append(
            el(
              "strong",
              lesson.start_at.slice(5, 16).replace("T", " ") +
                " · " +
                lesson.course_name,
            ),
            el("small", cnLesson(lesson.status), { class: "muted" }),
          );
          for (const text of [
            lesson.public_text,
            lesson.private_comment,
          ].filter(Boolean))
            line.append(el("p", text));
          if (!lesson.public_text && !lesson.private_comment)
            line.append(el("p", "暂无可查看的已公开点评", { class: "muted" }));
          recent.append(line);
        }
        if (!recent.length && !seen.length)
          recent.append(el("p", "近31天暂无已开始课程", { class: "muted" }));
        body.append(recent);
      }
      body.append(el("h2", "基本信息"));
      for (const [label, key] of [
        ["学校", "school"],
        ["年级", "grade"],
        ["专业方向", "direction"],
        ["家长称呼", "parent_name"],
        ["备注", "notes"],
      ])
        body.append(el("p", label + "：" + (row[key] || "未填写")));
      body.append(
        el("h2", "学员账号"),
        el(
          "p",
          row.account_id
            ? "已开通 · " + (row.account_active ? "启用" : "停用")
            : "未开通",
        ),
      );
      if (me.user.roles.includes("supervisor") && enabled("accounts"))
        body.append(
          button("查看完整联系方式", async () => {
            const result = await api(
              "data/students/" + row.id + "/contact",
              "POST",
              {},
            );
            notice(
              "学员：" +
                (result.phone || "未填") +
                "；家长：" +
                (result.parent_phone || "未填") +
                "（已记录查看操作）",
            );
          }),
        );
      if (row.account_id && me.user.roles.includes("supervisor"))
        body.append(activationButton(row));
      if (
        !row.account_id &&
        (me.user.roles.includes("supervisor") ||
          (me.user.roles.includes("academic") &&
            me.policy.settings.academic_can_create_accounts !== false))
      )
        body.append(
          button("开通学员账号", () => personalAccount("students", row)),
        );
      if (
        row.account_id &&
        (me.user.roles.includes("supervisor") ||
          (me.user.roles.includes("academic") &&
            me.policy.settings.academic_can_reset_accounts !== false))
      )
        body.append(
          button("重置学员密码", async () => {
            if (!(await ask("重置后该学员账号的所有设备将下线，继续吗？")))
              return;
            showSecret(
              await api(
                "accounts/" + row.account_id + "/reset-password",
                "POST",
                {},
              ),
            );
          }),
        );
    }
    async function courses() {
      const generation = ++viewGeneration;
      body.replaceChildren(el("h2", "个人周课表"));
      const from = moveDate(
        scheduleWeek,
        -((new Date(scheduleWeek + "T12:00:00Z").getUTCDay() + 6) % 7),
      );
      let count = 0;
      for (let offset = 0; ; offset += 200) {
        const page = await api(
          "schedule?from=" +
            from +
            "&to=" +
            moveDate(from, 7) +
            "&student_id=" +
            row.id +
            "&offset=" +
            offset,
        );
        if (generation !== viewGeneration) return;
        for (const lesson of page.items) {
          body.append(courseCard(c, lesson));
          count++;
        }
        if (page.next_offset === null) break;
      }
      if (!count) body.append(el("p", "本周暂无课程"));
    }
    async function blocks() {
      const generation = ++viewGeneration;
      body.replaceChildren(el("h2", "不可排时段"));
      for (const b of (await choices("student_schedule_blocks")).filter(
        (x) => x.student_id === row.id,
      )) {
        if (generation !== viewGeneration) return;
        const line = el("div", null, { class: "row" });
        line.append(
          el(
            "p",
            "周" +
              ["一", "二", "三", "四", "五", "六", "日"][b.weekday] +
              " " +
              b.start_time +
              "—" +
              b.end_time +
              " " +
              b.label,
          ),
        );
        if (enabled("students", "update"))
          line.append(
            button("编辑", () => recordForm(c, "student_schedule_blocks", b)),
          );
        if (enabled("students", "delete"))
          line.append(
            button("删除", async () => {
              if (!(await ask("删除这个不可排时段？"))) return;
              await api("data/student_schedule_blocks/" + b.id, "DELETE", {
                version: b.version,
              });
              await blocks();
            }),
          );
        body.append(line);
      }
      if (enabled("students", "create"))
        body.append(
          button("＋ 新增不可排时段", () =>
            recordForm(c, "student_schedule_blocks", { student_id: row.id }),
          ),
        );
    }
  }
  if (
    !c.dataset.manualStudentOrder &&
    !matchMedia("(max-width: 1050px)").matches
  )
    await renderDetail();
}

function activationButton(row) {
  return button(
    row.account_active ? "停用个人账号" : "启用个人账号",
    async () => {
      if (!(await ask("账号状态变更将使该账号的在线设备下线，继续吗？")))
        return;
      const u = (await api("accounts/" + row.account_id)).user;
      await api("accounts/" + u.id, "PATCH", {
        name: u.name,
        roles: u.roles,
        active: !row.account_active,
        version: u.version,
      });
      notice("账号状态已更新，请刷新档案", "success");
    },
  );
}
const attendanceNames = new Proxy(
  {},
  {
    get: (_, key) => me?.labels?.attendance?.[key] || "未知状态",
    ownKeys: () => Object.keys(me?.labels?.attendance || {}),
    getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
  },
);
function operation() {
  return crypto.randomUUID();
}
async function creditWrite(path, data, method = "POST", op = operation()) {
  return api("credits/" + path, method, { operation_id: op, ...data });
}
async function creditPage(c, kind = "packages", studentId = "", offset = 0) {
  // 记住这个区块是“只看某位学员”还是“全部”，表单保存后按同样范围刷新。
  c.dataset.creditScope = studentId || "";
  const labels = {
      packages: "课时包与流水",
      transactions: "课时流水",
      payments: "缴费记录",
      stages: "学习阶段",
      makeups: "请假与补课",
    },
    module =
      kind === "payments"
        ? "tuition"
        : kind === "stages"
          ? "students"
          : kind === "makeups"
            ? "attendance"
            : "packages";
  const page = await api(
    "credits/" +
      kind +
      "?offset=" +
      offset +
      (studentId ? "&student_id=" + encodeURIComponent(studentId) : ""),
  );
  c.replaceChildren(el("h1", labels[kind]));
  const tools = el("div", null, { class: "row" });
  c.append(tools);
  if (kind === "packages") {
    if (enabled("exports", "export")) tools.append(exportLink("packages"));
    tools.append(
      button("课时包", () => creditPage(c, "packages", studentId)),
      button("课时流水", () => creditPage(c, "transactions", studentId)),
    );
    if (enabled("packages", "transfer"))
      tools.append(button("课时转移", () => transferForm(c, studentId)));
  }
  if (
    ["packages", "stages", "payments"].includes(kind) &&
    enabled(module, "create")
  )
    tools.append(
      button(
        "＋ " +
          {
            packages: "新建课时包",
            stages: "新建学习阶段",
            payments: "登记缴费",
          }[kind],
        () => creditForm(c, kind, { student_id: studentId }),
        "primary",
      ),
    );
  if (studentId) tools.append(button("查看全部", () => creditPage(c, kind)));
  const students = me.user.roles.includes("student")
      ? []
      : await choices("students"),
    names = new Map(students.map((s) => [s.id, s.name]));
  const section = el("section", null, { class: "panel credit-table" }),
    table = el("table"),
    head = el("tr");
  section.append(table);
  c.append(section);
  const financial =
    enabled("tuition") ||
    (me.user.roles.includes("student") &&
      me.policy.settings.student_view_payments);
  const columns =
    kind === "packages"
      ? [
          "学员",
          "课程",
          "总课时",
          "剩余课时",
          "有效期",
          ...(financial ? ["单价", "金额"] : []),
          "状态",
          "操作",
        ]
      : kind === "transactions"
        ? ["学员", "日期", "课时变动", "类型", "备注"]
        : kind === "payments"
          ? [
              "学员",
              "缴费日期",
              "金额",
              "方式",
              "备注",
              ...(enabled("tuition", "update") ? ["操作"] : []),
            ]
          : kind === "stages"
            ? ["学员", "阶段", "起止日期", "目标", "状态", "操作"]
            : ["学员", "补课课程", "备注", "操作"];
  for (const text of columns) head.append(el("th", text));
  table.append(head);
  for (const row of page.items) {
    const tr = el("tr"),
      student = names.get(row.student_id) || row.student_name || "我的记录";
    let cells;
    if (kind === "packages")
      cells = [
        student,
        row.course_name || "课程",
        row.units_total,
        row.balance,
        (row.valid_from || "不限") + " — " + (row.valid_to || "不限"),
        ...(financial
          ? [
              row.unit_price == null ? "待补录" : fmt.moneyCell(row.unit_price),
              row.amount == null ? "待补录" : fmt.moneyCell(row.amount),
            ]
          : []),
        row.display_status?.text || "未填写",
      ];
    else if (kind === "transactions")
      cells = [
        student,
        row.date,
        (row.delta > 0 ? "+" : "") + row.delta,
        {
          purchase: "购买",
          consume: "销课",
          reversal: "回补",
          adjustment: "调整",
          transfer_in: "转入",
          transfer_out: "转出",
        }[row.type] || "课时变动",
        row.note,
      ];
    else if (kind === "payments")
      cells = [
        student,
        row.paid_at,
        fmt.moneyCell(row.amount),
        row.method,
        row.note,
      ];
    else if (kind === "stages")
      cells = [
        student,
        row.name,
        (row.date_from || "不限") + " — " + (row.date_to || "不限"),
        row.goal,
        row.display_status?.text ||
          { active: "进行中", completed: "已完成", paused: "暂停" }[row.status],
      ];
    else
      cells = [
        student,
        (row.original_course || "原课") +
          " " +
          (row.original_start || "").slice(0, 16).replace("T", " ") +
          " → " +
          (row.target_course || "补课") +
          " " +
          (row.target_start || "").slice(0, 16).replace("T", " "),
        row.note,
      ];
    for (const text of cells) tr.append(el("td", String(text ?? "")));
    if (["packages", "stages", "makeups"].includes(kind)) {
      const actions = el("td");
      if (kind !== "makeups" && enabled(module, "update"))
        actions.append(button("编辑", () => creditForm(c, kind, row)));
      if (kind === "packages" && enabled("packages", "adjust"))
        actions.append(button("调整课时", () => adjustForm(c, row)));
      if (kind === "makeups" && enabled("attendance", "update"))
        actions.append(
          button("解除关联", async () => {
            if (
              !(await ask(
                "解除后，已出勤补课将重新按普通课程计算课时；余额不足则整笔拒绝。继续？",
              ))
            )
              return;
            await creditWrite("makeups/" + row.id + "/unlink", {
              version: row.version,
            });
            await creditPage(c, kind, studentId, offset);
          }),
        );
      tr.append(actions);
    }
    if (kind === "payments" && enabled("tuition", "update")) {
      const td = el("td");
      td.append(
        button("编辑缴费", async () => {
          const { panel, close } = drawer("修改缴费记录"),
            form = el("form");
          field(form, "缴费金额（元）", "amount", "number", row.amount).step =
            ".01";
          field(form, "收款日期", "paid_at", "date", row.paid_at);
          field(form, "收款方式", "method", "text", row.method, false);
          field(form, "备注", "note", "text", row.note, false);
          const op = operation();
          submit(form, "保存", async (d) => {
            await api("finance/tuition/" + row.id, "PATCH", {
              ...d,
              amount: Number(d.amount),
              version: row.version,
              operation_id: op,
            });
            close();
            await creditPage(c, "payments", c.dataset.creditScope || "");
          });
          panel.append(form);
        }),
      );
      tr.append(td);
    }
    table.append(tr);
  }
  if (!page.items.length)
    section.append(el("p", "暂无记录", { class: "muted" }));
  const nav = el("div", null, { class: "row" });
  if (offset)
    nav.append(
      button("上一页", () =>
        creditPage(c, kind, studentId, Math.max(0, offset - 200)),
      ),
    );
  if (page.next_offset !== null)
    nav.append(
      button("下一页", () => creditPage(c, kind, studentId, page.next_offset)),
    );
  c.append(nav);
  if (kind === "packages")
    section.prepend(
      el("p", "余额由课时流水自动汇总；低余额提示为剩余 2 课时及以下。", {
        class: "muted",
      }),
    );
}
async function creditForm(c, kind, row = {}) {
  const { panel, close } = drawer(
      (row.id ? "编辑" : kind === "payments" ? "" : "新建") +
        { packages: "课时包", stages: "学习阶段", payments: "登记缴费" }[kind],
    ),
    form = el("form"),
    op = operation();
  const students = await choices("students");
  // 从学员页打开时学员已经定了，不再让人改（原来能改成别人）。
  selectField(form, "学员", "student_id", students, row.student_id).disabled =
    !!row.id || (!!row.student_id && kind !== "payments");
  if (kind === "packages") {
    selectField(
      form,
      "适用课程",
      "course_type_id",
      await choices("course_types"),
      row.course_type_id,
    ).disabled = !!row.id;
    const total = field(
      form,
      "购买课时数",
      "units_total",
      "number",
      row.units_total ?? "",
    );
    total.min = 0;
    total.step = ".01";
    total.placeholder = "例如 20";
    for (const [key, label] of [
      ["valid_from", "有效期开始"],
      ["valid_to", "有效期结束"],
    ])
      field(form, label, key, "date", row[key] || "", false);
    if (!row.id)
      field(
        form,
        "购买日期（决定先进先出顺序）",
        "purchase_date",
        "date",
        new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" }),
      );
    selectField(
      form,
      "状态",
      "status",
      [
        { id: "active", name: "启用" },
        { id: "paused", name: "暂停" },
      ],
      row.status || "active",
    );
    const stages = await api("credits/stages");
    selectField(
      form,
      "学习阶段（可不关联）",
      "stage_id",
      stages.items.filter(
        (s) => !row.student_id || s.student_id === row.student_id,
      ),
      row.stage_id,
    ).required = false;
    if (enabled("tuition", row.id ? "update" : "create")) {
      // 金额和单价联动：填金额自动算单价，填单价自动算金额（按课时数）。
      const inputs = {};
      for (const [key, label] of [
        ["amount", "课时包金额（元）"],
        ["unit_price", "单价（元/课时，自动计算）"],
      ]) {
        const input = field(form, label, key, "number", row[key] ?? "", false);
        input.min = 0;
        input.step = ".01";
        inputs[key] = input;
      }
      const r2 = (x) => Math.round(x * 100) / 100;
      const units = () => Number(total.value) || 0;
      inputs.amount.addEventListener("input", () => {
        if (units() > 0 && inputs.amount.value !== "") inputs.unit_price.value = String(r2(Number(inputs.amount.value) / units()));
      });
      inputs.unit_price.addEventListener("input", () => {
        if (units() > 0 && inputs.unit_price.value !== "") inputs.amount.value = String(r2(Number(inputs.unit_price.value) * units()));
      });
      total.addEventListener("input", () => {
        if (units() > 0 && inputs.amount.value !== "") inputs.unit_price.value = String(r2(Number(inputs.amount.value) / units()));
      });
      if (!row.id)
        form.append(el("p", "这里只记课时包的价格；收钱请用“登记缴费”，可以一次分给多个课时包。", { class: "muted" }));
    } else
      form.append(
        el("p", "只填写课时数与有效期，金额由财务补录。", { class: "muted" }),
      );
  } else if (kind === "stages") {
    field(form, "阶段名称", "name", "text", row.name || "");
    field(form, "开始日期", "date_from", "date", row.date_from || "", false);
    field(form, "结束日期", "date_to", "date", row.date_to || "", false);
    field(form, "学习目标", "goal", "text", row.goal || "", false);
    selectField(
      form,
      "状态",
      "status",
      [
        { id: "active", name: "进行中" },
        { id: "completed", name: "已完成" },
        { id: "paused", name: "暂停" },
      ],
      row.status || "active",
    );
  } else {
    const amount = field(form, "缴费金额", "amount", "number");
    amount.min = ".01";
    amount.step = ".01";
    field(
      form,
      "收款日期",
      "paid_at",
      "date",
      new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" }),
    );
    field(form, "收款方式", "method", "text", "", false);
    field(form, "备注", "note", "text", "", false);
  }
  submit(form, "确认保存", async (d) => {
    for (const key of ["units_total", "unit_price", "amount"])
      if (key in d) d[key] = d[key] === "" ? null : Number(d[key]);
    if ("stage_id" in d) d.stage_id = d.stage_id || null;
    if (!row.id && !d.student_id && row.student_id) d.student_id = row.student_id;
    const saved = await creditWrite(
      kind + (row.id ? "/" + row.id : ""),
      { ...d, ...(row.id ? { version: row.version } : {}) },
      row.id ? "PATCH" : "POST",
      op,
    );
    close();
    // 缴费超过课时包剩余应收时，多出的部分由后端转入预收余额。
    if (Number(saved?.deposit_amount) > 0)
      notice("超出应收的 " + saved.deposit_amount + " 元已转入该学员的预收余额", "success");
    await creditPage(c, kind, c.dataset.creditScope || "");
  });
  if (kind === "packages")
    standardForm(
      form,
      {
        groups: [
          ["", ["student_id", "course_type_id"]],
          ["课时与价格", ["units_total", "amount", "unit_price"]],
          ["有效期", ["valid_from", "valid_to"]],
          ["其他", ["stage_id", "status"]],
        ],
        advanced: ["purchase_date"],
      },
      close,
    );
  else if (kind === "stages")
    standardForm(
      form,
      {
        groups: [
          ["", ["student_id", "name"]],
          ["起止日期", ["date_from", "date_to"]],
          ["", ["goal", "status"]],
        ],
        wide: ["goal"],
      },
      close,
    );
  panel.append(form);
}
async function adjustForm(c, row) {
  const { panel, close } = drawer("调整课时"),
    form = el("form"),
    op = operation();
  panel.append(
    el(
      "p",
      "当前余额 " +
        row.balance +
        " 课时；正数补入、负数扣除，记录原因并追加流水。",
    ),
  );
  const delta = field(form, "课时变动", "delta", "number");
  delta.step = ".01";
  field(form, "调整原因", "reason");
  submit(form, "确认调整", async (d) => {
    await creditWrite(
      "adjust",
      { package_id: row.id, delta: Number(d.delta), reason: d.reason },
      "POST",
      op,
    );
    close();
    await creditPage(c, "packages", c.dataset.creditScope || "");
  });
  panel.append(form);
}
async function transferForm(c, studentId) {
  const { panel, close } = drawer("课时转移"),
    form = el("form"),
    op = operation(),
    students = await choices("students");
  const student = selectField(form, "学员", "student_id", students, studentId),
    from = selectField(form, "来源课时包", "from_package_id", []),
    to = selectField(form, "目标课时包", "to_package_id", []);
  async function refresh() {
    const rows = student.value
      ? (await api("credits/packages?student_id=" + student.value)).items
      : [];
    for (const input of [from, to]) {
      input.replaceChildren(el("option", "请选择", { value: "" }));
      for (const row of rows)
        input.append(
          el(
            "option",
            (row.course_name || "课程") + " · 余 " + row.balance + " 课时",
            { value: row.id },
          ),
        );
    }
  }
  student.addEventListener("change", () =>
    refresh().catch((e) => notice(e.message)),
  );
  await refresh();
  for (const [key, label] of [
    ["from_units", "转出课时"],
    ["to_units", "转入课时"],
  ]) {
    const input = field(form, label, key, "number");
    input.min = ".01";
    input.step = ".01";
  }
  const reason = field(
      form,
      "转移原因（偏离参考比例超过20%必填）",
      "reason",
      "text",
      "",
      false,
    ),
    hint = el("p", "请先选择两个课时包", { class: "impact-note" });
  form.append(hint);
  let reference = null;
  async function preview() {
    reference = null;
    reason.required = false;
    if (!from.value || !to.value) return;
    const data = await api(
      "credits/transfer?from_package_id=" +
        encodeURIComponent(from.value) +
        "&to_package_id=" +
        encodeURIComponent(to.value),
    );
    reference = data.reference_ratio;
    hint.textContent =
      reference === null
        ? "单价缺失或为零，不校验参考比例。"
        : "参考比例：1 来源课时 ≈ " +
          reference.toFixed(4) +
          " 目标课时；偏离超过20%需填写原因。";
    validateRatio();
  }
  function validateRatio() {
    const a = Number(form.elements.from_units.value),
      b = Number(form.elements.to_units.value);
    reason.required =
      reference !== null &&
      a > 0 &&
      Math.abs(b / a / reference - 1) > 0.2 + 1e-9;
  }
  from.addEventListener("change", () =>
    preview().catch((e) => notice(e.message)),
  );
  to.addEventListener("change", () =>
    preview().catch((e) => notice(e.message)),
  );
  form.elements.from_units.addEventListener("input", validateRatio);
  form.elements.to_units.addEventListener("input", validateRatio);

  submit(form, "确认转移", async (d) => {
    await creditWrite(
      "transfer",
      { ...d, from_units: Number(d.from_units), to_units: Number(d.to_units) },
      "POST",
      op,
    );
    close();
    await creditPage(c, "packages", c.dataset.creditScope || "");
  });
  panel.append(form);
}
async function makeupForm(c, data, part) {
  return globalThis.ChannelRebuild.manualMakeup(c, data, part);
}

let financeMonth = new Date()
  .toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" })
  .slice(0, 7);
function monthTools(c, reload) {
  const form = el("form", null, { class: "row" });
  field(form, "月份", "month", "month", financeMonth);
  submit(form, "查看", async (d) => {
    financeMonth = d.month;
    await reload();
  });
  c.append(form);
}
function exportLink(kind, text = "导出 Excel") {
  return el("a", text, {
    class: "button",
    href: base + "api/export?kind=" + kind + "&month=" + financeMonth,
    download: "",
  });
}
async function financePage(c) {
  const data = await api("finance/payroll?month=" + financeMonth);
  c.replaceChildren(
    el(
      "h1",
      me.user.roles.includes("teacher") ? "我的课酬" : "教师课酬与月度结算",
    ),
  );
  monthTools(c, () => financePage(c));
  const tools = el("div", null, { class: "row" });
  tools.append(exportLink("finance"));
  if (enabled("teacher_pay", "create"))
    tools.append(
      button("课酬标准", () => financeRecords(c, "rates")),
      button("课酬调整", () => financeRecords(c, "adjustments")),
      button("付款记录", () => financeRecords(c, "payments")),
    );
  if (enabled("settlements"))
    tools.append(button("月度结算", () => settlementForm(c)));
  c.append(
    tools,
    el(
      "p",
      data.locked
        ? "本月已确认；应计已锁定，付款记录可继续登记。"
        : "本月未确认；由财务提交、主管批准后锁定。",
      { class: "impact-note" },
    ),
  );
  const panel = el("section", null, { class: "panel credit-table" }),
    table = el("table"),
    head = el("tr");
  for (const title of [
    "教师",
    "课次",
    "课时",
    "应计",
    "调整",
    "合计",
    "已付",
    "未付",
    "状态",
    "操作",
  ])
    head.append(el("th", title));
  table.append(head);
  for (const row of data.items) {
    const tr = el("tr");
    for (const value of [
      row.teacher_name,
      row.lesson_count,
      row.units,
      fmt.moneyCell(row.accrued_amount),
      fmt.moneyCell(row.adjustment_amount),
      fmt.moneyCell(row.total_amount),
      fmt.moneyCell(row.paid_amount),
      fmt.moneyCell(row.unpaid_amount),
      row.confirmation_status === "confirmed" ? "已确认" : "未确认",
    ])
      tr.append(el("td", String(value)));
    const ops = el("td");
    ops.append(
      button("课次明细", () =>
        payrollDetail(
          row,
          data.lessons.filter((l) => l.teacher_id === row.teacher_id),
        ),
      ),
    );
    if (enabled("teacher_pay", "create"))
      ops.append(
        button("登记付款", () =>
          financeRecordForm(c, "payments", {
            teacher_id: row.teacher_id,
            month: financeMonth,
          }),
        ),
      );
    tr.append(ops);
    table.append(tr);
  }
  panel.append(table);
  c.append(panel);
}
function payrollDetail(row, lessons) {
  const { panel } = drawer(row.teacher_name + " · 月度课酬");
  for (const l of lessons) {
    const section = el("section", null, { class: "panel" });
    section.append(
      el(
        "strong",
        l.start_at.slice(0, 16).replace("T", " ") + " · " + l.course_name,
      ),
      el(
        "p",
        "单价 " +
          fmt.money(l.rate) +
          " × " +
          l.quantity +
          " · " +
          {
            legacy: "旧版按课时",
            unit: "按课时",
            lesson: "按课次",
            person: "按人次",
          }[l.rate_basis] +
          " = " +
          fmt.money(l.amount),
      ),
    );
    if (l.rounding_note)
      section.append(el("p", l.rounding_note, { class: "muted" }));
    if (enabled("teacher_pay", "update"))
      section.append(
        button("单课课酬覆盖", async () => {
          const data = (await api("data/lessons/" + l.id)).record,
            { panel: target, close } = drawer("单课课酬覆盖"),
            form = el("form"),
            op = operation();
          field(
            form,
            "单价（元，清空恢复标准）",
            "override_rate",
            "number",
            l.rate,
            false,
          ).step = ".01";
          selectField(
            form,
            "计费方式",
            "override_basis",
            [
              { id: "legacy", name: "旧版按课时" },
              { id: "unit", name: "按课时" },
              { id: "lesson", name: "按课次" },
              { id: "person", name: "按人次" },
            ],
            l.rate_basis,
          );
          submit(form, "保存", async (d) => {
            await api("finance/lessons/" + l.id + "/rate", "POST", {
              operation_id: op,
              version: data.version,
              override_rate:
                d.override_rate === "" ? null : Number(d.override_rate),
              override_basis: d.override_basis,
            });
            close();
            notice("覆盖已保存，重新查看月度数据", "success");
          });
          target.append(form);
        }),
      );
    panel.append(section);
  }
}
async function settlementForm(c) {
  const record = (await api("finance/settlement?month=" + financeMonth)).record,
    { panel, close } = drawer(financeMonth + " 月度结算");
  panel.append(
    el(
      "p",
      "状态：" +
        { draft: "未提交", pending: "待主管批准", locked: "已锁定" }[
          record.status
        ],
    ),
  );
  const run = async (action, reason = "") => {
    await api("finance/settlements/" + action, "POST", {
      month: financeMonth,
      version: record.version,
      reason,
      operation_id: operation(),
    });
    close();
    await financePage(c);
  };
  if (enabled("settlements", "submit") && !record.locked)
    panel.append(button("财务提交审批", () => run("submit"), "primary"));
  if (enabled("settlements", "approve") && record.status === "pending")
    panel.append(button("主管批准并锁月", () => run("approve"), "primary"));
  if (
    me.user.roles.includes("supervisor") &&
    (record.locked || record.status === "pending")
  ) {
    const form = el("form");
    field(
      form,
      record.locked ? "解锁原因（必填）" : "退回原因（必填）",
      "reason",
    );
    submit(form, record.locked ? "主管解锁" : "退回财务", (d) =>
      run(record.locked ? "unlock" : "reject", d.reason),
    );
    panel.append(form);
  }
  panel.append(
    el(
      "p",
      "提交后本月结算数据或缺勤规则变化需要财务重新提交；其他月份、档案和课酬付款不影响审批。解锁后教师课酬回到未确认，再次锁定仍走提交和批准。",
      { class: "muted" },
    ),
  );
}
async function financeRecords(c, kind, offset = 0) {
  const labels = {
      rates: "课酬标准",
      payments: "课酬付款",
      adjustments: "课酬调整",
      costs: "其他成本",
    },
    module = kind === "costs" ? "settlements" : "teacher_pay",
    page = await api("finance/" + kind + "?offset=" + offset);
  c.replaceChildren(el("h1", labels[kind]));
  const tools = el("div", null, { class: "row" });
  if (enabled(module, "create"))
    tools.append(
      button("＋ 新增", () => financeRecordForm(c, kind), "primary"),
    );
  tools.append(button("月度课酬", () => financePage(c)));
  c.append(tools);
  const section = el("section", null, { class: "panel credit-table" }),
    table = el("table");
  const head = el("tr");
  for (const label of [
    "教师 / 类别",
    "课程 / 月份 / 日期",
    "金额（元）",
    "计费方式 / 原因 / 备注",
    "生效期间 / 付款日期",
    "操作",
  ])
    head.append(el("th", label));
  table.append(head);
  for (const row of page.items) {
    const tr = el("tr");
    for (const value of [
      row.teacher_name || row.teacher_id || row.category,
      row.course_name || row.month || row.date,
      fmt.moneyCell(row.rate ?? row.amount),
      row.rate_basis
        ? {
            legacy: "旧版按课时",
            unit: "按课时",
            lesson: "按课次",
            person: "按人次",
          }[row.rate_basis]
        : row.reason || row.note,
      row.effective_from
        ? row.effective_from + " — " + row.effective_to
        : row.paid_at || "",
    ])
      tr.append(el("td", String(value ?? "")));
    const ops = el("td");
    if (enabled(module, "update"))
      ops.append(button("编辑", () => financeRecordForm(c, kind, row)));
    if (enabled(module, "delete"))
      ops.append(
        button("删除", async () => {
          if (!(await ask("删除该记录？已锁定月份需要主管先解锁。"))) return;
          await api("finance/" + kind + "/" + row.id, "DELETE", {
            version: row.version,
            operation_id: operation(),
          });
          await financeRecords(c, kind, offset);
        }),
      );
    tr.append(ops);
    table.append(tr);
  }
  section.append(table);
  if (!page.items.length)
    section.append(el("p", "暂无记录", { class: "muted" }));
  c.append(section);
  if (offset)
    c.append(
      button("上一页", () =>
        financeRecords(c, kind, Math.max(0, offset - 200)),
      ),
    );
  if (page.next_offset !== null)
    c.append(button("下一页", () => financeRecords(c, kind, page.next_offset)));
}
async function financeRecordForm(c, kind, row = {}) {
  const { panel, close } = drawer(
      {
        rates: "课酬标准",
        payments: "登记课酬付款",
        adjustments: "课酬调整",
        costs: "其他成本",
      }[kind],
    ),
    form = el("form"),
    op = operation();
  if (kind !== "costs")
    selectField(
      form,
      "教师",
      "teacher_id",
      await choices("teachers"),
      row.teacher_id,
    ).disabled = !!row.id;
  if (kind === "rates") {
    selectField(
      form,
      "课程",
      "course_type_id",
      await choices("course_types"),
      row.course_type_id,
    ).disabled = !!row.id;
    selectField(
      form,
      "计费模式",
      "rate_basis",
      [
        { id: "legacy", name: "旧版按课时（兼容历史）" },
        { id: "unit", name: "按课时" },
        { id: "lesson", name: "按课次" },
        { id: "person", name: "按人次" },
      ],
      row.rate_basis || "unit",
    );
    field(form, "单价（元）", "rate", "number", row.rate ?? 0).step = ".01";
    field(
      form,
      "生效开始",
      "effective_from",
      "date",
      row.effective_from || financeMonth + "-01",
    );
    field(
      form,
      "生效结束",
      "effective_to",
      "date",
      row.effective_to || "2099-12-31",
    );
  } else {
    if (kind === "costs") {
      field(
        form,
        "发生日期",
        "date",
        "date",
        row.date ||
          new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" }),
      );
      // 成本类别用下拉选，不让手打（同一类不会写成好几种叫法，报表才能按类汇总）。
      const COST_TYPES = ["房租", "水电", "物业", "网络通讯", "教材", "办公耗材", "宣传推广", "维修", "人员（非课酬）", "其他"];
      const types = [...COST_TYPES];
      if (row.category && !types.includes(row.category)) types.unshift(row.category);
      selectField(form, "成本类别", "category", types.map((x) => ({ id: x, name: x })), row.category || "");
    } else field(form, "归属月份", "month", "month", row.month || financeMonth);
    field(form, "金额（元）", "amount", "number", row.amount ?? "").step =
      ".01";
    if (kind === "payments")
      field(
        form,
        "付款日期",
        "paid_at",
        "date",
        row.paid_at ||
          new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" }),
      );
    field(
      form,
      kind === "adjustments" ? "调整原因（必填）" : "备注",
      kind === "adjustments" ? "reason" : "note",
      "text",
      row.reason || row.note || "",
      kind === "adjustments",
    );
  }
  submit(form, "确认保存", async (d) => {
    for (const key of ["rate", "amount"]) if (key in d) d[key] = Number(d[key]);
    await api(
      "finance/" + kind + (row.id ? "/" + row.id : ""),
      row.id ? "PATCH" : "POST",
      { ...d, ...(row.id ? { version: row.version } : {}), operation_id: op },
    );
    close();
    await financeRecords(c, kind);
  });
  panel.append(form);
}
async function reportsPage(c) {
  const data = await api("finance/report?month=" + financeMonth);
  c.replaceChildren(el("h1", "统计报表"));
  monthTools(c, () => reportsPage(c));
  const tools = el("div", null, { class: "row" });
  if (enabled("exports", "export"))
    tools.append(exportLink("report"), exportLink("lessons", "导出课程记录"));
  c.append(tools);
  const cards = el("div", null, { class: "row" });
  for (const [key, label] of [
    ["lesson_count", "本月课次"],
    ["participant_count", "参与人次"],
    ["tuition_amount", "学费实收"],
    ["teacher_pay_amount", "教师课酬"],
    ["cost_amount", "其他成本"],
    ["profit_amount", "利润估算"],
  ])
    if (key in data) {
      const card = el("section", null, { class: "panel" });
      card.append(
        el("small", label),
        el(
          "h2",
          key.endsWith("_amount") ? fmt.money(data[key]) : String(data[key]),
        ),
      );
      cards.append(card);
    }
  c.append(cards);
  for (const [k, label] of [
    ["teachers", "教师统计"],
    ["courses", "课程统计"],
    ["students", "学员统计"],
  ]) {
    const panel = el("section", null, { class: "panel credit-table" }),
      table = el("table");
    panel.append(el("h2", label));
    const head = el("tr");
    for (const name of [
      "名称",
      "课次",
      "课时",
      ...(data[k].some((r) => "teacher_pay_amount" in r)
        ? ["课酬分摊（元）"]
        : []),
    ])
      head.append(el("th", name));
    table.append(head);
    for (const row of data[k]) {
      const tr = el("tr");
      for (const val of [
        row.name,
        row.lesson_count,
        row.units,
        ...("teacher_pay_amount" in row
          ? [fmt.moneyCell(row.teacher_pay_amount)]
          : []),
      ])
        tr.append(el("td", String(val)));
      table.append(tr);
    }
    panel.append(table);
    c.append(panel);
  }
}

// 第五阶段：个人端只收集输入与展示；仍使用同一机构 API、can 和 repo。
const cnLesson = (status) => me.labels.lessons[status] || "未知状态";
const cnReview = (status) => me.labels.reviews[status] || "未提交";
const cnAttendance = (status) => me.labels.attendance[status] || "未登记";
const todayBJ = () =>
  new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
const dateShift = (date, n) =>
  new Date(Date.parse(date + "T12:00:00Z") + n * 86400000)
    .toISOString()
    .slice(0, 10);
function weekStart(date) {
  const d = new Date(date + "T12:00:00Z");
  return dateShift(date, -((d.getUTCDay() + 6) % 7));
}
function moneyText(value) {
  return fmt.money(value).replace(/^¥/, "");
}
function textArea(form, label, name, value = "", max = 4000) {
  const wrap = el("label", null, { class: "field" }),
    input = el("textarea", null, { name, rows: "4", maxlength: String(max) });
  input.value = value;
  wrap.append(el("span", label), input);
  form.append(wrap);
  return input;
}
function card(title, sub = "") {
  const section = UI.card(title, sub);
  section.classList.add("panel", "mobile-card");
  return section;
}
let personalDate = todayBJ(),
  personalMonth = todayBJ().slice(0, 7),
  personalTab = "课表";
function personalShell() {
  root.replaceChildren();
  const frame = el("div", null, { class: "personal-frame" }),
    head = el("header", null, { class: "personal-header" }),
    identity = el("div");
  identity.append(el("strong", me.user.name), el("small", brand.display_name));
  head.append(mark(), identity);
  const content = el("section", null, { class: "personal-content" }),
    nav = el("nav", null, { class: "personal-nav", "aria-label": "个人导航" }),
    teacher = me.user.roles.includes("teacher");
  const views = teacher
    ? [
        ["课表", () => personalSchedule(content)],
        ["我的课程", () => personalRecords(content)],
        ["课酬", () => personalPay(content)],
        ["我的", () => personalProfile(content)],
      ]
    : [
        ["课表", () => personalSchedule(content)],
        ["上课记录", () => personalRecords(content)],
        ["课时缴费", () => personalCredits(content)],
        ["我的", () => personalProfile(content)],
      ];
  const availableViews = views.filter(
    ([label]) =>
      (label !== "课酬" || enabled("teacher_pay")) &&
      (!["课表", "我的课程", "上课记录"].includes(label) ||
        enabled("schedule")),
  );
  const select = async (label, fn) => {
    personalTab = label;
    for (const b of nav.querySelectorAll("button"))
      b.setAttribute(
        "aria-current",
        b.textContent === label ? "page" : "false",
      );
    content.replaceChildren(el("p", "正在载入…"));
    await fn();
  };
  for (const [label, fn] of availableViews)
    nav.append(button(label, () => select(label, fn)));
  frame.append(head, content, nav);
  root.append(frame);
  if (me.user.must_change) {
    changePassword(content, true);
    nav.hidden = true;
    return;
  }
  const initial =
    availableViews.find((v) => v[0] === personalTab) || availableViews[0];
  select(...initial).catch((e) => notice(e.message));
}
async function scheduleRows(from, to) {
  const items = [];
  for (let offset = 0; offset < 5000; offset += 200) {
    const page = await api(
      "schedule?from=" + from + "&to=" + to + "&offset=" + offset,
    );
    items.push(...page.items);
    if (page.next_offset === null) return items;
  }
  throw Error("课程过多，请缩小查询范围");
}
function personalCourse(c, row, back, record = false) {
  const node = button(
    "",
    () =>
      row.source_course_id
        ? personalPartner(c, row, back)
        : reviewScreen(c, row.id, back),
    "personal-course",
  );
  node.append(
    el("small", row.start_at.slice(0, 10) + " " + row.start_at.slice(11, 16)),
    el("strong", row.course_name),
    el(
      "span",
      (row.teacher_name || "") +
        " · " +
        (row.mode === "online" ? "线上课" : row.location_name || "待定地点"),
    ),
    el(
      "span",
      row.source_course_id
        ? partnerLabel(row)
        : record &&
            (row.own_attendance === "planned" ||
              (!row.own_attendance && row.status === "planned"))
          ? "待销课"
          : row.own_attendance === "planned"
            ? cnLesson(row.status)
            : row.own_attendance
              ? cnAttendance(row.own_attendance) +
                " · 扣" +
                row.own_deducted +
                "课时"
              : cnLesson(row.status),
      { class: "status-tag" },
    ),
  );
  if (row.review_status) node.append(el("small", cnReview(row.review_status)));
  return node;
}
async function personalSchedule(c) {
  const from = weekStart(personalDate),
    to = dateShift(from, 6),
    items = await scheduleRows(from, to);
  c.replaceChildren(el("h1", "我的课表"));
  const tools = el("div", null, { class: "row mobile-tools" });
  tools.append(
    button("上周", () => {
      personalDate = dateShift(personalDate, -7);
      return personalSchedule(c);
    }),
    el("span", from + " — " + to),
    button("下周", () => {
      personalDate = dateShift(personalDate, 7);
      return personalSchedule(c);
    }),
  );
  c.append(tools);
  const weeks = el("div", null, { class: "week-strip" });
  for (let i = 0; i < 7; i++) {
    const date = dateShift(from, i),
      b = button(
        ["一", "二", "三", "四", "五", "六", "日"][i] + "\n" + date.slice(8),
        () => {
          personalDate = date;
          return personalSchedule(c);
        },
      );
    b.setAttribute("aria-current", date === personalDate ? "date" : "false");
    weeks.append(b);
  }
  c.append(weeks);
  const upcoming = (await api("schedule-next")).record;
  if (upcoming) {
    const next = card(
      "下一节课",
      upcoming.start_at.slice(0, 16).replace("T", " "),
    );
    next.append(personalCourse(c, upcoming, () => personalSchedule(c)));
    c.append(next);
  }
  const dayItems = items.filter(
    (l) => l.start_at.slice(0, 10) === personalDate,
  );
  c.append(el("h2", personalDate + " · " + dayItems.length + "节课"));
  for (const row of dayItems)
    c.append(personalCourse(c, row, () => personalSchedule(c)));
  if (!dayItems.length) c.append(el("p", "当天暂无课程", { class: "empty" }));
  c.append(
    button("本周全部课程", () => {
      const p = card("本周课程");
      for (const row of items)
        p.append(personalCourse(c, row, () => personalSchedule(c)));
      c.append(p);
    }),
    ...(enabled("exports", "export")
      ? [button("保存机构品牌课表图", () => timetableImage(c, from))]
      : []),
  );
}
function monthPicker(c, load) {
  const controls = el("nav", null, {
    class: "month-switch",
    "aria-label": "月份切换",
  });
  const shift = async (delta) => {
    for (const b of controls.querySelectorAll("button")) b.disabled = true;
    const date = new Date(
      Date.UTC(
        Number(personalMonth.slice(0, 4)),
        Number(personalMonth.slice(5, 7)) - 1 + delta,
        1,
      ),
    );
    personalMonth = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
    }).format(date);
    try {
      await load();
    } finally {
      for (const b of controls.querySelectorAll("button")) b.disabled = false;
    }
  };
  controls.append(
    button("上月", () => shift(-1)),
    el(
      "strong",
      Number(personalMonth.slice(0, 4)) +
        "年" +
        Number(personalMonth.slice(5, 7)) +
        "月",
      { "aria-live": "polite" },
    ),
    button("下月", () => shift(1)),
  );
  c.append(controls);
}
async function personalRecords(c) {
  c.replaceChildren(
    el("h1", me.user.roles.includes("teacher") ? "我的课程" : "上课记录"),
  );
  monthPicker(c, () => personalRecords(c));
  const from = personalMonth + "-01",
    end = new Date(
      Date.UTC(
        Number(personalMonth.slice(0, 4)),
        Number(personalMonth.slice(5, 7)),
        0,
      ),
    )
      .toISOString()
      .slice(0, 10),
    items = (await scheduleRows(from, end)).filter(
      (row) =>
        !me.user.roles.includes("student") ||
        Date.parse(row.start_at.slice(0, 16) + ":00+08:00") <= Date.now(),
    );
  for (const row of items.filter((x) => !x.source_course_id)) {
    const entry = personalCourse(
      c,
      row,
      () => personalRecords(c),
      me.user.roles.includes("student"),
    );
    if (me.user.roles.includes("student")) {
      for (const text of [
        row.public_text,
        row.private_comment,
        row.homework ? "作业：" + row.homework : "",
      ])
        if (text) entry.append(el("p", text, { class: "preserve-text" }));
    }
    c.append(entry);
  }
  if (!items.length) c.append(el("p", "本月暂无记录", { class: "empty" }));
  if (me.user.roles.includes("student") && enabled("attendance"))
    c.append(button("查看请假补课关联记录", () => creditPage(c, "makeups")));
}
async function reviewScreen(c, id, back) {
  const data = await api("lessons/" + id + "/review"),
    l = data.lesson,
    teacher = me.user.roles.includes("teacher"),
    student = me.user.roles.includes("student");
  c.__reviewSnapshot = data;
  data.participants.sort(
    (a, b) => a.name.localeCompare(b.name, "zh-CN") || a.id.localeCompare(b.id),
  );
  const order = new Map(data.participants.map((p, index) => [p.id, index]));
  data.people.sort(
    (a, b) =>
      (order.get(a.participant_id) ?? Infinity) -
      (order.get(b.participant_id) ?? Infinity),
  );
  c.replaceChildren(button("‹ 返回", back), el("h1", "课程详情"));
  const summary = card(
    l.course_name,
    l.start_at.slice(0, 16).replace("T", " ") +
      " · " +
      l.duration +
      "分钟 · " +
      l.units +
      "课时",
  );
  summary.append(
    el("p", l.teacher_name + " · " + (l.location_name || "线上课")),
    el("p", cnLesson(l.status)),
  );
  c.append(summary);
  const attendance = card(
    student ? "我的出勤" : "学员出勤",
    student ? "仅显示本人的记录" : data.participants.length + "人",
  );
  for (const p of data.participants)
    attendance.append(
      el(
        "p",
        p.name +
          " · " +
          cnAttendance(p.attendance) +
          (student ? " · 扣 " + p.deducted + "课时" : ""),
      ),
    );
  c.append(attendance);
  if (typeof yxReviewPersonal === "function") yxReviewPersonal(c, data);
  const comments = card("已确认点评与作业");
  if (!data.published.length) comments.append(el("p", "暂无已确认点评"));
  for (const p of data.published) {
    const name = p.student_id
      ? data.participants.find((x) => x.student_id === p.student_id)?.name ||
        "我的点评"
      : "全班公共内容";
    comments.append(
      el("h3", name),
      el("p", p.text || "暂无内容", { class: "preserve-text" }),
    );
    if (p.homework)
      comments.append(
        el("p", "作业：" + p.homework, { class: "preserve-text" }),
      );
  }
  if (enabled("comments")) c.append(comments);
  if (data.submission) {
    const pending = card(
      cnReview(data.submission.status) +
        (data.submission.kind === "comments" ? " · 点评修订" : " · 出勤与点评"),
    );
    pending.append(
      el(
        "p",
        data.submission.reason ||
          (data.submission.status === "confirmed"
            ? data.submission.kind === "comments"
              ? "已确认，本次点评修订已生效，不改变出勤、课时和课酬。"
              : "已确认，出勤已按机构规则生效。"
            : data.submission.status === "returned"
              ? "已退回，本次提交未生效；请在提交窗口内修改后重新提交。"
              : data.submission.status === "superseded"
                ? "此提交已有更新版本，请查看最新记录。"
                : data.submission.kind === "comments"
                  ? "点评修订待确认，不改变出勤、课时和课酬；学员继续查看上一份已确认点评。"
                  : "待确认不扣课、不计酬；点评确认后向学员公开。"),
      ),
    );
    for (const p of data.people) {
      const name =
        data.participants.find((x) => x.id === p.participant_id)?.name ||
        "学员";
      pending.append(
        el(
          "p",
          [name, cnAttendance(p.attendance), p.comment]
            .filter(Boolean)
            .join(" · "),
          { class: "preserve-text" },
        ),
      );
    }
    pending.append(
      el("p", data.submission.public_text || "", { class: "preserve-text" }),
      el(
        "p",
        data.submission.homework ? "作业：" + data.submission.homework : "",
      ),
    );
    c.append(pending);
    if (data.can_review && data.submission.status === "pending") {
      pending.append(
        button(
          "确认并生效",
          async () => {
            if (
              !(await ask(
                "确认后按机构缺勤规则扣课、计酬并向学员公开点评；点评修订仅更新点评。锁定月份需先解锁。",
              ))
            )
              return;
            await api(
              "submissions/" + data.submission.id + "/confirm",
              "POST",
              { operation_id: operation(), version: data.submission.version },
            );
            await reviewScreen(c, id, back);
          },
          "primary",
        ),
        button("退回", async () => {
          const reason = await requestReason("请填写退回原因");
          if (!reason) return;
          await api("submissions/" + data.submission.id + "/return", "POST", {
            operation_id: operation(),
            version: data.submission.version,
            reason,
          });
          await reviewScreen(c, id, back);
        }),
      );
    }
  }
  if (teacher && (data.can_submit_attendance || data.can_submit_comments)) {
    const kind = data.can_submit_attendance ? "attendance" : "comments",
      form = el("form"),
      draft =
        data.submission &&
        ["pending", "returned"].includes(data.submission.status) &&
        data.submission.kind === kind
          ? data.submission
          : null,
      pub = data.published.find((x) => !x.student_id);
    form.append(
      el("h2", kind === "attendance" ? "提交出勤与点评" : "提交点评修订"),
    );
    if (kind === "comments")
      form.append(
        el(
          "p",
          "出勤已经确认，教师不能更改。新点评确认前，学员继续看到上一版本。",
        ),
      );
    const commenting = enabled("comments", "create");
    if (commenting) {
      textArea(
        form,
        "全班课堂内容与公共点评",
        "public_text",
        draft?.public_text ?? pub?.text ?? "",
        6000,
      );
      textArea(
        form,
        "全班作业",
        "homework",
        draft?.homework ?? pub?.homework ?? "",
      );
    }
    const controls = data.participants.map((p) => {
      const v = draft
        ? data.people.find((x) => x.participant_id === p.id)
        : null;
      const input =
        kind === "attendance"
          ? selectField(
              form,
              p.name + " · 出勤",
              p.id,
              Object.entries(me.labels.attendance)
                .filter(([id]) => id !== "planned")
                .map(([id, name]) => ({ id, name })),
              v?.attendance || "attended",
            )
          : null;
      const comment = commenting
        ? textArea(
            form,
            p.name + " · 逐人点评",
            "comment_" + p.id,
            v?.comment ??
              data.published.find((x) => x.student_id === p.student_id)?.text ??
              "",
          )
        : { value: "" };
      return { p, input, comment };
    });
    const op = operation();
    submit(form, "提交，等待教务确认", async (d) => {
      await api("lessons/" + id + "/review", "POST", {
        operation_id: op,
        kind,
        previous_id: data.submission?.id || null,
        previous_version: data.submission?.version,
        comment_fingerprint: data.comment_fingerprint,
        public_text: d.public_text,
        homework: d.homework,
        people: controls.map(({ p, input, comment }) => ({
          participant_id: p.id,
          student_id: p.student_id,
          attendance: input?.value || p.attendance,
          comment: comment.value,
        })),
      });
      await reviewScreen(c, id, back);
    });
    c.append(form);
  } else if (teacher)
    c.append(
      el(
        "p",
        "出勤提交须由主讲教师在课程开始至结束后48小时内操作，并由主管开启自助提交。已确认出勤请联系教务更正。",
        { class: "impact-note" },
      ),
    );
  if (data.can_correct_comments) {
    const form = el("form"),
      pub = data.published.find((x) => !x.student_id);
    form.append(el("h2", "员工更正点评"));
    textArea(form, "全班公共点评", "public_text", pub?.text || "", 6000);
    textArea(form, "作业", "homework", pub?.homework || "");
    const fields = data.participants.map((p) => ({
      p,
      input: textArea(
        form,
        p.name + " · 点评",
        "staff_" + p.id,
        data.published.find((x) => x.student_id === p.student_id)?.text || "",
      ),
    }));
    submit(form, "保存点评更正并留审计", async (d) => {
      await api("lessons/" + id + "/comments", "PUT", {
        operation_id: operation(),
        comment_fingerprint: data.comment_fingerprint,
        public_text: d.public_text,
        homework: d.homework,
        people: fields.map(({ p, input }) => ({
          participant_id: p.id,
          student_id: p.student_id,
          comment: input.value,
        })),
      });
      await reviewScreen(c, id, back);
    });
    c.append(form);
  }
}
async function personalPay(c) {
  const data = await api("finance/payroll?month=" + personalMonth);
  c.replaceChildren(el("h1", "我的课酬"));
  monthPicker(c, () => personalPay(c));
  const row = data.items[0],
    summary = card(
      personalMonth + " 应计课酬",
      data.locked ? "已确认" : "未确认",
    );
  if (row) {
    summary.append(
      el("strong", "¥" + moneyText(row.total_amount), { class: "big-money" }),
    );
    for (const [label, key] of [
      ["应计", "accrued_amount"],
      ["调整", "adjustment_amount"],
      ["已付", "paid_amount"],
      ["未付", "unpaid_amount"],
    ])
      summary.append(el("p", label + " ¥" + moneyText(row[key])));
  } else summary.append(el("p", "本月暂无课酬记录"));
  c.append(summary);
  const today = todayBJ();
  const future = data.lessons.filter(
    (entry) => entry.start_at.slice(0, 10) > today,
  );
  for (const entry of data.lessons.filter(
    (entry) => entry.start_at.slice(0, 10) <= today,
  )) {
    const p = card(
      entry.course_name,
      entry.start_at.slice(0, 16).replace("T", " "),
    );
    if (entry.status === "planned") {
      p.classList.add("pay-pending");
      p.append(
        el("p", "待销课，不计酬", { class: "pay-pending-label" }),
        el("p", entry.units + "课时"),
      );
      c.append(p);
      continue;
    }
    p.append(
      el("p", cnLesson(entry.status) + " · " + entry.units + "课时"),
      el(
        "p",
        "单价 ¥" +
          moneyText(entry.rate) +
          "/" +
          (me.labels.rate_units[entry.rate_basis] || "计费单位") +
          " · 计酬 " +
          entry.quantity +
          (me.labels.rate_units[entry.rate_basis] || "") +
          " · 应计 ¥" +
          moneyText(entry.amount),
      ),
    );
    if (entry.rounding_note) p.append(el("small", entry.rounding_note));
    c.append(p);
  }
  if (future.length)
    c.append(
      el("p", "本月还有 " + future.length + " 节待上课", {
        class: "impact-note future-pay-summary",
      }),
    );
  const p = card("付款记录");
  for (const row of data.payments)
    p.append(el("p", row.paid_at + " · ¥" + moneyText(row.amount)));
  c.append(p);
  if (data.adjustments.length) {
    const adjustments = card("课酬调整明细");
    for (const row of data.adjustments)
      adjustments.append(
        el("p", "¥" + moneyText(row.amount) + " · " + row.reason),
      );
    c.append(adjustments);
  }
}
async function personalCredits(c) {
  c.replaceChildren(el("h1", "课时与缴费"));
  if (enabled("packages")) {
    for (const kind of ["packages", "transactions"]) {
      const page = await api("credits/" + kind),
        p = card(kind === "packages" ? "课时包余额" : "课时变动");
      for (const row of page.items) {
        if (kind === "packages") {
          p.append(
            el("h3", row.course_name || "课时包"),
            el("p", row.balance + " / " + row.units_total + "课时"),
            el("small", "有效期至 " + (row.valid_to || "不限")),
          );
        } else
          p.append(
            el(
              "p",
              row.date +
                " · " +
                {
                  purchase: "购买",
                  consume: "销课",
                  reversal: "回补",
                  adjustment: "调整",
                  transfer_in: "转入",
                  transfer_out: "转出",
                }[row.type] +
                " · " +
                (row.delta > 0 ? "+" : "") +
                row.delta +
                "课时",
            ),
          );
      }
      if (!page.items.length) p.append(el("p", "暂无记录"));
      if (page.next_offset !== null)
        p.append(button("查看全部记录", () => creditPage(c, kind)));
      c.append(p);
    }
  }
  if (enabled("tuition")) {
    const page = await api("credits/payments"),
      p = card("缴费记录");
    for (const row of page.items)
      p.append(
        el(
          "p",
          row.paid_at +
            " · ¥" +
            moneyText(row.amount) +
            " · " +
            (row.method || "已登记"),
        ),
      );
    if (!page.items.length) p.append(el("p", "暂无记录"));
    if (page.next_offset !== null)
      p.append(button("查看全部缴费", () => creditPage(c, "payments")));
    c.append(p);
  }
  if (!enabled("packages") && !enabled("tuition"))
    c.append(el("p", "机构暂未开放此页内容，请联系教务。"));
}
function personalProfile(c) {
  c.replaceChildren(
    el("h1", "我的"),
    el("p", me.user.name + " · " + brand.display_name),
  );
  profile(c);
  c.prepend(el("p", me.user.name + " · " + brand.display_name));
  c.append(
    button("退出登录", async () => {
      await api("logout", "POST", {});
      location.assign(base + "login");
    }),
  );
}
async function submissionQueue(c, filter = "pending", offset = 0) {
  const month = todayBJ().slice(0, 7),
    from = month + "-01",
    to = new Date(
      Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0),
    )
      .toISOString()
      .slice(0, 10);
  c.replaceChildren(el("h1", "教师提交审核"));
  const tools = el("div", null, { class: "row" });
  for (const [value, label] of [
    ["pending", "待确认"],
    ["returned", "已退回"],
    ["overdue", "已过窗口仍未提交"],
  ])
    tools.append(button(label, () => submissionQueue(c, value)));
  c.append(tools);
  const form = el("form");
  field(form, "起始日期", "from", "date", from);
  field(form, "截止日期", "to", "date", to);
  const load = async (a, b, page = 0) => {
    const result = await api(
      "submissions?status=" +
        filter +
        "&from=" +
        a +
        "&to=" +
        b +
        "&offset=" +
        page,
    );
    list.replaceChildren();
    for (const row of result.items) {
      const p = card(
        row.course_name,
        row.start_at.slice(0, 16).replace("T", " ") + " · " + row.teacher_name,
      );
      p.append(
        el(
          "p",
          filter === "overdue" ? "已过窗口仍未提交" : cnReview(row.status),
        ),
        button("查看与处理", () =>
          reviewScreen(c, row.lesson_id, () => submissionQueue(c, filter)),
        ),
      );
      if (filter === "overdue")
        p.append(
          button("员工直接销课", () => lessonDetail(c, { id: row.lesson_id })),
        );
      list.append(p);
    }
    if (!result.items.length) list.append(el("p", "没有符合条件的课程"));
    if (result.next_offset !== null)
      list.append(button("下一页", () => load(a, b, result.next_offset)));
  };
  submit(form, "查询", (d) => load(d.from, d.to));
  const list = el("section");
  c.append(form, list);
  await load(from, to, offset);
}
async function staffTimetable(c) {
  c.replaceChildren(el("h1", "机构品牌课表图"));
  const form = el("form"),
    kind = selectField(
      form,
      "类型",
      "kind",
      [
        { id: "teacher", name: "教师" },
        { id: "student", name: "学员" },
      ],
      "teacher",
    ),
    person = selectField(form, "姓名", "person", await choices("teachers"));
  kind.addEventListener("change", async () => {
    const people = await choices(
      kind.value === "teacher" ? "teachers" : "students",
    );
    person.replaceChildren();
    for (const p of people)
      person.append(el("option", p.name, { value: p.id }));
  });
  field(form, "周起始日期", "from", "date", weekStart(todayBJ()));
  submit(form, "生成课表图", (d) =>
    timetableImage(
      c,
      d.from,
      (d.kind === "teacher" ? "teacher_id=" : "student_id=") +
        encodeURIComponent(d.person),
    ),
  );
  c.append(form);
}
async function timetableImage(c, from, query = "") {
  const data = await api(
      "brand-timetable?from=" + from + (query ? "&" + query : ""),
    ),
    canvas = document.createElement("canvas"),
    width = 1080;
  const pages = Math.max(1, Math.ceil(data.items.length / 50));
  const generated = todayBJ();
  let logo;
  if (brand.logo) {
    logo = new Image();
    logo.src = brand.logo;
    await logo.decode();
  }
  for (let page = 0; page < pages; page++) {
    const pageItems = data.items.slice(page * 50, (page + 1) * 50);
    const days = Array.from({ length: 7 }, (_, i) => {
      const date = dateShift(data.from, i);
      return {
        date,
        items: pageItems.filter((item) => item.start_at.slice(0, 10) === date),
      };
    }).filter((day) => pages === 1 || day.items.length);
    canvas.width = width;
    canvas.height =
      370 +
      days.reduce(
        (height, day) => height + 88 + Math.max(1, day.items.length) * 114,
        0,
      );
    const ctx = canvas.getContext("2d");
    const theme = brand.theme_color || "#2B4C7E";
    ctx.fillStyle = "#F4F2F7";
    ctx.fillRect(0, 0, width, canvas.height);
    ctx.fillStyle = theme;
    ctx.fillRect(0, 0, width, 150);
    ctx.fillStyle = "#fff";
    ctx.fillRect(40, 35, 80, 80);
    if (logo) {
      const scale = Math.min(72 / logo.naturalWidth, 72 / logo.naturalHeight);
      const w = logo.naturalWidth * scale,
        h = logo.naturalHeight * scale;
      ctx.drawImage(logo, 80 - w / 2, 75 - h / 2, w, h);
    } else {
      ctx.fillStyle = theme;
      ctx.font = "bold 48px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(brandInitial(), 80, 94);
      ctx.textAlign = "left";
    }
    ctx.fillStyle = "#fff";
    ctx.font = "bold 38px sans-serif";
    ctx.fillText(brand.display_name, 145, 87, 880);
    ctx.fillStyle = "#1E1A26";
    ctx.font = "bold 36px sans-serif";
    ctx.fillText(data.owner_name + " · 个人周课表", 40, 212, 1000);
    ctx.font = "25px sans-serif";
    ctx.fillStyle = "#6B6476";
    ctx.fillText(data.from + " — " + data.to + " · 北京时间", 40, 256, 1000);
    let y = 290;
    for (const day of days) {
      const height = 70 + Math.max(1, day.items.length) * 114;
      ctx.fillStyle = "#fff";
      ctx.fillRect(32, y, width - 64, height);
      ctx.fillStyle = theme;
      ctx.fillRect(32, y, 7, 56);
      ctx.font = "bold 30px sans-serif";
      ctx.fillText(
        new Intl.DateTimeFormat("zh-CN", {
          weekday: "long",
          timeZone: "Asia/Shanghai",
        }).format(new Date(day.date + "T00:00:00+08:00")) +
          "  " +
          day.date.slice(5),
        60,
        y + 40,
      );
      if (!day.items.length) {
        ctx.font = "27px sans-serif";
        ctx.fillStyle = "#6B6476";
        ctx.fillText("休息", 60, y + 112);
      }
      day.items.forEach((lesson, i) => {
        const top = y + 98 + i * 114;
        ctx.fillStyle = "#1E1A26";
        ctx.font = "bold 29px sans-serif";
        ctx.fillText(
          lesson.start_at.slice(11, 16) + "  " + lesson.course_name,
          60,
          top,
          950,
        );
        ctx.font = "24px sans-serif";
        ctx.fillStyle = "#6B6476";
        const teacher =
          lesson.teacher_name && lesson.teacher_name !== data.owner_name
            ? lesson.teacher_name
            : "";
        ctx.fillText(
          [
            lesson.duration + "分钟",
            teacher,
            lesson.location_name || "待定地点",
            lesson.source_course_id
              ? partnerLabel(lesson)
              : cnLesson(lesson.status),
          ]
            .filter(Boolean)
            .join(" · "),
          60,
          top + 39,
          950,
        );
      });
      y += height + 18;
    }
    ctx.fillStyle = "#6B6476";
    ctx.font = "23px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(
      brand.display_name +
        " · 生成于 " +
        generated +
        (pages > 1 ? " · " + (page + 1) + "/" + pages : ""),
      width / 2,
      canvas.height - 30,
      1000,
    );
    ctx.textAlign = "left";
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    if (!blob) throw Error("图片生成失败");
    const url = URL.createObjectURL(blob),
      panel = card(
        "机构品牌周课表图" +
          (pages > 1 ? "（第" + (page + 1) + "/" + pages + "张）" : ""),
        "长按图片保存；电脑可点击下载。",
      ),
      img = el("img", null, {
        src: url,
        alt: data.owner_name + "的机构品牌周课表",
        class: "timetable-image",
        loading: "lazy",
        decoding: "async",
      }),
      link = el("a", "下载图片", {
        href: url,
        download: "个人周课表" + (pages > 1 ? "-" + (page + 1) : "") + ".png",
        class: "button",
      });
    promoMediaUrls.add(url);
    panel.append(img, link);
    panel.append(
      button("关闭图片", () => {
        URL.revokeObjectURL(url);
        panel.remove();
      }),
    );
    c.append(panel);
    if (page === 0) img.scrollIntoView({ block: "start", behavior: "smooth" });
  }
}

// 第六阶段：资料、名单和金额仍只通过已有权限入口读取。
async function toolPage(kind, filter = null, offset = 0) {
  return api(
    "tools/" +
      kind +
      "?offset=" +
      offset +
      (filter
        ? "&" +
          (kind === "class_members" ? "class_id" : "student_id") +
          "=" +
          encodeURIComponent(filter)
        : ""),
  );
}
function pager(c, next, offset, load) {
  if (offset) c.append(button("上一页", () => load(Math.max(0, offset - 200))));
  if (next !== null) c.append(button("下一页", () => load(next)));
}
async function systemMessages(c, banner = false, offset = 0) {
  const data = await api("system-messages?offset=" + offset);
  const unread = document.querySelector(".c1-unread-badge");
  if (unread) {
    unread.textContent = String(data.unread_count || 0);
    unread.hidden = !data.unread_count;
  }
  c.replaceChildren();
  if (!banner) c.append(el("h1", "系统消息"));
  const rows = banner ? data.items.slice(0, 1) : data.items;
  for (const row of rows) {
    if (banner) {
      const line = el("div", null, { class: "system-banner" });
      line.append(
        el("strong", row.title),
        el("span", row.content, { class: "preserve-text" }),
      );
      if (!row.is_read)
        line.append(
          button("标记已读", async () => {
            await api("system-messages/" + row.id + "/read", "POST", {});
            await systemMessages(c, true);
          }),
        );
      c.append(line);
      continue;
    }
    const p = card(row.title, row.is_read ? "已读" : "未读");
    p.append(el("p", row.content, { class: "preserve-text" }));
    if (!row.is_read)
      p.append(
        button("标记已读", async () => {
          await api("system-messages/" + row.id + "/read", "POST", {});
          await systemMessages(c, banner, offset);
        }),
      );
    c.append(p);
  }
  if (!banner && !rows.length)
    c.append(el("p", "暂无系统消息", { class: "empty" }));
  if (!banner) {
    if (offset)
      c.append(button("上一页", () => systemMessages(c, false, offset - 200)));
    if (data.items.length === 200)
      c.append(button("下一页", () => systemMessages(c, false, offset + 200)));
  }
}
async function classesPage(c, offset = 0, selected = null) {
  const data = await toolPage("classes", null, offset);
  c.replaceChildren(el("h1", "班级与集训班"));
  if (enabled("classes", "create"))
    c.append(button("＋ 新建班级", () => classForm(c), "primary"));
  const tabs = el("div", null, { class: "class-tabs" });
  for (const row of data.items)
    tabs.append(
      button(
        row.name + " · " + (row.status === "active" ? "在读" : "归档"),
        () => classesPage(c, offset, row.id),
      ),
    );
  c.append(tabs);
  pager(c, data.next_offset, offset, (n) => classesPage(c, n));
  const current = data.items.find((x) => x.id === selected) || data.items[0];
  if (!current) {
    c.append(el("p", "暂无班级", { class: "empty" }));
    return;
  }
  const details = await api("tools/classes/" + current.id),
    members = details.members,
    p = card(
      current.name,
      current.date_from +
        " — " +
        current.date_to +
        " · " +
        members.length +
        "人",
    );
  c.append(p);
  if (enabled("classes", "update"))
    p.append(button("编辑班级", () => classForm(c, current)));
  const presets = {
    class_id: current.id,
    teacher_id: current.teacher_id,
    course_type_id: current.course_type_id,
    location_id: current.location_id,
    date_from: current.date_from,
    date_to: current.date_to,
    participants: members.map((m) => ({ student_id: m.student_id })),
  };
  if (enabled("lessons", "create") && current.status === "active")
    p.append(button("整班排课", () => lessonForm(c, presets)));
  if (enabled("templates", "create") && current.status === "active")
    p.append(
      button("每周固定课程", () =>
        recordForm(c, "schedule_templates", presets),
      ),
    );
  p.append(
    el(
      "p",
      "固定模板生成时读取班级当前名单；已生成课程保留当时名单。整班销课沿用课程详情中的出勤与销课流程。",
      { class: "muted" },
    ),
  );
  const grid = el("div", null, { class: "workbench-grid" }),
    roster = card("学员名单"),
    courses = card("本周固定课与课程");
  for (const member of members) {
    const line = el("div", null, { class: "row" });
    line.append(el("span", member.name));
    if (enabled("classes", "delete"))
      line.append(
        button("移出班级", async () => {
          if (!(await ask("只移出固定名单，历史课程不变，继续吗？"))) return;
          await api("tools/class_members/" + member.id, "DELETE", {
            version: member.version,
          });
          await classesPage(c, offset, current.id);
        }),
      );
    roster.append(line);
  }
  if (enabled("classes", "create"))
    roster.append(
      button("批量加入学员", async () => {
        const { panel, close } = drawer("批量加入班级"),
          f = el("form");
        for (const student of (await choices("students")).filter(
          (s) =>
            s.status === "active" &&
            !members.some((m) => m.student_id === s.id),
        )) {
          const label = el("label", student.name, { class: "switch-row" }),
            check = el("input", null, {
              type: "checkbox",
              name: "students",
              value: student.id,
            });
          label.append(check);
          f.append(label);
        }
        submit(f, "加入所选学员", async () => {
          const ids = [...f.querySelectorAll("input:checked")].map(
            (x) => x.value,
          );
          await api("tools/classes/" + current.id + "/members", "POST", {
            student_ids: ids,
          });
          close();
          await classesPage(c, offset, current.id);
        });
        panel.append(f);
      }),
    );
  if (enabled("classes", "create")) {
    const f = el("form");
    selectField(
      f,
      "添加学员",
      "student_id",
      (await choices("students")).filter(
        (s) =>
          s.status === "active" && !members.some((m) => m.student_id === s.id),
      ),
    );
    submit(f, "加入班级", async (d) => {
      await api("tools/class_members", "POST", {
        class_id: current.id,
        student_id: d.student_id,
      });
      await classesPage(c, offset, current.id);
    });
    roster.append(f);
  }
  if (enabled("templates")) {
    const templates = (await choices("schedule_templates")).filter(
      (t) => t.class_id === current.id,
    );
    courses.append(el("h3", "每周固定课"));
    for (const template of templates)
      courses.append(
        button(
          ["周一", "周二", "周三", "周四", "周五", "周六", "周日"][
            template.weekday
          ] +
            " " +
            template.start_time +
            " · " +
            template.date_from +
            " — " +
            template.date_to,
          () => recordForm(c, "schedule_templates", template),
          "course-line",
        ),
      );
    if (!templates.length)
      courses.append(el("p", "暂无本班固定模板", { class: "muted" }));
    if (enabled("templates", "create"))
      courses.append(
        button("生成本班课程", () => {
          const { panel, close } = drawer("生成本班课程"),
            f = el("form");
          field(
            f,
            "开始日期",
            "from",
            "date",
            todayBJ() > current.date_from ? todayBJ() : current.date_from,
          );
          field(f, "结束日期", "to", "date", current.date_to);
          submit(f, "校验冲突并生成", async (d) => {
            const result = await api("templates/generate", "POST", {
              ...d,
              class_id: current.id,
            });
            if (!result.committed) {
              notice("发现 " + result.conflicts.length + " 项冲突，本批未写入");
              return;
            }
            close();
            await classesPage(c, offset, current.id);
            notice(
              "已生成 " +
                result.generated +
                " 节，跳过重复 " +
                result.skipped +
                " 节",
            );
          });
          panel.append(f);
        }),
      );
  }
  courses.append(el("h3", "本周课程"));
  if (enabled("schedule")) {
    const lessons = (
      await scheduleRows(
        weekStart(todayBJ()),
        dateShift(weekStart(todayBJ()), 6),
      )
    ).filter((l) => l.class_id === current.id);
    for (const row of lessons)
      courses.append(
        button(
          row.start_at.slice(0, 16).replace("T", " ") +
            " · " +
            cnLesson(row.status),
          () => lessonDetail(c, row),
          "course-line",
        ),
      );
    if (!lessons.length)
      courses.append(el("p", "本周暂无已生成的班级课程", { class: "muted" }));
  }
  grid.append(roster, courses);
  c.append(grid);
}
async function classForm(c, row = {}) {
  const { panel, close } = drawer(row.id ? "编辑班级" : "新建班级"),
    f = el("form");
  field(f, "班级名称", "name", "text", row.name || "");
  selectField(
    f,
    "课程",
    "course_type_id",
    await choices("course_types"),
    row.course_type_id,
  );
  selectField(
    f,
    "主讲教师",
    "teacher_id",
    await choices("teachers"),
    row.teacher_id,
  );
  selectField(
    f,
    "教室（线上班可不选）",
    "location_id",
    await choices("locations"),
    row.location_id,
  ).required = false;
  field(f, "开始日期", "date_from", "date", row.date_from || todayBJ());
  field(
    f,
    "结束日期",
    "date_to",
    "date",
    row.date_to || dateShift(todayBJ(), 90),
  );
  selectField(
    f,
    "班级状态",
    "status",
    [
      { id: "active", name: "在读" },
      { id: "archived", name: "归档" },
    ],
    row.status || "active",
  );
  textArea(f, "备注", "note", row.note || "");
  submit(f, "保存班级", async (d) => {
    await api(
      "tools/classes" + (row.id ? "/" + row.id : ""),
      row.id ? "PATCH" : "POST",
      { ...d, version: row.version },
    );
    close();
    await classesPage(c, 0, row.id);
  });
  panel.append(f);
}
async function followupPage(c, studentId = null, offset = 0) {
  c.replaceChildren(el("h1", "教务跟进"));
  const names = new Map((await choices("students")).map((x) => [x.id, x.name]));
  const assignees = new Map(
    (await api("followup-assignees")).items.map((x) => [x.id, x.name]),
  );
  for (const [kind, title] of [
    ["followup_tasks", "跟进待办"],
    ["followup_notes", "沟通记录"],
    ["student_routines", "练习与日常安排"],
  ]) {
    const data = await toolPage(kind, studentId, offset),
      p = card(title);
    if (enabled("followup", "create"))
      p.append(
        button("＋ 新增" + title, () => followupForm(c, kind, studentId)),
      );
    for (const row of data.items) {
      const item = el("div", null, { class: "record-line" });
      item.append(
        el("strong", names.get(row.student_id) || "未关联学员"),
        el(
          "p",
          kind === "followup_tasks"
            ? row.due_date +
                " · " +
                row.title +
                " · " +
                (assignees.get(row.assignee_id) ||
                  row.legacy_owner ||
                  "待指派") +
                " · " +
                (row.done ? "已完成" : "待处理")
            : kind === "followup_notes"
              ? row.at.slice(0, 16).replace("T", " ") + " · " + row.content
              : ["周一", "周二", "周三", "周四", "周五", "周六", "周日"][
                  row.weekday
                ] +
                " " +
                row.time +
                " · " +
                row.content,
          { class: "preserve-text" },
        ),
      );
      if (enabled("followup", "update"))
        item.append(
          button("编辑", () => followupForm(c, kind, row.student_id, row)),
        );
      if (enabled("followup", "delete"))
        item.append(
          button("删除", async () => {
            if (!(await ask("确认删除这条跟进记录？"))) return;
            await api("tools/" + kind + "/" + row.id, "DELETE", {
              version: row.version,
            });
            await followupPage(c, studentId, offset);
          }),
        );
      p.append(item);
    }
    pager(p, data.next_offset, offset, (n) => followupPage(c, studentId, n));
    c.append(p);
  }
}
async function followupForm(c, kind, studentId, row = {}) {
  const { panel, close } = drawer("教务跟进"),
    f = el("form");
  selectField(
    f,
    kind === "followup_tasks" ? "学员（可不选）" : "学员",
    "student_id",
    await choices("students"),
    studentId,
  ).required = kind !== "followup_tasks";
  if (kind === "followup_notes") {
    field(
      f,
      "沟通时间（北京时间）",
      "at",
      "datetime-local",
      (row.at || todayBJ() + "T09:00").slice(0, 16),
    );
    textArea(f, "沟通内容", "content", row.content || "", 6000);
  } else if (kind === "followup_tasks") {
    field(f, "跟进事项", "title", "text", row.title || "");
    field(f, "截止日期", "due_date", "date", row.due_date || todayBJ());
    const assignees = (await api("followup-assignees")).items;
    selectField(f, "负责人", "assignee_id", assignees, row.assignee_id);
    selectField(
      f,
      "处理状态",
      "done",
      [
        { id: "0", name: "待处理" },
        { id: "1", name: "已完成" },
      ],
      String(row.done || 0),
    );
  } else {
    selectField(
      f,
      "星期",
      "weekday",
      ["周一", "周二", "周三", "周四", "周五", "周六", "周日"].map(
        (name, id) => ({ id, name }),
      ),
      row.weekday ?? 0,
    );
    field(f, "时间/时段（可填待通知）", "time", "text", row.time || "09:00");
    textArea(f, "活动内容", "content", row.content || "");
  }
  submit(f, "保存", async (d) => {
    await api(
      "tools/" + kind + (row.id ? "/" + row.id : ""),
      row.id ? "PATCH" : "POST",
      {
        ...d,
        version: row.version,
        done: d.done === "1",
        ...(d.weekday !== undefined ? { weekday: Number(d.weekday) } : {}),
      },
    );
    close();
    await followupPage(c, studentId);
  });
  panel.append(f);
}
async function leadsPage(c, offset = 0) {
  const data = await toolPage("leads", null, offset);
  c.replaceChildren(el("h1", "试听与招生线索"));
  if (enabled("leads", "create"))
    c.append(button("＋ 新增线索", () => leadForm(c), "primary"));
  const metrics = el("div", null, { class: "metrics-grid" }),
    enrolled = data.items.filter((x) => x.stage === "enrolled").length;
  for (const [label, n] of [
    ["本页线索", data.items.length],
    ["已试听", data.items.filter((x) => x.stage === "trial").length],
    ["已转正", enrolled],
    [
      "本页转化率",
      data.items.length
        ? Math.round((enrolled / data.items.length) * 100) + "%"
        : "—",
    ],
  ]) {
    const p = card(label);
    p.append(el("strong", String(n), { class: "metric-value" }));
    metrics.append(p);
  }
  c.append(metrics);
  const board = el("div", null, { class: "leads-board" });
  for (const [stage, name] of Object.entries(me.labels.lead_stages)) {
    const column = el("section", null, { class: "lead-column" });
    column.append(el("h2", name));
    for (const row of data.items.filter((x) => x.stage === stage)) {
      const p = card(row.name, row.source || "未填来源");
      p.append(
        el("p", row.phone || "未填手机"),
        el("p", "下次跟进：" + (row.next_followup || "未安排")),
        el("p", row.note, { class: "preserve-text" }),
      );
      if (row.trial_at)
        p.append(
          el("p", "试听：" + row.trial_at.slice(0, 16).replace("T", " ")),
        );
      if (!row.student_id && enabled("leads", "update"))
        p.append(button("跟进 / 编辑", () => leadForm(c, row)));
      if (
        !row.student_id &&
        enabled("students", "create") &&
        enabled("leads", "create")
      )
        p.append(
          button("转为正式学员", async () => {
            if (
              !(await ask(
                "将按线索资料新建独立学员档案，保留线索历史，继续吗？",
              ))
            )
              return;
            await api("tools/leads/" + row.id + "/convert", "POST", {
              version: row.version,
            });
            await leadsPage(c, offset);
          }),
        );
      column.append(p);
    }
    board.append(column);
  }
  c.append(board);
  pager(c, data.next_offset, offset, (n) => leadsPage(c, n));
}
async function leadForm(c, row = {}) {
  const { panel, close } = drawer(row.id ? "跟进线索" : "新增招生线索"),
    f = el("form");
  if (row.id && me.user.roles.includes("supervisor"))
    f.append(
      button("查看完整联系方式（留审计）", async () => {
        const contact = await api(
          "tools/leads/" + row.id + "/contact",
          "POST",
          {},
        );
        notice(
          "手机：" +
            (contact.phone || "未填写") +
            "；家长手机：" +
            (contact.parent_phone || "未填写"),
        );
      }),
    );
  field(f, "姓名", "name", "text", row.name || "");
  for (const [label, key] of [
    ["手机", "phone"],
    ["家长手机", "parent_phone"],
  ]) {
    const input = field(f, label, key, "tel", "", false);
    if (row.id)
      input.closest(".ui-field")?.append(
        el("p", "已有号码不显示；不改就留空", { class: "ui-field-hint" }),
      );
  }
  for (const [label, key] of [
    ["来源", "source"],
    ["年级", "grade"],
    ["专业方向", "direction"],
  ])
    field(f, label, key, "text", row[key] || "", false);
  selectField(
    f,
    "阶段",
    "stage",
    Object.entries(me.labels.lead_stages)
      .filter(([id]) => id !== "enrolled")
      .map(([id, name]) => ({ id, name })),
    row.stage || "new",
  );
  field(
    f,
    "下次跟进日期",
    "next_followup",
    "date",
    row.next_followup || "",
    false,
  );
  field(
    f,
    "试听时间（北京时间）",
    "trial_at",
    "datetime-local",
    (row.trial_at || "").slice(0, 16),
    false,
  );
  textArea(f, "跟进备注", "note", row.note || "", 6000);
  submit(f, "保存线索", async (d) => {
    if (row.id)
      for (const k of ["phone", "parent_phone"]) if (!d[k]) delete d[k];
    await api(
      "tools/leads" + (row.id ? "/" + row.id : ""),
      row.id ? "PATCH" : "POST",
      { ...d, version: row.version },
    );
    close();
    await leadsPage(c);
  });
  // 分组排版：试听时间的日期、时间并排占一整行。
  standardForm(
    f,
    {
      groups: [
        ["学员", ["name", "grade", "direction", "source"]],
        ["联系方式", ["phone", "parent_phone"]],
        ["跟进", ["stage", "next_followup", "trial_at", "note"]],
      ],
      wide: ["trial_at", "note"],
    },
    close,
  );
  panel.append(f);
}
async function referralsPage(c, studentId = null, offset = 0) {
  const data = await toolPage("referrals", studentId, offset);
  c.replaceChildren(
    el("h1", "合作升学服务"),
    el(
      "p",
      "仅在家长明确同意后登记推荐。提交资料仅包含姓名、年级、专业方向、升学意向及家长联系方式。",
    ),
  );
  if (enabled("referrals", "create"))
    c.append(
      button("登记同意并提交", () => referralForm(c, studentId), "primary"),
    );
  for (const row of data.items) {
    const p = card(
      row.name,
      { submitted: "已提交", received: "已接收", withdrawn: "已撤回" }[
        row.status
      ],
    );
    p.append(
      el(
        "p",
        [row.grade, row.direction, row.intention].filter(Boolean).join(" · "),
      ),
      el(
        "p",
        "同意人：" +
          row.consent_name +
          " · " +
          row.consent_at.slice(0, 16).replace("T", " ") +
          " · " +
          row.consent_method +
          " · 经办：" +
          row.consent_operator,
      ),
    );
    if (row.status === "submitted" && enabled("referrals", "update"))
      p.append(
        button("撤回", async () => {
          if (!(await ask("确认撤回本次推荐？"))) return;
          await api("tools/referrals/" + row.id, "PATCH", {
            version: row.version,
            status: "withdrawn",
          });
          await referralsPage(c, studentId, offset);
        }),
      );
    c.append(p);
  }
  pager(c, data.next_offset, offset, (n) => referralsPage(c, studentId, n));
}
async function referralForm(c, studentId) {
  const { panel, close } = drawer("家长同意与合作升学推荐"),
    f = el("form");
  selectField(f, "学员", "student_id", await choices("students"), studentId);
  textArea(f, "升学意向", "intention", "", 1000);
  field(f, "家长联系方式", "parent_phone", "tel");
  field(f, "同意人", "consent_name");
  field(
    f,
    "同意时间（北京时间）",
    "consent_at",
    "datetime-local",
    todayBJ() + "T09:00",
  );
  field(f, "同意方式", "consent_method");
  field(f, "经办人", "consent_operator", "text", me.user.name);
  submit(f, "确认提交", async (d) => {
    if (
      !(await ask(
        "确认已取得家长同意？上述五项资料和同意记录将提交至合作服务专用列表；不提交课时、缴费或点评。",
      ))
    )
      return;
    await api("tools/referrals", "POST", d);
    close();
    await referralsPage(c, studentId);
  });
  panel.append(f);
}
async function renewalsPage(c, offset = 0) {
  const data = await api("renewals?offset=" + offset);
  c.replaceChildren(
    el("h1", "续费预警"),
    el(
      "p",
      "余额 ≤ " +
        data.settings.low_balance_threshold +
        "课时，或未来 " +
        data.settings.expiry_warning_days +
        "天内到期。预计用完日按近30天扣课速度估算，仅供跟进参考。",
    ),
  );
  if (me.user.roles.includes("supervisor"))
    c.append(
      button("预警规则", () => {
        const { panel, close } = drawer("续费预警规则"),
          f = el("form");
        field(
          f,
          "低余额课时（整数）",
          "low_balance_threshold",
          "number",
          data.settings.low_balance_threshold,
        );
        field(
          f,
          "提前提醒天数",
          "expiry_warning_days",
          "number",
          data.settings.expiry_warning_days,
        );
        submit(f, "保存规则", async (d) => {
          await api("renewal-settings", "PUT", {
            low_balance_threshold: Number(d.low_balance_threshold),
            expiry_warning_days: Number(d.expiry_warning_days),
          });
          close();
          await renewalsPage(c);
        });
        panel.append(f);
      }),
    );
  const selected = new Set(),
    list = card("低余额 / 即将到期");
  for (const row of data.items) {
    const line = el("label", null, { class: "renewal-line" }),
      check = el("input", null, { type: "checkbox" });
    check.addEventListener("change", () => {
      check.checked
        ? selected.add(row.id)
        : selected.delete(row.id);
    });
    line.append(
      check,
      el(
        "span",
        row.student_name +
          " · " +
          row.course_name +
          " · 剩余 " +
          row.balance +
          "课时 · " +
          (row.valid_to ? "有效期至 " + row.valid_to : "不限有效期") +
          (row.estimated_end ? " · 预计 " + row.estimated_end + "用完" : ""),
      ),
    );
    list.append(line);
  }
  if (enabled("exports", "export"))
    list.append(
      button("生成已选续费通知", async () => {
        if (!selected.size) throw Error("请先选择需要跟进的课时包");
        const b = await api("renewal-brand");
        for (const row of data.items.filter((x) => selected.has(x.id)))
          await renewalNotice(c, b, row);
      }),
    );
  c.append(list);
  pager(c, data.items.length === 200 ? offset + 200 : null, offset, (n) =>
    renewalsPage(c, n),
  );
}
function wrapCanvasText(ctx, text, width) {
  const closing = /^[，。！？、；：）》」』】〕〉”’…,.!?;:%％℃°]/u;
  const opening = /[（《「『【〔〈“‘(]$/u;
  const result = [];
  let line = "";
  for (const ch of Array.from(text)) {
    if (ch === "\n") {
      if (line) result.push(line);
      line = "";
      continue;
    }
    if (line && ctx.measureText(line + ch).width > width) {
      if (closing.test(ch)) {
        line += ch;
        continue;
      }
      let carry = "";
      while (opening.test(line)) {
        const chars = Array.from(line);
        carry = chars.pop() + carry;
        line = chars.join("");
      }
      if (line) result.push(line);
      line = carry + ch;
    } else line += ch;
  }
  if (line) result.push(line);
  return result;
}
// 续费提醒登记（B2）：复制文字或下载图片后记一次，不向外部发送消息。
async function renewalRemind(row, channel) {
  if (!row.package_ids?.length || !enabled("exports", "export")) return;
  try {
    await api("renewals/remind", "POST", {
      student_id: row.student_id,
      course_type_id: row.reminder_course_type_id || row.course_type_id,
      package_ids: row.package_ids,
      channel,
    });
  } catch (error) {
    notice("提醒已生成，但登记失败：" + error.message, "error");
  }
}
async function renewalNotice(c, b, row) {
  const text =
    "您好，" +
    row.student_name +
    "的" +
    row.course_name +
    "剩余 " +
    row.balance +
    " 课时" +
    (row.valid_to ? "，有效期至 " + row.valid_to : "") +
    "。为便于衔接后续学习，请联系老师了解续费安排。" +
    "";
  const p = card("续费提醒 · " + row.student_name);
  p.append(
    el("p", text, { class: "preserve-text" }),
    button("复制通知文字", async () => {
      await navigator.clipboard.writeText(
        text + "\n" + (b.contact_text?.trim() || "请联系机构老师"),
      );
      notice("已复制", "success");
      await renewalRemind(row, "text");
    }),
  );
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  const ctx = canvas.getContext("2d");
  ctx.font = "32px sans-serif";
  const lines = wrapCanvasText(ctx, text, 960);
  const contact = b.contact_text?.trim() || "请联系机构老师";
  const contactLines = wrapCanvasText(
    ctx,
    contact,
    b.consultant_qr ? 620 : 960,
  );
  const bodyEnd = 342 + (lines.length - 1) * 52;
  const contactTop = bodyEnd + 65;
  const contactHeight = Math.max(
    b.consultant_qr ? 200 : 0,
    contactLines.length * 48,
  );
  canvas.height = contactTop + contactHeight + 105;
  ctx.fillStyle = "#f4f2f7";
  ctx.fillRect(0, 0, 1080, canvas.height);
  ctx.fillStyle = b.theme_color || "#2b4c7e";
  ctx.fillRect(0, 0, 1080, 160);
  ctx.fillStyle = "#fff";
  ctx.font = "bold 42px sans-serif";
  ctx.fillText(b.display_name, 160, 95, 860);
  if (b.logo) {
    const logo = new Image();
    logo.src = b.logo;
    await logo.decode();
    const scale = Math.min(84 / logo.naturalWidth, 84 / logo.naturalHeight);
    ctx.drawImage(
      logo,
      40,
      38,
      logo.naturalWidth * scale,
      logo.naturalHeight * scale,
    );
  } else {
    ctx.font = "bold 64px sans-serif";
    ctx.fillText(Array.from(b.display_name)[0] || "教", 60, 103);
  }
  ctx.fillStyle = "#1e1a26";
  ctx.font = "bold 50px sans-serif";
  ctx.fillText("续费提醒", 60, 260);
  ctx.font = "32px sans-serif";
  lines.forEach((line, i) => ctx.fillText(line, 60, 342 + i * 52));
  if (b.consultant_qr) {
    const qr = new Image();
    qr.src = b.consultant_qr;
    await qr.decode();
    const scale = Math.min(200 / qr.naturalWidth, 200 / qr.naturalHeight);
    ctx.drawImage(
      qr,
      60,
      contactTop,
      qr.naturalWidth * scale,
      qr.naturalHeight * scale,
    );
  }
  ctx.fillStyle = "#6b6476";
  contactLines.forEach((line, i) =>
    ctx.fillText(line, b.consultant_qr ? 310 : 60, contactTop + 35 + i * 48),
  );
  ctx.font = "25px sans-serif";
  ctx.fillText(b.display_name + " · " + todayBJ(), 60, canvas.height - 40, 960);
  const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    ),
    url = URL.createObjectURL(blob);
  promoMediaUrls.add(url);
  const save = el("a", "下载通知图片", {
    href: url,
    download: "续费提醒.png",
    class: "button",
  });
  save.addEventListener("click", () => renewalRemind(row, "image"));
  p.append(
    el("img", null, { src: url, alt: "续费提醒", class: "timetable-image" }),
    save,
    button("关闭通知", () => {
      URL.revokeObjectURL(url);
      p.remove();
    }),
  );
  c.append(p);
  p.scrollIntoView({ behavior: "smooth", block: "start" });
}
async function importWizard(c) {
  c.replaceChildren(el("h1", "Excel 批量导入"));
  const steps = el("ol", null, { class: "import-steps" });
  for (const label of ["选择导入内容", "上传文件", "检查与匹配", "完成"])
    steps.append(el("li", label));
  c.append(steps);
  const markStep = (index) =>
    [...steps.children].forEach((node, i) =>
      node.setAttribute("aria-current", i === index ? "step" : "false"),
    );
  markStep(0);
  const setup = card("1 · 选择导入内容"),
    form = el("form");
  const kinds = [
    { id: "students", name: "学员档案" },
    ...(enabled("settings", "create")
      ? [{ id: "teachers", name: "教师档案" }]
      : []),
    ...(enabled("packages", "create")
      ? [{ id: "balances", name: "剩余课时" }]
      : []),
  ];
  const kind = selectField(form, "导入内容", "kind", kinds, "students"),
    download = el("a", "下载 Excel 模板", {
      href: base + "api/imports/template?kind=students",
      class: "button",
    });
  kind.addEventListener("change", () => {
    download.href = base + "api/imports/template?kind=" + kind.value;
  });
  form.append(
    download,
    el(
      "p",
      "使用模板表头；一份 xlsx 一个工作表、最多2000行，文件不超过750KB。不导入公式或金额。已有同名档案不自动覆盖。",
      { class: "muted" },
    ),
  );
  const file = field(form, "2 · 上传 Excel 文件", "file", "file", "");
  file.accept = ".xlsx";
  file.addEventListener("change", () => markStep(1));
  let preview,
    previewKind,
    controls = [];
  submit(form, "预览并校验", async () => {
    const selected = file.files[0];
    if (!selected || selected.size > 750000)
      throw Error("请选择不超过750KB的 xlsx 文件");
    const bytes = new Uint8Array(await selected.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 16384)
      binary += String.fromCharCode(...bytes.subarray(i, i + 16384));
    previewKind = kind.value;
    preview = await api("imports/preview?kind=" + previewKind, "POST", {
      file: btoa(binary),
    });
    controls = preview.rows.map((row) => ({
      row,
      action: row.status === "valid" ? "new" : "skip",
      confirm: false,
      student_id: row.candidates?.length === 1 ? row.candidates[0].id : "",
      course_type_id: row.courses?.length === 1 ? row.courses[0].id : "",
    }));
    renderPreview(0);
  });
  setup.append(form);
  c.append(setup);
  const area = el("section");
  c.append(area);
  function renderPreview(offset) {
    markStep(2);
    area.replaceChildren();
    const p = card(
        "3 · 检查与匹配",
        "只导入校验通过且已确认的行；导入按200行一批显示进度。",
      ),
      counts = { valid: 0, duplicate: 0, invalid: 0 };
    for (const row of preview.rows) counts[row.status]++;
    p.append(
      el(
        "p",
        "共 " +
          preview.rows.length +
          " 行 · 校验通过 " +
          counts.valid +
          " 行 · 同名待核对 " +
          counts.duplicate +
          " 行 · 有误 " +
          counts.invalid +
          " 行",
      ),
    );
    const wrap = el("div", null, { class: "table-wrap" }),
      table = el("table"),
      head = el("tr");
    for (const h of ["行号", "姓名", "检查结果", "处理方式", "对应档案"])
      head.append(el("th", h));
    table.append(head);
    for (const state of controls.slice(offset, offset + 200)) {
      const { row } = state,
        tr = el("tr", null, { class: "import-row " + row.status });
      tr.append(
        el("td", String(row.index)),
        el("td", row.name),
        el("td", row.message),
      );
      const action = el("td"),
        matches = el("td");
      if (row.status !== "invalid") {
        const select = el("select", null, {
          "aria-label": "第" + row.index + "行处理方式",
        });
        select.append(
          el("option", "跳过", { value: "skip" }),
          el(
            "option",
            row.status === "duplicate" ? "已核对同名，仍新增" : "新增",
            { value: "new" },
          ),
        );
        select.value = state.action;
        select.addEventListener("change", () => {
          state.action = select.value;
          state.confirm = row.status === "duplicate" && select.value === "new";
        });
        action.append(select);
        if (previewKind === "balances")
          for (const [label, key, options] of [
            ["学员", "student_id", row.candidates || []],
            ["课程", "course_type_id", row.courses || []],
          ]) {
            const select = el("select", null, {
              "aria-label": "第" + row.index + "行" + label,
            });
            select.append(el("option", "请选择" + label, { value: "" }));
            options.forEach((o, i) =>
              select.append(
                el(
                  "option",
                  o.name +
                    (o.grade ? " · " + o.grade : "") +
                    (o.school ? " · " + o.school : "") +
                    (options.length > 1 ? "（条目" + (i + 1) + "）" : ""),
                  { value: o.id },
                ),
              ),
            );
            select.value = state[key];
            select.addEventListener(
              "change",
              () => (state[key] = select.value),
            );
            matches.append(select);
          }
      } else action.append(el("span", "跳过错误行"));
      tr.append(action, matches);
      table.append(tr);
    }
    wrap.append(table);
    p.append(wrap);
    if (offset) p.append(button("上一页", () => renderPreview(offset - 200)));
    if (offset + 200 < controls.length)
      p.append(button("下一页", () => renderPreview(offset + 200)));
    const progress = el("p", "尚未导入", { "aria-live": "polite" }),
      run = button(
        "仅导入已确认行",
        async () => {
          const rows = controls
            .filter((x) => x.row.status !== "invalid")
            .map((x) => ({
              token: x.row.token,
              action: x.action,
              confirm_duplicate: x.confirm,
              student_id: x.student_id || undefined,
              course_type_id: x.course_type_id || undefined,
            }));
          if (!rows.some((x) => x.action === "new"))
            throw Error("请先选择需要导入的合法行");
          if (!(await ask("确认导入选中行？不会覆盖已有档案或课时包。")))
            return;
          run.disabled = true;
          let imported = 0,
            skipped = counts.invalid;
          try {
            for (let i = 0; i < rows.length; i += 200) {
              const op = operation(),
                batch = rows.slice(i, i + 200);
              let result;
              try {
                result = await api(
                  "imports/commit?kind=" + previewKind,
                  "POST",
                  { operation_id: op, rows: batch },
                );
              } catch (e) {
                throw Error(
                  "已完成 " +
                    imported +
                    " 行；本批未确认，请重新预览后继续。" +
                    e.message,
                );
              }
              imported += result.imported;
              skipped += result.skipped;
              progress.textContent =
                "已处理 " +
                Math.min(i + 200, rows.length) +
                " / " +
                rows.length +
                " 行";
            }
            markStep(3);
            area.replaceChildren(
              card(
                "4 · 导入完成",
                "新增 " + imported + " 行，跳过 " + skipped + " 行。",
              ),
            );
          } finally {
            run.disabled = false;
          }
        },
        "primary",
      );
    p.append(progress, run);
    area.append(p);
  }
}

async function promoUpload(file, label) {
  if (!file || file.size > 2097152) throw Error("图片不得超过2MB");
  const data = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(Error("图片读取失败"));
    reader.readAsDataURL(file);
  });
  const upload = await api("promo/images", "POST", {}),
    parts = Math.ceil(data.length / 500000);
  for (let index = 0; index < parts; index++) {
    if (label) label.textContent = "上传 " + (index + 1) + "/" + parts;
    await api("promo/images/" + upload.id + "/part", "POST", {
      index,
      data: data.slice(index * 500000, (index + 1) * 500000),
    });
  }
  return await api("promo/images/" + upload.id + "/complete", "POST", {});
}
// 一次性的图片地址（续费通知图、旧版推广页的图）：换页时释放。长期复用的推广图片在 promoImageLRU 里，不受影响。
const promoMediaUrls = new Set();
function promoClearImages() {
  for (const url of promoMediaUrls) URL.revokeObjectURL(url);
  promoMediaUrls.clear();
}
// 推广图片的长期缓存：同一张图在整个使用过程中只下载、解码一次，换页、回来都直接复用。
// 最多留 40 张，超出时释放最早的一张（不在页面上用的那种才会被挤掉，见 promoCacheTouch）。
// 这里的图片地址不放进 promoMediaUrls，换页时不会被释放。
const promoImageLRU = new Map(),
  PROMO_IMAGE_LIMIT = 40;
function promoCachePut(cache, limit, key, value, release) {
  cache.set(key, value);
  while (cache.size > limit) {
    const [oldKey, oldValue] = cache.entries().next().value;
    cache.delete(oldKey);
    Promise.resolve(oldValue).then(release, () => {});
  }
  return value;
}
// 用到时挪到队尾，最近用过的最后才会被挤掉。
function promoCacheTouch(cache, key) {
  const value = cache.get(key);
  cache.delete(key);
  cache.set(key, value);
  return value;
}
function promoCachedImage(id, fallback) {
  const key = id || fallback || "";
  if (!key) return Promise.resolve(null);
  if (promoImageLRU.has(key)) return promoCacheTouch(promoImageLRU, key);
  const pending = promoFetchImage(id, fallback, false).catch((e) => {
    promoImageLRU.delete(key);
    throw e;
  });
  return promoCachePut(promoImageLRU, PROMO_IMAGE_LIMIT, key, pending, (img) => {
    if (img?.src?.startsWith("blob:")) URL.revokeObjectURL(img.src);
  });
}
async function promoLoadImage(id, fallback) {
  return promoFetchImage(id, fallback, true);
}
async function promoFetchImage(id, fallback, transient) {
  let src = fallback;
  if (id) {
    const r = await fetch(base + "api/promo/images/" + id, {
      credentials: "same-origin",
    });
    if (!r.ok) throw Error("图片不存在或当前无权访问");
    src = URL.createObjectURL(await r.blob());
    if (transient) promoMediaUrls.add(src);
  }
  if (!src) return null;
  const image = new Image();
  image.src = src;
  try {
    await image.decode();
  } catch {
    // 部分手机浏览器提前解码很长的图片会失败，但图片本身能正常显示：改为等它按普通方式加载完。
    if (!image.complete || !image.naturalWidth)
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(Error("图片加载失败，请稍后重试"));
        if (image.complete) (image.naturalWidth ? resolve : image.onerror)();
      });
  }
  return image;
}
async function promoCenter(c, type = "", offset = 0) {
  promoClearImages();
  const renderToken = Symbol("promo");
  c._promoRender = renderToken;
  const previewJobs = [];
  const data = await api(
    "promo?offset=" + offset + (type ? "&type=" + type : ""),
  );
  c.replaceChildren(
    el("h1", "推广中心"),
    el("p", "合作资讯、课程讲座与机构招生物料", { class: "muted" }),
  );
  const tabs = el("nav", null, { class: "row", "aria-label": "推广内容分类" });
  for (const [value, label] of [
    ["", "全部"],
    ["course", "课程与讲座"],
    ["material", "物料"],
    ["message", "消息"],
  ]) {
    const b = button(label, () => promoCenter(c, value));
    b.setAttribute("aria-current", type === value ? "page" : "false");
    tabs.append(b);
  }
  c.append(
    tabs,
    button("更换推广 Logo 与顾问二维码", () => promoAssetsForm(c)),
  );
  let previewCount = 0;
  for (const [kind, label] of [
    ["course", "线上课程与讲座"],
    ["material", "招生物料"],
    ["message", "消息"],
  ]) {
    if (type && type !== kind) continue;
    const rows = data.items.filter((x) => x.type === kind);
    if (!rows.length) continue;
    const section = el("section", null, { class: "promo-section" }),
      grid = el("div", null, {
        class: kind === "message" ? "promo-messages" : "promo-grid",
      });
    section.append(el("h2", label));
    for (const row of rows) {
      const p = card(row.title, row.is_read ? "已读" : "新");
      if (kind === "course") {
        const banner = el("div", null, { class: "promo-course-banner" });
        if (row.cover && previewCount < 12) {
          previewJobs.push(async () => {
            const image = await promoLoadImage(row.cover);
            if (c._promoRender === renderToken && banner.isConnected)
              banner.prepend(
                el("img", null, {
                  src: image.src,
                  alt: "课程封面",
                  class: "promo-card-cover",
                  loading: "lazy",
                  decoding: "async",
                }),
              );
          });
          previewCount++;
        }
        banner.append(el("h2", row.title), el("small", "线上课程 · 机构合作"));
        p.replaceChildren(
          banner,
          el("p", row.summary),
          el(
            "p",
            (row.first_start
              ? row.first_start.slice(0, 16).replace("T", " ")
              : "") +
              " · " +
              row.session_count +
              "课次",
          ),
          el("p", "主讲：" + row.lecturer),
          el("p", "申请截止：" + promoTime(row.apply_deadline)),
          el(
            "p",
            data.labels.courses[row.course_status] +
              " · " +
              (row.application_status
                ? data.labels.applications[row.application_status]
                : "尚未申请"),
          ),
        );
      } else if (kind === "material" && row.preview && previewCount < 12) {
        previewJobs.push(() => promoPoster(p, row.id, row.preview, data, true));
        previewCount++;
      } else
        p.append(
          el("p", row.summary || row.body.slice(0, 120), {
            class: "preserve-text",
          }),
        );
      p.append(
        button(
          kind === "material" ? "查看物料" : "查看详情",
          () => promoDetail(c, row.id),
          "primary",
        ),
      );
      grid.append(p);
    }
    section.append(grid);
    c.append(section);
  }
  if (!data.items.length) c.append(el("p", "暂无合作内容", { class: "empty" }));
  pager(c, data.next_offset, offset, (n) => promoCenter(c, type, n));
  const loadPreview = async () => {
    while (
      previewJobs.length &&
      c._promoRender === renderToken &&
      c.isConnected
    ) {
      const job = previewJobs.shift();
      try {
        await job();
      } catch (error) {
        if (c._promoRender !== renderToken) return;
        const retry = button("预览加载失败，点击重试", async () => {
          try {
            await job();
            retry.remove();
          } catch (e) {
            notice(e.message);
          }
        });
        c.append(retry);
      }
    }
  };
  void Promise.all(Array.from({ length: 3 }, () => loadPreview()));
}
async function promoAssetsForm(c) {
  const data = await api("promo/assets"),
    { panel, close } = drawer("推广专用品牌");
  panel.append(
    el(
      "p",
      "只用于推广海报，不改变登录页和系统名称。未上传时使用机构原有品牌。",
    ),
  );
  const form = el("form"),
    files = {};
  for (const [key, label] of [
    ["logo_key", "推广 Logo"],
    ["qr_key", "顾问二维码"],
  ]) {
    const input = field(form, label, key, "file", "", false);
    input.accept = "image/png,image/jpeg,image/webp";
    files[key] = input;
  }
  const clearLogo = field(
      form,
      "清除推广 Logo，改用机构品牌",
      "clear_logo",
      "checkbox",
      "",
      false,
    ),
    clearQr = field(
      form,
      "清除推广二维码，改用机构品牌",
      "clear_qr",
      "checkbox",
      "",
      false,
    ),
    progress = el("p", "");
  form.append(progress);
  submit(form, "保存推广品牌", async () => {
    const payload = {
      version: data.assets?.version,
      logo_key: clearLogo.checked ? null : data.assets?.logo_key || null,
      qr_key: clearQr.checked ? null : data.assets?.qr_key || null,
    };
    for (const key of Object.keys(files))
      if (files[key].files[0])
        payload[key] = (await promoUpload(files[key].files[0], progress)).id;
    await api("promo/assets", "PUT", payload);
    close();
    await promoCenter(c);
  });
  panel.append(form);
}
function promoTime(value) {
  return new Date(value).toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" });
}
async function promoDetail(c, id) {
  promoClearImages();
  const data = await api("promo/" + id),
    row = data.campaign,
    labels = me.labels.promo;
  c.replaceChildren(
    button("‹ 返回推广中心", () => promoCenter(c)),
    el("h1", row.title),
  );
  await api("promo/" + id + "/read", "POST", {});
  if (row.cover && row.type !== "course") {
    const image = await promoLoadImage(row.cover);
    c.append(
      el("img", null, {
        src: image.src,
        alt: row.title,
        class: "promo-long-image",
      }),
    );
  }
  const grid = el("div", null, { class: "promo-detail-grid" }),
    body = card(row.type === "course" ? "课程信息" : "合作内容");
  if (row.type !== "course")
    body.append(el("p", row.body, { class: "preserve-text" }));
  if (row.type === "course") {
    body.append(
      el("p", "主讲：" + row.lecturer),
      el("p", "形式：腾讯会议 · 共" + data.sessions.length + "课次"),
      el("p", "申请截止：" + promoTime(row.apply_deadline)),
    );
    if (row.seat_price !== undefined)
      body.append(
        el(
          "p",
          "席位价 ¥" +
            moneyText(row.seat_price) +
            " · 建议收费 ¥" +
            moneyText(row.suggested_price),
        ),
      );
    for (const s of data.sessions) {
      const p = card(
        s.start_at.slice(0, 16).replace("T", " "),
        s.duration + "分钟",
      );
      if (s.meeting_no) p.append(el("p", "腾讯会议号：" + s.meeting_no));
      if (s.meeting_url)
        p.append(
          el("a", "进入腾讯会议", {
            href: s.meeting_url,
            target: "_blank",
            rel: "noopener noreferrer",
          }),
        );
      body.append(p);
    }
    const steps = el("ol", null, {
      class: "promo-steps",
      "aria-label": "申请流程",
    });
    for (const label of ["申请加入", "顾问联系", "确认席位", "成班后登记学员"])
      steps.append(el("li", label));
    body.append(steps);
    if (row.detail_image_key) {
      const image = await promoLoadImage(row.detail_image_key);
      body.append(
        el("img", null, {
          src: image.src,
          alt: "课程介绍",
          class: "promo-long-image",
        }),
      );
    }
  }
  if (row.type === "course" && row.body)
    body.append(el("p", row.body, { class: "preserve-text" }));
  const side = card(row.type === "course" ? "本机构申请" : "合作资料");
  if (row.type === "course") {
    const app = data.application;
    side.append(el("p", app ? labels.applications[app.status] : "尚未申请"));
    if (app) {
      side.append(
        el(
          "p",
          app.unsure ? "预计人数还不清楚" : "预计 " + app.est_size + " 人",
        ),
      );
      if (app.confirmed_size)
        side.append(el("p", "已确认 " + app.confirmed_size + " 人"));
      if (app.seat_price !== undefined && app.seat_price !== null)
        side.append(el("p", "确认席位单价 ¥" + moneyText(app.seat_price)));
    }
    if (
      row.course_status === "recruiting" &&
      (!app || ["applied", "following", "withdrawn"].includes(app.status))
    ) {
      side.append(
        button(
          app && app.status !== "withdrawn" ? "修改申请" : "申请加入",
          () => promoApplication(c, id, data),
          "primary",
        ),
      );
      if (app && app.status !== "withdrawn")
        side.append(
          button("撤回申请", async () => {
            if (!(await ask("确定撤回本机构申请？"))) return;
            await api("promo/" + id + "/withdraw", "POST", {
              version: app.version,
            });
            await promoDetail(c, id);
          }),
        );
    }
    if (app?.status === "opened")
      side.append(
        button("管理本机构参课名单", () => promoRoster(c, id, data), "primary"),
      );
    if (row.reason)
      side.append(el("p", row.reason, { class: "preserve-text" }));
  }
  grid.append(body, side);
  c.append(grid);
  if (data.posters.length) {
    const gallery = card(
        row.type === "course" ? "配套招生海报" : "本机构招生海报",
      ),
      tabs = el("nav", null, { class: "row" }),
      view = el("section");
    let current = 0;
    const show = async (index) => {
      current = index;
      view.replaceChildren(el("p", "正在合成…"));
      const rendered = el("section");
      await promoPoster(rendered, id, data.posters[index], data);
      if (current === index) view.replaceChildren(...rendered.childNodes);
    };
    for (let i = 0; i < data.posters.length; i++)
      tabs.append(button("海报 " + (i + 1), () => show(i)));
    gallery.append(tabs, view);
    (row.type === "course" ? side : body).append(gallery);
    await show(0);
  }
}
async function promoApplication(c, id, data) {
  const app = data.application,
    { panel, close } = drawer("申请加入"),
    form = el("form");
  field(form, "预计人数（1–200）", "est_size", "number", app?.est_size || 1);
  const unsure = field(form, "人数还不清楚", "unsure", "checkbox", "", false);
  unsure.checked = !!app?.unsure;
  selectField(
    form,
    "联系人",
    "contact_user_id",
    data.contacts,
    app?.contact_user_id || me.user.id,
  );
  textArea(form, "备注", "note", app?.note || "", 2000);
  submit(form, "提交申请", async (d) => {
    await api("promo/" + id + "/application", "POST", {
      version: app?.version,
      est_size: Number(d.est_size),
      unsure: unsure.checked,
      contact_user_id: d.contact_user_id,
      note: d.note,
    });
    close();
    await promoDetail(c, id);
  });
  panel.append(form);
}
async function promoRoster(c, id, data) {
  const roster = await api("promo/" + id + "/roster"),
    students = await choices("students"),
    { panel, close } = drawer("合作课程参课名单");
  panel.append(
    el(
      "p",
      "最多 " +
        data.application.confirmed_size +
        " 人。只更改未来课次，已开始课程保留原名单。",
    ),
  );
  const form = el("form"),
    inputs = students
      .filter((x) => x.status === "active")
      .map((s) => {
        const input = field(form, s.name, s.id, "checkbox", "", false);
        input.checked = roster.items.some((x) => x.student_id === s.id);
        return { s, input };
      });
  submit(form, "保存名单", async () => {
    await api("promo/" + id + "/roster", "PUT", {
      version: data.application.version,
      student_ids: inputs.filter((x) => x.input.checked).map((x) => x.s.id),
    });
    close();
    await promoDetail(c, id);
  });
  panel.append(form);
}
function promoContain(ctx, image, slot) {
  if (!image) return;
  const scale = Math.min(
      slot.width / image.naturalWidth,
      slot.height / image.naturalHeight,
    ),
    w = image.naturalWidth * scale,
    h = image.naturalHeight * scale;
  ctx.drawImage(
    image,
    slot.x + (slot.width - w) / 2,
    slot.y + (slot.height - h) / 2,
    w,
    h,
  );
}
async function promoPoster(c, campaignId, p, data, compact = false) {
  const holder = card("招生海报"),
    canvas = document.createElement("canvas");
  canvas.width = p.width;
  canvas.height = p.height;
  const ctx = canvas.getContext("2d"),
    [background, logo, qr] = await Promise.all([
      promoLoadImage(p.image_key),
      promoLoadImage(data.assets?.logo_key, data.brand.logo),
      promoLoadImage(data.assets?.qr_key, data.brand.consultant_qr),
    ]);
  ctx.drawImage(background, 0, 0, p.width, p.height);
  promoContain(ctx, logo, p.slots.logo);
  promoContain(ctx, qr, p.slots.qr);
  if (!logo) {
    ctx.font =
      "bold " + Math.floor(p.slots.logo.height * 0.6) + "px sans-serif";
    ctx.fillStyle = "#333";
    ctx.fillText(
      Array.from(data.brand.display_name)[0] || "教",
      p.slots.logo.x,
      p.slots.logo.y + p.slots.logo.height * 0.7,
      p.slots.logo.width,
    );
  }
  if (!qr) {
    ctx.font = "22px sans-serif";
    ctx.fillText(
      "请联系机构老师",
      p.slots.qr.x,
      p.slots.qr.y + p.slots.qr.height / 2,
      p.slots.qr.width,
    );
  }
  const slot = p.slots.text,
    text = "主办：" + data.brand.display_name + " · 联合合作：枫琴国际艺术";
  ctx.font = slot.font_size + "px sans-serif";
  ctx.fillStyle = slot.color;
  ctx.textAlign = slot.align;
  const x =
    slot.x +
    (slot.align === "center"
      ? slot.width / 2
      : slot.align === "right"
        ? slot.width
        : 0);
  ctx.fillText(
    text,
    x,
    slot.y + Math.min(slot.height, slot.font_size),
    slot.width,
  );
  const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    ),
    url = URL.createObjectURL(blob);
  promoMediaUrls.add(url);
  if (compact) {
    holder.append(
      el("img", null, {
        src: url,
        alt: data.brand.display_name + " · 招生海报",
        class: "promo-thumb-image",
      }),
    );
    c.append(holder);
    await api("promo/" + campaignId + "/posters/" + p.id + "/event", "POST", {
      action: "view",
    });
    return;
  }
  holder.append(
    el("img", null, {
      src: url,
      alt: "本机构合作海报",
      class: "promo-long-image",
    }),
    el("p", "手机可长按图片保存；保存操作不会自动回传，可点击“已保存”登记。", {
      class: "muted",
    }),
    button("下载图片", async () => {
      await api("promo/" + campaignId + "/posters/" + p.id + "/event", "POST", {
        action: "download",
      });
      const a = el("a", null, { href: url, download: "合作海报.png" });
      a.click();
    }),
    button("已保存", async () => {
      await api("promo/" + campaignId + "/posters/" + p.id + "/event", "POST", {
        action: "save",
      });
      notice("已记录保存", "success");
    }),
    button("关闭预览", () => {
      URL.revokeObjectURL(url);
      holder.remove();
    }),
  );
  c.append(holder);
  await api("promo/" + campaignId + "/posters/" + p.id + "/event", "POST", {
    action: "view",
  });
}

function partnerLabel(row) {
  const start = Date.parse(row.start_at);
  return (
    "合作课程 · " +
    (Date.now() < start
      ? "待上课"
      : Date.now() < start + row.duration * 60000
        ? "进行中"
        : "已结束")
  );
}
function personalPartner(c, row, back) {
  c.replaceChildren(
    button("‹ 返回课表", back),
    el("h1", row.course_name),
    el(
      "p",
      row.start_at.slice(0, 16).replace("T", " ") +
        " · " +
        row.duration +
        "分钟",
    ),
    el("p", "主讲：" + row.teacher_name),
    el("p", partnerLabel(row)),
    el("p", "线上直播课，上课安排请联系机构老师。"),
  );
}

async function financialToday(c, data) {
  c.replaceChildren(
    el("p", fmt.day(todayBJ()) + " · 北京时间", { class: "muted" }),
  );
  const metrics = el("div", null, { class: "metrics-grid" });
  if (data.tuition_amount !== undefined) {
    const paid = card("本月已收");
    paid.append(
      el("strong", fmt.money(data.tuition_amount), { class: "metric-value" }),
    );
    metrics.append(paid);
  }
  if (enabled("teacher_pay")) {
    const pay = await api("finance/payroll?month=" + todayBJ().slice(0, 7));
    const item = card("本月课酬未付");
    item.append(
      el(
        "strong",
        fmt.money(
          (pay.items || []).reduce(
            (n, x) => n + Number(x.unpaid_amount || 0),
            0,
          ),
        ),
        { class: "metric-value" },
      ),
    );
    metrics.append(item);
  }
  if (enabled("tuition")) {
    const due = await api("finance/receivable-summary");
    const item = card("待收款");
    const text = fmt.receivable(due.amount, due.unresolved),
      [main, note] = text.split(" · 另有 "),
      value = el("strong", note ? main : text, { class: "metric-value" });
    // 金额保持大字，“另有 N 笔待核对”降为小字，文字内容不变。
    if (note)
      value.append(el("span", " · 另有 " + note, { class: "c3-metric-note" }));
    item.append(value);
    metrics.append(item);
  }
  c.append(metrics);
  const lessons = card("今日课程（只读）");
  for (const row of data.lessons || [])
    lessons.append(
      button(
        row.start_at.slice(11, 16) +
          " · " +
          row.course_name +
          " · " +
          row.teacher_name,
        () => lessonDetail(c, row),
      ),
    );
  c.append(lessons);
}
