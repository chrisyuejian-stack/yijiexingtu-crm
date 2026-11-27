// 艺界星途 · 阶段 2 前端（Claude 编写）
// 内容：根地址管理者登录、选择机构、机构专属登录页、机构停用提示、家长端、学员档案「家长」页签。
// 约束：只用 DOM 构造与 textContent；不写内联 style（CSP 不允许）；归属、权限、金额一律由服务器判断。
// 本文件拼在机构端脚本最后，函数声明会被提前，app.js 的启动流程可以直接调用这里的函数。

// 用 var：启动流程在本文件执行前就可能读到它们，var 不会因“尚未初始化”报错。
var yxState = { child: null, parent: null, paused: false };

function yxIsRoot() {
  return base === "/";
}
function yxPlatformBrand() {
  return { display_name: "艺界星途", logo: null, login_bg: null, theme_color: "#6A35B8", welcome_text: "" };
}
// 根地址登录后没有机构路径，用 me 里的机构代号取机构品牌（公开接口，不含账号信息）。
async function yxTenantBrand(slug) {
  try {
    const b = await apiRequest("public/tenant-brand?slug=" + encodeURIComponent(slug));
    return { display_name: b.name, logo: b.logo_url, login_bg: b.login_bg_url, theme_color: b.primary_color, welcome_text: "" };
  } catch {
    return yxPlatformBrand();
  }
}
function yxApplyTheme(color) {
  if (!/^#[0-9a-f]{6}$/i.test(color || "") || !globalThis.CSSStyleSheet?.prototype?.replaceSync) return;
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(":root{--theme:" + color + "}");
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
}
// 家长查看某个孩子时，旧接口统一加 student_id（服务器再校验绑定）。
function yxScopedPath(path) {
  // 启动时第一次请求可能早于本文件执行，此时 yxState 还没赋值。
  if (!yxState?.parent || !yxState.child) return path;
  if (/^(me|logout|password|sessions|parent\/|auth\/|public\/)/.test(path)) return path;
  return path + (path.includes("?") ? "&" : "?") + "student_id=" + encodeURIComponent(yxState.child);
}
function yxLoginPath(path) {
  return /^(auth\/)?login/.test(path);
}
const YX_RELATION = { mother: "妈妈", father: "爸爸", grandparent: "祖辈", other: "其他" };
const YX_LAST_TENANT = "yx_last_tenant";

// ---------- 小工具 ----------
function yxSvg(tag, attrs = {}) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}
// 根登录左侧的“星途”装饰：几颗星连成两条航线。
function yxStarfield() {
  const svg = yxSvg("svg", { viewBox: "0 0 640 900", class: "yx-stars", "aria-hidden": "true", preserveAspectRatio: "xMidYMid slice" });
  const lines = yxSvg("g", { class: "yx-stars-line" });
  for (const d of ["M420 160 L520 230 L470 340 L560 420", "M120 620 L230 560 L300 650 L420 610"])
    lines.append(yxSvg("path", { d }));
  const dots = yxSvg("g", { class: "yx-stars-dot" });
  for (const [x, y, r] of [
    [420, 160, 3], [520, 230, 2], [470, 340, 3.5], [560, 420, 2], [120, 620, 2], [230, 560, 3],
    [300, 650, 2], [420, 610, 3], [80, 200, 1.5], [300, 120, 1.5], [580, 760, 1.5],
  ])
    dots.append(yxSvg("circle", { cx: x, cy: y, r }));
  svg.append(lines, dots, yxSvg("circle", { cx: 470, cy: 340, r: 14, class: "yx-stars-glow" }));
  return svg;
}
function yxMark(b, cls = "") {
  const box = el("span", null, { class: "yx-mark " + cls });
  if (b?.logo) box.append(el("img", null, { src: b.logo, alt: "" }));
  else box.append(el("span", Array.from((b?.display_name || "").trim())[0] || "艺"));
  return box;
}
function yxInput(form, label, name, type, attrs = {}) {
  const wrap = el("label", null, { class: "yx-field" }),
    input = el("input", null, { name, type, required: "", ...attrs });
  wrap.append(el("span", label), input);
  form.append(wrap);
  return input;
}

// ---------- 登录 ----------
// 根地址（edu.yijiexingtu.com/login）：主管、顾问、教务、财务；机构路径（/机构代号/login）：所有人，品牌只显示机构。
function yxLoginPage() {
  root.replaceChildren();
  const isRoot = yxIsRoot(),
    page = el("div", null, { class: "yx-login " + (isRoot ? "yx-login--root" : "yx-login--school") });
  const side = el("section", null, { class: "yx-login-side" });
  if (isRoot) {
    const logo = el("div", null, { class: "yx-login-logo" });
    logo.append(yxMark(brand, "is-light"), el("strong", "艺界星途"));
    const pitch = el("div", null, { class: "yx-login-pitch" });
    pitch.append(
      el("p", "For music & art schools", { class: "yx-login-en" }),
      el("h1", "让每一家艺术机构\n都有自己的 AI 运营团队"),
      el("p", "招生文案、课程方案、学员成长报告，几分钟完成，始终带着你的机构品牌。", { class: "yx-login-lead" }),
    );
    const tags = el("div", null, { class: "yx-login-tags" });
    for (const [text, tone] of [["招生内容助手", "coral"], ["课程方案与报价", "violet"], ["学员成长报告", "teal"]])
      tags.append(el("span", text, { class: "yx-tag yx-tag--" + tone }));
    pitch.append(tags);
    side.append(yxStarfield(), logo, pitch, el("p", "yijiexingtu.com", { class: "yx-login-foot" }));
  } else {
    if (brand.login_bg || brand.login_bg_url) side.append(el("img", null, { src: brand.login_bg || brand.login_bg_url, alt: "", class: "yx-login-bg", decoding: "async" }));
    else {
      const hero = el("div", null, { class: "yx-login-hero" });
      hero.append(el("strong", brand.display_name), el("p", brand.welcome_text || "让每一节课都有记录，每一位学员都被看见。"));
      side.append(hero);
    }
    side.append(yxMark(brand, "is-tile"));
  }
  const main = el("main", null, { class: "yx-login-main" }),
    card = el("div", null, { class: "yx-login-card" });
  main.append(card);
  page.append(side, main);
  root.append(page);
  yxLoginForm(card);
}
function yxLoginForm(card) {
  const isRoot = yxIsRoot();
  card.replaceChildren();
  const form = el("form", null, { class: "yx-login-form", novalidate: "" }),
    head = el("div", null, { class: "yx-login-head" });
  if (isRoot) head.append(el("h2", "机构管理者登录"), el("p", "主管、顾问、教务、财务请在这里登录"));
  else head.append(el("h2", brand.display_name), el("p", "老师、家长、学员和机构员工登录"));
  form.append(head);
  const phone = yxInput(form, "手机号", "phone", "tel", {
    autocomplete: "username",
    inputmode: "tel",
    placeholder: "请输入 11 位手机号",
    maxlength: "11",
  });
  yxInput(form, "密码", "password", "password", { autocomplete: "current-password", placeholder: "请输入密码" });
  const challengeNode = turnstileEnabled ? el("div", "正在加载人机验证…", { class: "yx-challenge" }) : null;
  if (challengeNode) form.append(challengeNode);
  const error = el("p", "", { class: "yx-login-error", role: "alert", hidden: "" });
  const go = el("button", "登录", { type: "submit", class: "yx-btn yx-btn--primary yx-btn--block" });
  form.append(error, go);
  if (isRoot)
    form.append(
      el("p", "老师和家长请使用机构发给你的专属地址登录，例如 " + location.host + "/你的机构代号", { class: "yx-login-tip" }),
      el("p", "忘记密码？请联系机构主管在“账号与权限”里重置。", { class: "yx-login-note" }),
    );
  else
    form.append(
      el("p", "第一次登录请使用机构发给你的初始密码，登录后需要修改。忘记密码请联系机构老师。", { class: "yx-login-note" }),
      el("p", "© " + brand.display_name, { class: "yx-login-copy" }),
    );
  card.append(form);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (go.disabled) return;
    const d = Object.fromEntries(new FormData(form));
    const show = (text) => {
      error.textContent = text;
      error.hidden = false;
      notice(text);
    };
    if (!/^1[3-9]\d{9}$/.test(d.phone || "")) return show("请输入正确的 11 位手机号");
    if (!d.password) return show("请输入密码");
    if (turnstileEnabled && !challenge) return show("请先完成人机验证");
    error.hidden = true;
    go.disabled = true;
    go.textContent = "登录中…";
    try {
      const result = await api("auth/login", "POST", {
        phone: d.phone,
        password: d.password,
        ...(turnstileEnabled ? { turnstile: challenge } : {}),
      });
      if (result.need_tenant_choice) yxChooseTenant(card, result);
      else location.assign(base + "app/");
    } catch (err) {
      show(err.message || "登录失败，请稍后重试");
      if (turnstileEnabled && window.turnstile && widget !== undefined) window.turnstile.reset(widget);
      challenge = "";
    } finally {
      go.disabled = false;
      go.textContent = "登录";
    }
  });
  phone.focus?.();
  if (turnstileEnabled) yxTurnstile(challengeNode);
}
function yxTurnstile(node) {
  const render = () =>
    window.turnstile.ready(() => {
      node.replaceChildren();
      widget = window.turnstile.render(node, {
        sitekey: document.querySelector("meta[name=turnstile-key]").content,
        action: "login",
        callback: (token) => (challenge = token),
        "expired-callback": () => (challenge = ""),
        "error-callback": () => {
          challenge = "";
          node.textContent = "人机验证暂时不可用，请刷新重试";
        },
      });
    });
  if (window.turnstile) return render();
  const script = el("script", null, {
    src: "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit",
    async: "",
  });
  script.addEventListener("load", render);
  script.addEventListener("error", () => (node.textContent = "人机验证暂时不可用，请刷新重试"));
  document.head.append(script);
}
// 同一手机号在多家机构都有管理账号、且密码都正确时，选一家进入。只记机构名称用于排序，不存账号。
function yxChooseTenant(card, data) {
  card.replaceChildren();
  let last = "";
  try {
    last = localStorage.getItem(YX_LAST_TENANT) || "";
  } catch {}
  const choices = [...data.choices].sort((a, b) => (b.name === last) - (a.name === last));
  const box = el("div", null, { class: "yx-choose" });
  const left = el("span", "", { class: "yx-choose-timer" });
  const head = el("div", null, { class: "yx-login-head" });
  head.append(el("h2", "选择要进入的机构"), el("p", "你的手机号在以下机构都有账号"));
  box.append(head);
  const list = el("div", null, { class: "yx-choose-list", role: "list" });
  for (const c of choices) {
    const item = el("button", null, { type: "button", class: "yx-choose-item", role: "listitem" });
    const text = el("span", null, { class: "yx-choose-name" });
    text.append(el("strong", c.name));
    if (c.name === last) text.append(el("small", "上次进入"));
    item.append(yxMark({ display_name: c.name, logo: c.logo_url }), text, el("span", "进入 ›", { class: "yx-choose-go" }));
    item.addEventListener("click", async () => {
      for (const b of list.querySelectorAll("button")) b.disabled = true;
      item.classList.add("is-busy");
      try {
        await api("auth/login/choose", "POST", { choice_token: c.choice_token });
        try {
          localStorage.setItem(YX_LAST_TENANT, c.name);
        } catch {}
        location.assign(base + "app/");
      } catch (e) {
        clearInterval(timer);
        notice(e.message || "选择已失效，请重新登录");
        yxLoginForm(card);
      }
    });
    list.append(item);
  }
  box.append(list, left);
  const back = el("button", "‹ 换一个账号登录", { type: "button", class: "yx-btn yx-btn--link" });
  back.addEventListener("click", () => {
    clearInterval(timer);
    yxLoginForm(card);
  });
  box.append(back);
  card.append(box);
  const until = Date.now() + Number(data.ttl || 120) * 1000;
  const tick = () => {
    const s = Math.max(0, Math.round((until - Date.now()) / 1000));
    left.textContent = s ? "请在 " + s + " 秒内选择" : "选择已过期，请重新登录";
    if (!s) {
      clearInterval(timer);
      for (const b of list.querySelectorAll("button")) b.disabled = true;
    }
  };
  const timer = setInterval(tick, 1000);
  tick();
  list.querySelector("button")?.focus?.();
}

// ---------- 机构停用 / 到期 ----------
// 服务器返回 403 tenant_expired：会话保留，不注销；机构恢复后刷新即可继续用。
function yxTenantPaused(message) {
  if (yxState?.paused) return;
  if (yxState) yxState.paused = true;
  root.replaceChildren();
  const page = el("div", null, { class: "yx-paused" }),
    card = el("section", null, { class: "yx-paused-card", role: "alert" });
  if (brand?.display_name && !yxIsRoot()) card.append(yxMark(brand, "is-tile"));
  card.append(
    el("h1", "机构服务暂时停用"),
    el("p", message || "机构已停用或已到期。", { class: "yx-paused-msg" }),
    el("p", "数据都已保留。机构续期或恢复后，刷新本页即可继续使用，不需要重新登录。如有疑问请联系机构负责人。", { class: "yx-paused-sub" }),
  );
  const ops = el("div", null, { class: "yx-paused-ops" }),
    retry = el("button", "重新检查", { type: "button", class: "yx-btn yx-btn--primary" }),
    other = el("button", "用其他账号登录", { type: "button", class: "yx-btn" });
  retry.addEventListener("click", () => location.reload());
  other.addEventListener("click", () => location.assign(base + "login"));
  ops.append(retry, other);
  card.append(ops);
  page.append(card);
  root.append(page);
}

// ---------- 家长端 ----------
// 家长只看机构品牌（不出现平台名称）。课表、课后反馈沿用学员端页面，服务器按 student_id 校验绑定。
const YX_PARENT_LABELS = {
  lessons: { planned: "待上课", completed: "已销课", student_leave: "学员请假", student_no_show: "学员旷课", teacher_leave: "教师请假", cancelled: "机构取消", rescheduled: "已调课" },
  attendance: { planned: "未登记", attended: "出勤", student_leave: "请假", no_show: "旷课", teacher_leave: "教师请假", cancelled: "机构取消" },
  reviews: { pending: "待确认", returned: "已退回", confirmed: "已确认", superseded: "已替换" },
  modules: {},
  actions: {},
};
function yxParentShell() {
  const children = me.children || [];
  yxState.parent = { user: me.user, children };
  try {
    const kept = sessionStorage.getItem("yx_child");
    yxState.child = children.some((c) => c.id === kept) ? kept : children[0]?.id || null;
  } catch {
    yxState.child = children[0]?.id || null;
  }
  if (me.brand) {
    brand = { ...brand, display_name: me.brand.name || brand.display_name, logo: me.brand.logo_url || brand.logo };
    yxApplyTheme(me.brand.primary_color);
  }
  // 旧的学员端页面按“学员”身份读标签与权限；家长端只开放查看类入口。
  me.user = { ...me.user, roles: ["student"] };
  me.labels = YX_PARENT_LABELS;
  me.capabilities = { schedule: { read: true }, packages: { read: true }, tuition: { read: true } };
  me.policy = { modules: {}, settings: {} };
  me.features = {};
  root.replaceChildren();
  const frame = el("div", null, { class: "personal-frame c3-personal v-personal yx-parent" }),
    header = el("header", null, { class: "personal-header yx-parent-head" }),
    who = el("div");
  who.append(el("strong", brand.display_name), el("small", yxState.parent.user.name + " · 家长"));
  header.append(mark(), who);
  if (children.length > 1) {
    const pick = el("select", null, { class: "yx-child-pick", "aria-label": "选择孩子" });
    for (const c of children) pick.append(el("option", c.name, { value: c.id }));
    pick.value = yxState.child;
    pick.addEventListener("change", () => {
      yxState.child = pick.value;
      try {
        sessionStorage.setItem("yx_child", pick.value);
      } catch {}
      apiCache.clear();
      viewCache.clear();
      void select(current);
    });
    header.append(pick);
  } else if (children.length === 1) header.append(el("span", children[0].name, { class: "yx-child-one" }));
  const content = el("section", null, { class: "personal-content" }),
    nav = el("nav", null, { class: "personal-nav", "aria-label": "家长导航" });
  const M = () => globalThis["ChannelV2" + "Mobile"];
  const views = [
    ["schedule", "calendar", "课表", () => M().studentWeek(content)],
    ["records", "edit", "课后反馈", () => yxParentFeedback(content)],
    ["reports", "arrow-up", "成长报告", () => yxParentReports(content)],
    ["plans", "book", "学习方案", () => yxParentPlans(content)],
    ["my", "user", "我的", () => yxParentMine(content)],
  ];
  let current = "schedule",
    run = 0;
  const select = async (key) => {
    const view = views.find((v) => v[0] === key) || views[0];
    current = view[0];
    for (const x of nav.children) x.setAttribute("aria-current", x.dataset.key === current ? "page" : "false");
    content.replaceChildren(UI.tableSkeleton());
    const g = ++run;
    try {
      if (!children.length) return yxParentEmpty(content, "还没有绑定孩子", "请联系机构老师为你的账号绑定孩子。");
      await view[3]();
      // 学员端页面的标题换成家长视角。
      const h1 = content.querySelector("h1");
      const kid = children.find((c) => c.id === yxState.child)?.name || "";
      if (h1 && h1.textContent === "我的课表") h1.textContent = kid + "的课表";
      if (h1 && h1.textContent === "上课记录") h1.textContent = kid + "的课后反馈";
      content.scrollTop = 0;
    } catch (e) {
      if (g === run) content.replaceChildren(UI.empty({ text: e.message, action: { label: "重试", onSelect: () => select(key) } }));
    }
  };
  for (const [key, icon, label] of views) {
    const b = button("", () => select(key));
    b.dataset.key = key;
    b.append(UI.icon(icon), el("span", label));
    nav.append(b);
  }
  frame.append(header, content, nav);
  root.append(frame);
  if (yxState.parent.user.must_change) {
    changePassword(content, true);
    nav.hidden = true;
    return;
  }
  void select("schedule");
}
function yxParentEmpty(c, title, text) {
  c.replaceChildren();
  const box = el("div", null, { class: "yx-empty" });
  box.append(el("h2", title), el("p", text));
  c.append(box);
}
function yxParentMine(c) {
  c.replaceChildren();
  const box = el("div", null, { class: "yx-mine" });
  box.append(el("h2", yxState.parent.user.name), el("p", "家长账号 · " + brand.display_name, { class: "yx-muted" }));
  const kids = el("div", null, { class: "yx-kids" });
  kids.append(el("h3", "我的孩子"));
  for (const k of yxState.parent.children) {
    const row = el("div", null, { class: "yx-kid" });
    row.append(el("strong", k.name), el("span", YX_RELATION[k.relation] ? "我是" + YX_RELATION[k.relation] : "", { class: "yx-muted" }));
    kids.append(row);
  }
  box.append(kids);
  const ops = el("div", null, { class: "yx-mine-ops" });
  ops.append(
    button("课时与缴费", async () => {
      const view = UI.drawer({ title: "课时与缴费" });
      try {
        await globalThis["ChannelV2" + "Mobile"].studentBalance(view.body);
      } catch (e) {
        view.body.replaceChildren(el("p", e.message || "机构暂未开放查看", { class: "yx-muted" }));
      }
    }),
    button("修改密码", () => changePassword(UI.drawer({ title: "修改密码" }).body)),
    button("退出登录", async () => {
      await api("logout", "POST", {});
      location.assign(base + "login");
    }),
  );
  box.append(ops);
  c.append(box);
}

// ---------- 学员档案 ·「家长」页签 ----------
// 主管、教务（parents.manage）给孩子开家长账号、绑定、改称呼、解绑、重置密码、停用。
async function yxGuardians(body, studentId, row, again) {
  const V = globalThis.ChannelV2;
  const key = encodeURIComponent(studentId);
  const data = await api("students/" + key + "/guardians");
  const items = data.items || [];
  const add = items.length < 4 && V.link("＋ 添加家长", () => yxGuardianForm(studentId, row, again));
  const box = V.panel("家长账号", [el("span", null, { class: "v-spacer" }), add || el("span", "已达 4 位上限", { class: "v-muted" })]);
  const address = location.origin + "/" + (me.tenant_slug || "机构代号");
  box.append(el("p", "家长用机构专属地址 " + address + " 登录，只能看到自己孩子的课表、课后反馈和机构发布的内容。一个孩子最多 4 位家长。", { class: "v-muted v-pad yx-guard-intro" }));
  if (!items.length) box.append(el("p", "还没有家长账号。点右上角“添加家长”，输入家长手机号即可。", { class: "v-muted v-pad" }));
  for (const g of items) {
    const line = el("div", null, { class: "yx-guard" }),
      who = el("div", null, { class: "yx-guard-who" });
    who.append(
      el("strong", g.name + (YX_RELATION[g.relation] ? "（" + YX_RELATION[g.relation] + "）" : "")),
      el("span", "手机尾号 " + (g.phone_last4 || "—"), { class: "v-muted" }),
    );
    const state = g.active
      ? V.chip("正常", "ok")
      : V.chip(g.disabled_reason === "no_children" ? "已停用 · 无绑定孩子" : "已停用", "muted");
    const ops = el("div", null, { class: "yx-guard-ops" });
    const more = [
      { label: "修改称呼", onSelect: () => yxRelationForm(studentId, g, again) },
      {
        label: "重置密码",
        onSelect: async () => {
          if (!(await UI.confirm({ title: "重置 " + g.name + " 的密码？", consequence: "原密码失效，这位家长的所有设备立即下线；新的初始密码只显示一次。", danger: true }))) return;
          yxShowParentSecret(await api("parents/" + encodeURIComponent(g.parent_user_id) + "/reset-password", "POST", {}), g.name);
        },
      },
    ];
    if (g.active)
      more.push({
        label: "停用账号",
        danger: true,
        onSelect: async () => {
          if (!(await UI.confirm({ title: "停用家长 " + g.name + "？", consequence: "这位家长立即下线、不能再登录。停用后重新绑定孩子也不会自动恢复，需要在“账号与权限”里手动启用。", danger: true }))) return;
          await api("parents/" + encodeURIComponent(g.parent_user_id) + "/disable", "POST", {});
          notice("已停用", "success");
          await again();
        },
      });
    else
      more.push({
        label: "启用账号",
        onSelect: async () => {
          await yxEnableParent(g);
          notice("已启用", "success");
          await again();
        },
      });
    more.push({
      label: "解除绑定",
      danger: true,
      onSelect: async () => {
        if (!(await UI.confirm({ title: "解除 " + g.name + " 与 " + row.name + " 的绑定？", consequence: "家长立即看不到这个孩子。这是这位家长最后一个孩子时，家长账号会自动停用（再绑定时自动恢复）。", danger: true }))) return;
        await api("students/" + key + "/guardians/" + encodeURIComponent(g.id), "DELETE", { version: g.version });
        notice("已解除绑定", "success");
        await again();
      },
    });
    ops.append(UI.actionMenu({ label: "管理", items: more }).element);
    line.append(who, state, ops);
    box.append(line);
  }
  body.append(box);
}
function yxGuardianForm(studentId, row, again) {
  const { panel, close } = drawer("添加家长 · " + row.name),
    form = el("form");
  form.append(el("p", "家长手机号已经有家长账号（比如兄弟姐妹已绑定）时，直接绑定到原账号，密码不变；否则新建账号并给出初始密码。", { class: "muted" }));
  const phone = field(form, "家长手机号", "phone", "tel");
  phone.inputMode = "tel";
  phone.maxLength = 11;
  phone.placeholder = "11 位手机号";
  field(form, "家长姓名", "name").placeholder = "例如：陈妈妈、陈先生";
  const wrap = el("label", "与孩子的关系", { class: "field" }),
    s = el("select", null, { name: "relation" });
  for (const [v, t] of Object.entries(YX_RELATION)) s.append(el("option", t, { value: v }));
  wrap.append(s);
  form.append(wrap);
  submit(form, "保存", async (d) => {
    if (!/^1[3-9]\d{9}$/.test(d.phone)) throw Error("请输入正确的 11 位手机号");
    const result = await api("students/" + encodeURIComponent(studentId) + "/guardians", "POST", {
      phone: d.phone,
      name: d.name.trim(),
      relation: d.relation,
    });
    await close();
    if (result.temporary_password) yxShowParentSecret(result, d.name.trim());
    else notice("已绑定到现有家长账号，原密码不变", "success");
    await again();
  });
  panel.append(form);
}
function yxRelationForm(studentId, g, again) {
  const { panel, close } = drawer("修改称呼 · " + g.name),
    form = el("form");
  const wrap = el("label", "与孩子的关系", { class: "field" }),
    s = el("select", null, { name: "relation" });
  for (const [v, t] of Object.entries(YX_RELATION)) s.append(el("option", t, { value: v }));
  s.value = g.relation;
  wrap.append(s);
  form.append(wrap);
  submit(form, "保存", async (d) => {
    await api("students/" + encodeURIComponent(studentId) + "/guardians/" + encodeURIComponent(g.id), "PATCH", {
      version: g.version,
      relation: d.relation,
    });
    await close();
    await again();
  });
  panel.append(form);
}
// 停用的家长用原账号接口启用；需要该账号当前版本号，从账号列表里找。
async function yxEnableParent(g) {
  for (let offset = 0; offset <= 5000; offset += 200) {
    const page = await api("accounts?offset=" + offset + "&limit=200");
    const u = (page.items || []).find((x) => x.id === g.parent_user_id);
    if (u) return api("accounts/" + encodeURIComponent(u.id), "PATCH", { version: u.version, name: u.name, roles: u.roles, active: true });
    if (page.next_offset === null || page.next_offset === undefined) break;
  }
  throw Error("没有找到这个家长账号，请刷新后重试");
}
function yxShowParentSecret(data, name) {
  const { panel } = drawer("家长初始密码 · 只显示一次");
  const address = location.origin + "/" + (me.tenant_slug || "");
  const text = (name ? name + "您好，" : "") + "请用手机号登录 " + address + " ，初始密码：" + data.temporary_password + " ，首次登录需要修改密码。";
  panel.append(
    el("p", "请通过微信或当面交给家长。家长首次登录必须修改密码。"),
    el("code", data.temporary_password, { class: "secret" }),
    el("p", text, { class: "yx-secret-msg" }),
    button("复制给家长的话", async () => {
      try {
        await navigator.clipboard.writeText(text);
        notice("已复制", "success");
      } catch {
        notice("请手动选中文字复制");
      }
    }),
  );
}

// ---------- 学员 AI 称呼 ----------
// 默认按姓生成“某同学”；复姓按常见表；外文名用名字本身。
const YX_COMPOUND = "欧阳 司马 上官 诸葛 东方 皇甫 尉迟 公孙 慕容 长孙 宇文 司徒 夏侯 轩辕 令狐 端木 独孤 南宫 西门 申屠".split(" ");
function yxNickname(name) {
  const n = String(name || "").trim();
  if (!n) return "";
  if (!/^[一-龥]/.test(n)) return n;
  const surname = YX_COMPOUND.find((s) => n.startsWith(s) && n.length > s.length) || n[0];
  return surname + "同学";
}

// 顶层编辑器仅在没有子弹层且不处于输入态时响应 Escape。
function yxEditorEscape(e, shell) {
  return e.key === "Escape" && !e.defaultPrevented &&
    !e.target.closest?.("input, textarea, select, [contenteditable]:not([contenteditable=false])") &&
    !document.querySelector(":popover-open, dialog[open]") && shell.isConnected;
}
function yxDisposeEditors() {
  for (const shell of document.querySelectorAll(".yxp-editor")) {
    shell.yxDispose?.();
    shell.remove();
  }
}
