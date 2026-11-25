"use strict";
const root = document.querySelector("#root");
let selected, admin;
function el(tag, text, attrs = {}) {
  const n = document.createElement(tag);
  if (text !== undefined && text !== null) n.textContent = text;
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
}
function button(text, fn, kind = "") {
  const b = el("button", text, { type: "button", class: "button " + kind });
  b.addEventListener("click", () =>
    Promise.resolve(fn()).catch((e) => notice(e.message)),
  );
  return b;
}
function notice(s) {
  const n = document.querySelector("#toast");
  n.textContent = s;
  n.hidden = false;
  setTimeout(() => (n.hidden = true), 8000);
}
async function api(path, method = "GET", data) {
  const r = await fetch("/api/" + path, {
    method,
    headers: method === "GET" ? {} : { "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  let d;
  try {
    d = await r.json();
  } catch {
    throw Error("页面不存在或访问验证已过期");
  }
  if (r.status === 401 && path !== "me" && !/^(login|setup)/.test(path)) {
    // 登录已过期：回到登录页，而不是只弹一句提示。
    admin = null;
    cxHead = null;
    login();
    throw Error("登录已过期，请重新登录");
  }
  if (!r.ok) {
    // 新平台接口错误为 {error: 代码, message: 中文}；旧接口为 {error: 中文, code}。
    const e = Error(d.message || d.error || "操作失败");
    e.code = d.message ? d.error : d.code;
    e.details = d.details;
    throw e;
  }
  return d;
}
function field(form, label, name, value = "", type = "text", required = true) {
  const wrap = el("label", label, { class: "field" }),
    input = el(type === "textarea" ? "textarea" : "input", null, { name });
  if (type !== "textarea") input.type = type;
  input.value = value ?? "";
  if (["seat_price", "suggested_price"].includes(name)) input.step = "0.01";
  input.required = required;
  wrap.append(input);
  form.append(wrap);
  return input;
}
function submit(form, label, handler) {
  const b = el("button", label, { type: "submit", class: "button primary" });
  form.append(b);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    b.disabled = true;
    try {
      await handler(Object.fromEntries(new FormData(form)));
    } catch (e) {
      notice(e.message);
    } finally {
      b.disabled = false;
    }
  });
}
function drawer(title) {
  const cover = el("div", null, { class: "overlay" }),
    panel = el("section", null, {
      class: "drawer",
      role: "dialog",
      "aria-modal": "true",
      "aria-label": title,
    }),
    head = el("div", null, { class: "row" });
  const close = () => {
      cover.remove();
      document.removeEventListener("keydown", key);
    },
    key = (e) => {
      if (e.key === "Escape") close();
    };
  head.append(el("h2", title), button("关闭", close));
  panel.append(head);
  cover.append(panel);
  root.append(cover);
  document.addEventListener("keydown", key);
  return { panel, close };
}
function secret(d) {
  const { panel } = drawer("临时密码 · 仅显示一次");
  panel.append(
    el("p", "请通过可信渠道交给账号使用人，首次登录必须修改。"),
    el("code", d.temporary_password, { class: "secret" }),
    button("复制密码", async () => {
      await navigator.clipboard.writeText(d.temporary_password);
      notice("已复制");
    }),
  );
}
function login() {
  root.replaceChildren();
  const card = el("section", null, { class: "auth-card" }),
    form = el("form");
  form.append(
    el("h1", "平台控制台"),
    el(
      "p",
      document.querySelector("#access-notice")
        ? "请验证账号和动态口令"
        : "Cloudflare Access 已验证 · 请继续验证账号和动态口令",
      {
        class: "muted",
      },
    ),
  );
  field(form, "用户名", "username").autocomplete = "username";
  field(form, "密码", "password", "", "password").autocomplete =
    "current-password";
  field(form, "六位动态口令", "totp").inputMode = "numeric";
  submit(form, "登录", async (d) => {
    await api("login", "POST", d);
    await boot();
  });
  card.append(form, button("首次部署：初始化超管", setup));
  root.append(card);
}
function setup() {
  const { panel, close } = drawer("初始化首个超管"),
    form = el("form");
  form.append(
    el(
      "p",
      "请在自己的手机验证器中绑定下方密钥，并填写当前动态口令。初始化完成后此入口永久关闭。",
      { class: "muted" },
    ),
  );
  const key = field(
    form,
    "初始化口令（Cloudflare Secret）",
    "setup_key",
    "",
    "password",
  );
  let prepared;
  const secretText = el("code", "尚未生成", { class: "secret" });
  form.append(
    button("生成验证器绑定密钥", async () => {
      prepared = await api("setup/prepare", "POST", { setup_key: key.value });
      secretText.textContent = prepared.secret;
    }),
    secretText,
  );
  field(form, "用户名", "username");
  field(form, "密码（含字母和数字，8–64 位）", "password", "", "password");
  field(form, "验证器当前六位动态口令", "totp");
  submit(form, "完成初始化", async (d) => {
    if (!prepared) throw Error("请先生成并绑定验证器密钥");
    await api("setup", "POST", { ...d, ...prepared });
    close();
    notice("初始化成功，请等待下一个动态口令后登录");
  });
  panel.append(form);
}
// 控制台外框：深色侧栏 + 顶栏（标题、面包屑、操作按钮）。主管顾问只看到“推广中心”。
let cxHead = null;
function shell() {
  root.replaceChildren();
  const frame = el("div", null, { class: "app-frame cx-frame" }),
    side = el("aside", null, { class: "cx-side" }),
    main = el("div", null, { class: "main cx-main" }),
    header = el("header", null, { class: "cx-head" }),
    title = el("div", null, { class: "cx-head-title" }),
    actions = el("div", null, { class: "cx-head-actions" });
  let content = el("section", null, { class: "content cx-content" });
  const owner = admin.role !== "consultant";
  const brand = el("div", null, { class: "cx-brand" });
  brand.append(
    el("strong", "艺界星途平台后台"),
    el("small", admin.username + " · " + (owner ? "超级管理员" : "主管顾问")),
  );
  const nav = el("nav", null, { class: "cx-nav", "aria-label": "控制台菜单" });
  const out = button("退出登录", async () => {
    await api("logout", "POST", {});
    login();
  });
  out.classList.add("cx-logout");
  side.append(brand, nav);
  const foot = el("div", null, { class: "cx-side-foot" });
  if (owner) foot.append(el("p", "顾问账号只看到“推广中心”一项"));
  foot.append(out);
  side.append(foot);
  header.append(title, actions);
  main.append(header);
  // 后端提示的安全问题（例如人机验证未开启）常驻在顶栏下面，只有超管看得到。
  if (owner && admin.security_warnings?.length)
    main.append(el("div", "安全提醒：" + admin.security_warnings.join("；") + "。请到 Cloudflare 后台补齐设置。", { class: "cx-sec-warn", role: "alert" }));
  main.append(content);
  frame.append(side, main);
  root.append(frame);
  cxHead = { title, actions };
  const items = [
    ["promo", "推广中心", (c) => cxPromo(c), false],
    ...(owner
      ? [
          ["tenants", "机构管理", (c) => tenants(c), true],
          ["subject-packs", "学科模版包", (c) => yxSubjectPacksPage(c), false],
          ["style-packs", "模版与风格包", (c) => yxStylePacksPage(c), false],
          ["ai", "AI 用量与每日上限", (c) => yxAiUsagePage(c), false],
          ["announcements", "平台公告", (c) => announcementsPage(c), true],
          ["accounts", "控制台账号", (c) => cxAccounts(c), false],
          ["logs", "操作日志", (c) => logs(c), true],
          ["alerts", "安全告警", (c) => securityAlerts(c), true],
          ...(admin.referrals_enabled
            ? [["referrals", "合作升学推荐", (c) => platformReferrals(c), true]]
            : []),
          ["data", "备份与数据导入", (c) => dataTools(c), true],
        ]
      : []),
  ];
  const buttons = [];
  const go = async (item) => {
    for (const b of buttons) b.removeAttribute("aria-current");
    item.button.setAttribute("aria-current", "page");
    // 旧页面自带大标题，顶栏已显示同名标题，旧页面的第一行标题隐藏。
    // 每次切换都换一个新的内容区：上一个页面如果还没加载完，它之后写入的内容落在已移除的旧区域里，不会盖掉当前页面。
    const fresh = el("section", null, { class: "content cx-content" });
    fresh.classList.toggle("cx-legacy", item.legacy);
    fresh.append(el("p", "正在载入…", { class: "muted" }));
    content.replaceWith(fresh);
    content = fresh;
    cxTop(item.label);
    try {
      await item.fn(fresh);
    } catch (e) {
      if (fresh.isConnected) notice(e.message);
    }
  };
  for (const [key, label, fn, legacy] of items) {
    const b = el("button", label, { type: "button", class: "cx-nav-item", "data-key": key });
    const item = { key, label, fn, legacy, button: b };
    b.addEventListener("click", () => go(item));
    buttons.push(b);
    nav.append(b);
    if (key === "promo") cxHead.home = () => go(item);
  }
  cxHead.home();
}
const typeOptions = ["音乐培训", "音乐艺考", "美术艺考", "其他"];
function tenantFields(form, t = {}) {
  field(form, "机构名称", "name", t.name);
  const wrap = el("label", "机构类型", { class: "field" }),
    select = el("select", null, { name: "type" });
  for (const x of typeOptions) select.append(el("option", x, { value: x }));
  select.value = t.type || "其他";
  wrap.append(select);
  form.append(wrap);
  field(form, "城市", "city", t.city, "text", false);
  const slug = field(
    form,
    "机构路径（小写字母、数字、连字符，3–40 位）",
    "slug",
    t.slug,
  );
  form.append(
    el("p", "请避免 jigou1、jigou2 等可猜测的连续路径。", { class: "muted" }),
    button("生成建议路径", () => {
      const latin =
        window.pinyinPro
          .pinyin(String(form.elements.name.value), {
            toneType: "none",
            separator: "-",
          })
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 28) || "jigou";
      slug.value =
        latin +
        "-" +
        Array.from(
          crypto.getRandomValues(new Uint8Array(4)),
          (x) => "abcdefghijklmnopqrstuvwxyz0123456789"[x % 36],
        ).join("");
    }),
  );
  field(
    form,
    "到期日（北京时间当日结束后停用，可留空）",
    "expires_at",
    t.expires_at,
    "date",
    false,
  );
  field(
    form,
    "管理账号上限（主管、顾问、教务、财务；不含教师、家长）",
    "staff_seat_limit",
    t.staff_seat_limit || 20,
    "number",
  );
  field(
    form,
    "学员账号上限",
    "student_seat_limit",
    t.student_seat_limit ?? 200,
    "number",
  );
}
function normalized(d) {
  return {
    ...d,
    staff_seat_limit: Number(d.staff_seat_limit),
    student_seat_limit: Number(d.student_seat_limit),
    expires_at: d.expires_at || null,
  };
}
async function tenants(c, offset = 0) {
  const { items, backups } = await api("overview?offset=" + offset);
  c.replaceChildren();
  const tools = el("div", null, { class: "row" });
  tools.append(
    el("h1", "机构总览"),
    button(
      "＋ 开通机构",
      () => {
        const { panel, close } = drawer("开通机构"),
          form = el("form");
        tenantFields(form);
        field(form, "联系人（加密存储，可留空）", "contact", "", "text", false);
        submit(form, "开通机构", async (d) => {
          const result = await api("tenants", "POST", normalized(d));
          close();
          await detail(c, result.id);
        });
        panel.append(form);
      },
      "primary",
    ),
  );
  c.append(tools);
  const stats = el("section", null, { class: "stats" });
  for (const [label, value] of [
    ["当前页机构", items.length],
    ["启用", items.filter((t) => t.status === "active").length],
    ["暂停", items.filter((t) => t.status === "paused").length],
  ]) {
    const card = el("div", null, { class: "panel" });
    card.append(el("p", label, { class: "muted" }), el("h1", value));
    stats.append(card);
  }
  c.append(stats);
  const latest = backups?.[0];
  if (latest)
    c.append(
      el("p", "最近备份：" + bjt(latest.at) + " · " + latest.status_label, {
        class: latest.status === "completed" ? "muted" : "error",
      }),
    );
  const table = el("table"),
    head = el("tr");
  for (const h of [
    "机构",
    "类型 · 城市",
    "访问路径",
    "状态",
    "到期日",
    "账号上限",
    "学员 / 本月课次",
    "最近登录 / 24小时登录失败",
    "操作",
  ])
    head.append(el("th", h));
  table.append(head);
  for (const t of items) {
    const row = el("tr");
    for (const value of [
      t.name,
      t.type + " · " + t.city,
      "/" + t.slug,
      t.status === "active" ? "启用" : "已停用",
      t.expires_at || "未设置",
      t.staff_seat_limit + " 员工 / " + t.student_seat_limit + " 学员",
      t.student_count + " / " + t.lesson_count,
      (t.last_active ? bjt(t.last_active) : "暂无登录") +
        " / " +
        t.login_failures,
    ])
      row.append(el("td", value));
    const action = el("td");
    action.append(button("管理", () => detail(c, t.id)));
    row.append(action);
    table.append(row);
  }
  const panel = el("section", null, { class: "table-wrap" });
  panel.append(table);
  c.append(panel);
  if (offset)
    c.append(button("上一页", () => tenants(c, Math.max(0, offset - 200))));
  if (items.length === 200)
    c.append(button("下一页", () => tenants(c, offset + 200)));
  if (!items.length)
    c.append(el("p", "尚未开通机构，请先创建第一个机构。", { class: "muted" }));
}
async function detail(c, id) {
  selected = await api("tenants/" + id);
  const { tenant: t, brand: b, policy, users } = selected;
  c.replaceChildren(
    button("‹ 返回机构总览", () => tenants(c)),
    el("h1", t.name),
  );
  c.append(
    button("只读业务查看 / 代管", () => businessView(c, id)),
    button("机构导出 / 备份恢复 / 旧版导入", () => dataTools(c, id)),
  );
  const grid = el("section", null, { class: "grid" }),
    basic = el("form", null, { class: "panel" });
  basic.append(el("h2", "基本信息与访问路径"));
  tenantFields(basic, t);
  basic.append(
    el(
      "p",
      "当前状态：" + (t.status === "active" ? "启用" : "已停用") + "（停用与恢复在下方“停用与删除”里操作）。修改路径将保留旧路径 30 天，并使本机构所有账号重新登录；停用、到期不会让账号退出，恢复后可直接继续使用。",
      { class: "muted" },
    ),
  );
  submit(basic, "保存机构信息", async (d) => {
    if (!(await cxAsk("确认修改？修改机构路径会使所有账号重新登录。"))) return;
    await api("tenants/" + id, "PATCH", {
      ...normalized(d),
      status: t.status,
      version: t.version,
    });
    await detail(c, id);
    notice("已保存");
  });
  grid.append(basic);
  grid.append(await lifecyclePanel(c, t));
  // 艺界星途：学科模板、新功能开关、AI 每日上限、强制全机构下线（新平台接口 /api/ops/tenants）。
  for (const panel of await yxOpsPanel(c, id)) grid.append(panel);
  grid.append(await yxGalleryStoragePanel(c, id));
  const brandForm = el("form", null, { class: "panel" });
  brandForm.append(el("h2", "机构品牌"));
  field(brandForm, "显示名称", "display_name", b.display_name);
  field(brandForm, "主题色", "theme_color", b.theme_color, "color");
  field(
    brandForm,
    "欢迎语（最多 60 字）",
    "welcome_text",
    b.welcome_text,
    "textarea",
    false,
  );
  field(
    brandForm,
    "续费通知联系说明",
    "contact_text",
    b.contact_text || "",
    "textarea",
    false,
  );
  let images = {
    logo: b.logo,
    login_bg: b.login_bg,
    consultant_qr: b.consultant_qr,
  };
  for (const [key, label] of [
    ["logo", "机构 Logo"],
    ["login_bg", "登录背景图"],
    ["consultant_qr", "顾问二维码"],
  ]) {
    const input = field(brandForm, label, key, "", "file", false);
    input.accept = "image/png,image/jpeg,image/webp";
    input.addEventListener("change", async () => {
      try {
        images[key] = await compactImage(input.files[0], b.image_budget);
        notice("图片已压缩，保存品牌后生效");
      } catch (e) {
        input.value = "";
        notice(e.message);
      }
    });
    if (images[key])
      brandForm.append(
        el("img", null, {
          src: images[key],
          alt: label,
          class: "brand-preview",
        }),
      );
    brandForm.append(
      button("清除" + label, () => {
        images[key] = null;
        input.value = "";
      }),
    );
  }
  submit(brandForm, "保存品牌", async (d) => {
    await api("tenants/" + id + "/brand", "PUT", {
      display_name: d.display_name,
      theme_color: d.theme_color,
      welcome_text: d.welcome_text,
      contact_text: d.contact_text,
      ...images,
      version: b.version,
    });
    await detail(c, id);
    notice("品牌已更新");
  });
  grid.append(brandForm);
  const modulePanel = el("section", null, { class: "panel" });
  modulePanel.append(
    el("h2", "功能模块"),
    el("p", "关闭后接口立即拒绝访问。", { class: "muted" }),
  );
  const names = {
    home: "工作台",
    schedule: "周课表",
    templates: "固定排课",
    lessons: "课程管理",
    attendance: "销课与补课",
    students: "学员档案",
    followup: "教务跟进",
    packages: "课时包",
    tuition: "学费收款",
    teacher_pay: "教师课酬",
    settlements: "月度结算",
    reports: "统计报表",
    exports: "导出",
    settings: "基础设置",
    accounts: "账号与权限",
    logs: "操作记录",
    profile: "个人中心",
    classes: "班级与集训班",
    leads: "试听与线索",
    referrals: "升学意向",
    imports: "Excel 导入",
    comments: "课后点评",
    promo: "推广中心",
    prices: "报价价格",
    feedback: "课后反馈（新）",
    parents: "家长管理",
    ai: "AI 工具",
    usage: "AI 用量",
  };
  // 招生内容、课程方案、成长报告、院校库在上方“艺界星途功能”里统一开关，这里不重复显示。
  const yxManaged = new Set(["content", "plans", "growth_reports", "school_db"]);
  for (const [module, enabled] of Object.entries(policy.modules)) {
    if (yxManaged.has(module)) continue;
    const label = el("label", names[module] || module, { class: "switch-row" }),
      input = el("input", null, { type: "checkbox" });
    input.checked = enabled;
    input.addEventListener("change", async () => {
      try {
        await api("tenants/" + id + "/modules", "PUT", {
          module,
          enabled: input.checked,
        });
        notice("模块权限已更新");
      } catch (e) {
        input.checked = !input.checked;
        notice(e.message);
      }
    });
    label.append(input);
    modulePanel.append(label);
  }
  grid.append(modulePanel);
  const accounts = el("section", null, { class: "panel" });
  accounts.append(
    el("h2", "机构主管账号"),
    button("＋ 创建主管", () => {
      const { panel, close } = drawer("创建主管账号"),
        form = el("form");
      field(form, "姓名", "name");
      field(form, "手机号", "phone", "", "tel");
      submit(form, "创建主管", async (d) => {
        const result = await api("tenants/" + id + "/supervisors", "POST", {
          ...d,
          roles: ["supervisor"],
        });
        close();
        await detail(c, id);
        secret(result);
      });
      panel.append(form);
    }),
  );
  for (const u of users.filter((x) => x.roles.includes("supervisor"))) {
    const row = el("div", null, { class: "row" });
    row.append(
      el("p", u.name + " · " + u.phone),
      button("重置密码", async () => {
        if (!(await cxAsk("重置后该账号所有设备将下线，继续吗？"))) return;
        secret(
          await api("tenants/" + id + "/reset-password", "POST", {
            user_id: u.id,
          }),
        );
      }),
    );
    accounts.append(row);
  }
  accounts.append(
    el("p", "月度结算的提交、批准、退回与解锁请由机构财务和主管操作。", {
      class: "muted",
    }),
  );
  grid.append(accounts);
  c.append(grid);
}
async function compactImage(file, budget) {
  if (!Number.isInteger(budget) || budget <= 0)
    throw Error("请刷新页面后重新选择图片");
  if (!file) throw Error("请选择图片");
  if (
    !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
    file.size > 2097152
  )
    throw Error("请选择 2 MB 以内的 PNG、JPEG 或 WebP");
  const bitmap = await createImageBitmap(file),
    canvas = document.createElement("canvas"),
    ratio = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  canvas.width = Math.round(bitmap.width * ratio);
  canvas.height = Math.round(bitmap.height * ratio);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const result = canvas.toDataURL("image/webp", 0.78);
  if (result.length > budget)
    throw Error("压缩后仍超过" + budget + "字节，请使用更小的图片");
  return result;
}
async function securityAlerts(c, offset = 0) {
  const data = await api("alerts?offset=" + offset);
  c.replaceChildren(
    el("h1", "安全告警"),
    el(
      "p",
      "读取超量、异地登录、失败登录及请求限流告警。请结合机构正常使用核对设备和操作。",
    ),
  );
  if (!data.items.length) c.append(el("p", "暂无安全告警", { class: "muted" }));
  for (const item of data.items) {
    const p = el("section", null, { class: "panel" });
    p.append(
      el("strong", item.action + " · " + bjt(item.at)),
      el(
        "p",
        (item.tenant_name || "机构已删除") +
          " · " +
          (item.user_name || "未识别账号"),
      ),
      el("p", item.detail),
      el("small", item.ip || ""),
    );
    c.append(p);
  }
  if (offset)
    c.append(
      button("上一页", () => securityAlerts(c, Math.max(0, offset - 200))),
    );
  if (data.items.length === 200)
    c.append(button("下一页", () => securityAlerts(c, offset + 200)));
}
const LOG_ACTIONS = {
  login_success: "超管登录成功",
  login_failed: "超管登录失败",
  create_supervisor: "创建机构主管",
  reset_password: "重置账号密码",
  referrals_view: "查看合作升学推荐",
  business_view: "只读查看机构数据",
  maintenance_write: "维护写入机构数据",
  tenant_export: "加密导出机构数据",
};
// 日志详情可能是很长的一行 JSON：列表只看一句话，完整内容在日志区域内换行展开。
function logSummary(detail) {
  const text = String(detail ?? "").trim();
  if (!text) return { brief: "", full: "" };
  try {
    const value = JSON.parse(text);
    if (value && typeof value === "object") {
      const keys = Object.keys(value);
      const counts = keys
        .filter((k) => typeof value[k] === "number")
        .slice(0, 4)
        .map((k) => k + " " + value[k]);
      return {
        brief:
          "详细内容共 " + keys.length + " 项" + (counts.length ? "：" + counts.join("、") : ""),
        full: JSON.stringify(value, null, 2),
      };
    }
  } catch {}
  return { brief: text.length > 90 ? text.slice(0, 90) + "…" : text, full: text.length > 90 ? text : "" };
}
async function logs(c, offset = 0) {
  c.replaceChildren(el("h1", "平台操作日志"));
  const [{ items }, tenants] = await Promise.all([
    api("logs?offset=" + offset),
    consoleTenants().catch(() => []),
  ]);
  const names = new Map(tenants.map((t) => [t.id, t.name]));
  if (offset)
    c.append(button("上一页", () => logs(c, Math.max(0, offset - 200))));
  if (items.length === 200)
    c.append(button("下一页", () => logs(c, offset + 200)));
  for (const item of items) {
    const row = el("section", null, { class: "panel log-row" }),
      { brief, full } = logSummary(item.detail),
      tenant = item.tenant_id ? names.get(item.tenant_id) || "已删除或未知机构" : "平台";
    row.append(
      el("strong", (LOG_ACTIONS[item.action] || "其他操作") + " · " + bjt(item.at)),
      el("p", brief, { class: "log-brief" }),
    );
    if (full) {
      const pre = el("pre", full, { class: "log-full", hidden: "" }),
        toggle = button("展开完整内容", () => {
          pre.hidden = !pre.hidden;
          toggle.textContent = pre.hidden ? "展开完整内容" : "收起";
        });
      row.append(toggle, pre);
    }
    row.append(el("small", tenant + (item.ip ? " · " + item.ip : "")));
    c.append(row);
  }
}
// D1：机构停用 → 恢复；超级管理员在停用满冷静期、完整导出后可彻底删除（分批进行，可中断续跑）。
const PURGE_COOLDOWN_DAYS = 7;
async function lifecyclePanel(c, t) {
  const p = el("section", null, { class: "panel lifecycle" });
  p.append(el("h2", "停用与删除"));
  const redraw = () => detail(c, t.id);
  if (t.status === "active") {
    p.append(
      el("p", "停用后：机构所有账号暂时不能使用（不会被踢下线，恢复后可直接继续用），学员端、家长端、公开课表图片、推广报名全部停止；数据全部保留。需要立刻让所有人退出登录时，用右侧“强制全机构下线”。", { class: "muted" }),
      button("停用这个机构", async () => {
        const reason = await cxAskText("停用“" + t.name + "”？", "请写明原因（至少 5 个字），会记入平台日志。", "停用");
        if (!reason) return;
        await api("tenants/" + t.id + "/disable", "POST", { version: t.version, reason, operation_id: crypto.randomUUID() });
        notice("已停用");
        await redraw();
      }),
    );
    return p;
  }
  const since = t.disabled_at ? Number(t.disabled_at) : null;
  p.append(
    el(
      "p",
      "已停用" + (since ? " · " + bjt(since) : "") + (t.disabled_reason ? " · 原因：" + t.disabled_reason : ""),
      { class: "status-line" },
    ),
  );
  const job = await api("tenants/" + t.id + "/purge").catch(() => null);
  const running = job && job.status === "running";
  if (!running)
    p.append(
      button("恢复启用", async () => {
        const reason = await cxAskText("恢复“" + t.name + "”？", "恢复后，之前已登录且未过期的账号可以直接继续使用。请写明原因（至少 5 个字）。", "恢复");
        if (!reason) return;
        await api("tenants/" + t.id + "/enable", "POST", { version: t.version, reason, operation_id: crypto.randomUUID() });
        notice("已恢复启用");
        await redraw();
      }),
    );
  if (admin.role !== "owner") return p;
  const box = el("div", null, { class: "danger-zone" });
  box.append(el("h3", "彻底删除（不可恢复）"));
  const ready = since ? since + PURGE_COOLDOWN_DAYS * 86400000 : null;
  const progress = el("p", "", { class: "muted", role: "status" });
  async function loop(state) {
    let s = state;
    while (s && s.status === "running") {
      progress.textContent = "正在删除… 第 " + (s.phase + 1) + " / " + s.total_phases + " 步" + (s.current_table ? "（" + s.current_table + "）" : "（图片与收尾）");
      try {
        s = await api("tenants/" + t.id + "/purge/step", "POST", { job_id: s.id, phase: s.phase });
      } catch (e) {
        progress.textContent = "中断：" + e.message + "。可以稍后点“继续删除”。";
        await new Promise((r) => setTimeout(r, 1500));
        s = await api("tenants/" + t.id + "/purge").catch(() => null);
        if (!s || s.status !== "running") break;
      }
    }
    if (s && s.status === "completed") {
      const rows = Object.values(s.counts || {}).reduce((a, b) => a + Number(b || 0), 0);
      notice("已彻底删除“" + (s.tenant_name || t.name) + "”，共 " + rows + " 行");
      await tenants(c);
    }
  }
  if (running) {
    box.append(progress, button("继续删除", () => loop(job), "primary"));
    p.append(box);
    progress.textContent = "上次删除没有完成，第 " + (job.phase + 1) + " / " + job.total_phases + " 步。";
    return p;
  }
  if (ready && Date.now() < ready) {
    box.append(el("p", "停用满 " + PURGE_COOLDOWN_DAYS + " 天后才能彻底删除，最早 " + bjt(ready) + "。", { class: "muted" }));
    p.append(box);
    return p;
  }
  box.append(
    el("p", "第一步：导出完整加密备份并保存到电脑（24 小时内有效）。第二步：输入机构全名、原因和两步验证码。删除后只留一条平台日志。", { class: "muted" }),
  );
  let exported = false;
  const exportState = el("p", "", { class: "muted", role: "status" });
  box.append(
    button("① 导出完整备份", async () => {
      const start = await api("tenants/" + t.id + "/export/start", "POST", {});
      const out = { tenant: t.name, tenant_id: t.id, export_id: start.export_id, exported_at: Date.now(), tables: {} };
      let done = false;
      for (const table of start.tables) {
        out.tables[table] = [];
        for (let offset = 0; offset !== null; ) {
          exportState.textContent = "正在导出 " + table + " …";
          const page = await api("tenants/" + t.id + "/export?export_id=" + encodeURIComponent(start.export_id) + "&table=" + encodeURIComponent(table) + "&offset=" + offset);
          out.tables[table].push(page.envelope);
          done = done || page.completed;
          offset = page.next_offset;
        }
      }
      const file = downloadData(out, t.slug + "-完整备份-" + bjt(Date.now()).slice(0, 10) + ".json");
      document.body.append(file.a);
      file.a.click();
      setTimeout(() => {
        file.a.remove();
        file.close();
      }, 4000);
      exported = done;
      exportState.textContent = done ? "已导出并下载，请确认文件已保存。" : "导出未完成，请重试。";
    }),
    exportState,
  );
  const form = el("form");
  field(form, "机构全名（逐字一致）", "confirm_name", "");
  field(form, "删除原因", "reason", "");
  field(form, "两步验证码（6 位）", "totp", "");
  submit(form, "② 彻底删除", async (d) => {
    if (!exported && !(await cxAsk("本次没有在这里导出备份", "服务器会检查 24 小时内是否完成过完整导出；没有会拒绝。继续吗？", "继续", "danger"))) return;
    if (d.confirm_name !== t.name) throw Error("机构全名不一致");
    if (!(await cxAsk("彻底删除“" + t.name + "”？", "学员、课时、流水、缴费、账号全部删除且不能恢复。", "彻底删除", "danger"))) return;
    const s = await api("tenants/" + t.id + "/purge", "POST", { confirm_name: d.confirm_name, reason: d.reason, totp: d.totp, operation_id: crypto.randomUUID() });
    box.append(progress);
    await loop(s);
  });
  box.append(form);
  p.append(box);
  return p;
}
async function boot() {
  try {
    admin = await api("me");
    shell();
  } catch {
    login();
  }
}
boot();
function bjt(at) {
  return new Date(at).toLocaleString("sv-SE", {
    timeZone: "Asia/Shanghai",
    hour12: false,
  });
}
function downloadData(value, name) {
  const url = URL.createObjectURL(
      new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
    ),
    a = el("a", "下载文件", { href: url, download: name, class: "button" });
  return { a, close: () => URL.revokeObjectURL(url) };
}
async function consoleTenants() {
  const rows = [];
  for (let offset = 0; offset < 100000; offset += 200) {
    const page = (await api("tenants?offset=" + offset)).items;
    rows.push(...page);
    if (page.length < 200) return rows;
  }
  throw Error("机构过多，请缩小范围");
}
function choice(form, label, name, options, value = "") {
  const wrap = el("label", label, { class: "field" }),
    select = el("select", null, { name });
  select.append(el("option", "请选择", { value: "" }));
  for (const row of options)
    select.append(el("option", row.name, { value: row.id }));
  select.value = value;
  select.required = true;
  wrap.append(select);
  form.append(wrap);
  return select;
}
async function announcementsPage(c, offset = 0) {
  c.replaceChildren(
    el("h1", "平台公告"),
    el(
      "p",
      "机构侧显示为“系统消息”，仅指定机构和角色可见。推广课程与物料在后续推广中心阶段实现。",
      { class: "muted" },
    ),
  );
  const { items } = await api("announcements?offset=" + offset);
  c.append(
    button(
      "＋ 发布系统公告",
      async () => {
        const { panel, close } = drawer("发布系统公告"),
          form = el("form"),
          tenants = await consoleTenants();
        field(form, "标题", "title");
        field(form, "正文（纯文字）", "content", "", "textarea");
        const mode = choice(
          form,
          "发送范围",
          "scope",
          [
            { id: "all", name: "全部当前机构" },
            { id: "type", name: "按机构类型" },
            { id: "selected", name: "指定机构" },
          ],
          "selected",
        );
        const type = choice(
          form,
          "机构类型",
          "type",
          typeOptions.map((name) => ({ id: name, name })),
          typeOptions[0],
        );
        type.required = false;
        const targetChecks = [],
          roleChecks = [];
        const targets = el("fieldset");
        targets.append(el("legend", "指定机构"));
        for (const t of tenants) {
          const l = el("label", t.name, { class: "switch-row" }),
            input = el("input", null, { type: "checkbox", value: t.id });
          l.append(input);
          targets.append(l);
          targetChecks.push(input);
        }
        form.append(targets);
        const roles = el("fieldset");
        roles.append(el("legend", "可见角色"));
        for (const [value, name] of [
          ["supervisor", "主管"],
          ["academic", "教务"],
          ["finance", "财务"],
          ["teacher", "教师"],
          ["student", "学员"],
        ]) {
          const l = el("label", name, { class: "switch-row" }),
            input = el("input", null, { type: "checkbox", value });
          input.checked = ["supervisor", "academic"].includes(value);
          l.append(input);
          roles.append(l);
          roleChecks.push(input);
        }
        form.append(roles);
        field(
          form,
          "显示时间（北京时间）",
          "starts_at",
          bjt(Date.now()).slice(0, 16).replace(" ", "T"),
          "datetime-local",
        );
        field(
          form,
          "结束时间（可不填，北京时间）",
          "ends_at",
          "",
          "datetime-local",
          false,
        );
        const sync = () => {
          targets.hidden = mode.value !== "selected";
          type.closest("label").hidden = mode.value !== "type";
        };
        mode.addEventListener("change", sync);
        sync();
        submit(form, "确认发布", async (d) => {
          const ids =
            mode.value === "all"
              ? tenants.map((t) => t.id)
              : mode.value === "type"
                ? tenants.filter((t) => t.type === type.value).map((t) => t.id)
                : targetChecks.filter((x) => x.checked).map((x) => x.value);
          const chosen = roleChecks
            .filter((x) => x.checked)
            .map((x) => x.value);
          if (!ids.length || !chosen.length)
            throw Error("请选择发送机构和可见角色");
          if (!(await cxAsk("向 " + ids.length + " 个机构发布系统消息，确认吗？")))
            return;
          for (let i = 0; i < ids.length; i += 200)
            await api("announcements", "POST", {
              title: d.title,
              content: d.content,
              roles: chosen,
              tenants: ids.slice(i, i + 200),
              starts_at: Date.parse(d.starts_at + ":00+08:00"),
              ends_at: d.ends_at ? Date.parse(d.ends_at + ":00+08:00") : null,
            });
          close();
          await announcementsPage(c);
        });
        panel.append(form);
      },
      "primary",
    ),
  );
  for (const row of items) {
    const p = el("section", null, { class: "panel" });
    p.append(
      el("h2", row.title),
      el("p", row.content, { class: "preserve-text" }),
      el(
        "p",
        bjt(row.starts_at) +
          (row.ends_at ? " 至 " + bjt(row.ends_at) : "") +
          " · " +
          JSON.parse(row.tenants).length +
          " 个机构",
      ),
    );
    // D1：已发出的公告可撤回；撤回后机构端立即看不到，这里保留并标明原因。
    if (row.status === "withdrawn")
      p.append(
        el(
          "p",
          "已撤回" + (row.withdrawn_at ? " · " + bjt(row.withdrawn_at) : "") + (row.withdrawal_reason ? " · " + row.withdrawal_reason : ""),
          { class: "muted" },
        ),
      );
    else
      p.append(
        button("撤回", async () => {
          const reason = await cxAskText("撤回这条公告？", "撤回后机构端的系统消息和今天页通知都不再显示，未读数同步减少。请写明原因（至少 5 个字）。", "撤回");
          if (!reason) return;
          await api("announcements/" + row.id + "/withdraw", "POST", { reason, operation_id: crypto.randomUUID() });
          notice("已撤回");
          await announcementsPage(c, offset);
        }),
      );
    if (row.status === "withdrawn") p.classList.add("is-withdrawn");
    c.append(p);
  }
  if (offset)
    c.append(button("上一页", () => announcementsPage(c, offset - 200)));
  if (items.length === 200)
    c.append(button("下一页", () => announcementsPage(c, offset + 200)));
}
async function platformReferrals(c, offset = 0) {
  const { items } = await api("referrals?offset=" + offset);
  c.replaceChildren(
    el("h1", "合作升学推荐"),
    el(
      "p",
      "仅用于已登记家长同意的合作服务跟进；不发送外部系统。查看联系方式已留平台审计。",
      { class: "muted" },
    ),
  );
  for (const row of items) {
    const p = el("section", null, { class: "panel" });
    p.append(
      el("h2", row.name + " · " + row.tenant_name),
      el(
        "p",
        [row.grade, row.direction, row.intention].filter(Boolean).join(" · "),
      ),
      el("p", "家长联系方式：" + row.parent_phone),
      el(
        "p",
        "同意人 " +
          row.consent_name +
          " · " +
          row.consent_at.slice(0, 16).replace("T", " ") +
          " · " +
          row.consent_method +
          " · 经办 " +
          row.consent_operator,
      ),
      el(
        "p",
        { submitted: "已提交", received: "已接收", withdrawn: "已撤回" }[
          row.status
        ],
      ),
    );
    if (row.status === "submitted")
      p.append(
        button("标记已接收", async () => {
          await api(
            "tenants/" + row.tenant_id + "/referrals/" + row.id,
            "POST",
            {},
          );
          await platformReferrals(c, offset);
        }),
      );
    c.append(p);
  }
  if (offset)
    c.append(button("上一页", () => platformReferrals(c, offset - 200)));
  if (items.length === 200)
    c.append(button("下一页", () => platformReferrals(c, offset + 200)));
}
async function dataTools(c, tenantId = null) {
  c.replaceChildren(el("h1", "机构数据工具"));
  const tenants = await consoleTenants(),
    form = el("form", null, { class: "panel" }),
    select = choice(form, "目标机构", "tenant", tenants, tenantId);
  submit(form, "打开数据工具", () => dataTools(c, select.value));
  c.append(form);
  if (!tenantId) return;
  const tenant = tenants.find((t) => t.id === tenantId);
  if (!tenant) throw Error("机构不存在");
  const prefix = "tenants/" + tenantId + "/jobs";
  const jobs = (await api(prefix)).items,
    active = jobs.filter((j) => ["staging", "ready"].includes(j.status));
  for (const job of active) {
    const panel = el("section", null, { class: "panel" });
    panel.append(
      el(
        "h2",
        "未完成的" + (job.kind === "restore" ? "恢复" : "导入") + "作业",
      ),
      el("p", bjt(job.created_at) + " · " + job.reason),
      el("p", "业务写入暂时锁定，原数据仍可读取。完成或取消此作业后解除。"),
    );
    if (job.kind === "restore")
      panel.append(button("继续恢复作业", () => restoreJob(job.id)));
    panel.append(
      button("取消作业并保留原数据", async () => {
        if (!(await cxAsk("取消暂存作业，现有业务数据不变，继续吗？"))) return;
        await api(prefix + "/" + job.id + "/cancel", "POST", {});
        await dataTools(c, tenantId);
      }),
    );
    c.append(panel);
  }
  const exports = el("section", null, { class: "panel" });
  exports.append(
    el("h2", "按机构加密导出"),
    el(
      "p",
      "导出业务数据和业务设置，不导出密码和会话。文件加密，密钥须另行保管。",
    ),
  );
  const exportLink = el("div");
  exports.append(
    button("生成机构导出文件", async () => {
      const manifest = await api("tenants/" + tenantId + "/export-schema"),
        pages = [];
      for (const table of manifest.tables) {
        for (let offset = 0; ;) {
          const page = await api(
            "tenants/" +
              tenantId +
              "/export?table=" +
              table +
              "&offset=" +
              offset,
          );
          pages.push(page);
          if (page.next_offset === null) break;
          offset = page.next_offset;
        }
      }
      const file = downloadData(
        { format: "channel-tenant-encrypted-v1", tenant_id: tenantId, pages },
        tenant.name + "-业务加密备份.json",
      );
      exportLink.replaceChildren(file.a);
    }),
    exportLink,
  );
  c.append(exports);
  const restore = el("form", null, { class: "panel" });
  restore.append(
    el("h2", "从每日备份恢复当前机构"),
    el(
      "p",
      "恢复业务和业务设置，保留当前账号、权限、品牌、路径与审计，全部机构会话失效。若破坏账号与档案关联，将阻止恢复。",
      { class: "impact-note" },
    ),
  );
  const backups = (await api("backups")).items.filter(
    (x) => x.status === "completed",
  );
  choice(
    restore,
    "成功备份",
    "backup",
    backups.map((x) => ({ id: x.id, name: bjt(x.at) })),
  );
  field(restore, "恢复原因（至少5字）", "reason");
  submit(restore, "暂存恢复备份", async (d) => {
    if (active.length) throw Error("请先完成或取消未结束作业");
    const job = await api(prefix, "POST", {
      kind: "restore",
      backup_id: d.backup,
      reason: d.reason,
    });
    await restoreJob(job.id);
  });
  c.append(restore);
  const legacy = el("form", null, { class: "panel" });
  legacy.append(
    el("h2", "旧版 0.9.3 教务 JSON 导入"),
    el(
      "p",
      "仅可导入业务数据为空的机构；不导入旧密码、会话。先暂存和校验，再确认提交，异常不会改写现有业务。",
    ),
  );
  const input = field(legacy, "旧版教务 JSON", "file", "", "file");
  input.accept = ".json";
  field(legacy, "导入原因（至少5字）", "reason");
  submit(legacy, "上传并预览旧数据", async (d) => {
    if (active.length) throw Error("请先完成或取消未结束作业");
    const file = input.files[0];
    if (!file || file.size > 20000000)
      throw Error("请选择不超过20MB的旧版 JSON 文件");
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      throw Error("JSON 格式不正确");
    }
    const schema = await api("tenants/" + tenantId + "/export-schema"),
      keys = schema.legacy_tables,
      counts = {};
    for (const key of keys) {
      if (data[key] !== undefined && !Array.isArray(data[key]))
        throw Error("旧数据表格式不正确：" + key);
      if (data[key]?.length) counts[key] = data[key].length;
    }
    const job = await api(prefix, "POST", {
        kind: "legacy",
        counts,
        settings: data.settings || {},
        reason: d.reason,
      }),
      progress = el("p", "开始暂存");
    legacy.append(progress);
    try {
      for (const key of Object.keys(counts))
        for (let i = 0; i < data[key].length; i += 200) {
          await api(prefix + "/" + job.id + "/page", "POST", {
            table: key,
            rows: data[key].slice(i, i + 200),
          });
          progress.textContent =
            "暂存 " +
            (schema.legacy_labels[key] || "业务记录") +
            "：" +
            Math.min(i + 200, data[key].length) +
            " / " +
            data[key].length;
        }
      const preview = await api(prefix + "/" + job.id + "/preview", "POST", {}),
        p = el("section", null, { class: "panel" });
      p.append(el("h2", "旧数据导入预览"));
      for (const [table, n] of Object.entries(preview.counts))
        if (n)
          p.append(
            el("p", (schema.labels[table] || "业务记录") + "：" + n + "条"),
          );
      for (const warning of preview.warnings)
        p.append(el("p", warning, { class: "impact-note" }));
      p.append(
        button(
          "确认导入当前空机构",
          async () => {
            if (
              !(await cxAsk(
                "确认将已校验的旧业务导入 " +
                  tenant.name +
                  "？不迁移旧账号密码。",
              ))
            )
              return;
            await api(prefix + "/" + job.id + "/commit", "POST", {});
            await dataTools(c, tenantId);
            notice("旧版数据导入完成");
          },
          "primary",
        ),
      );
      c.append(p);
    } catch (e) {
      progress.textContent =
        "作业未完成，原业务数据不变。请取消作业后核对文件再重试。";
      throw e;
    }
  });
  c.append(legacy);
  async function restoreJob(id) {
    const state = await api(prefix + "/" + id),
      progress = el("section", null, { class: "panel" }),
      text = el("p");
    progress.append(el("h2", "备份暂存进度"), text);
    c.append(progress);
    const remaining = state.manifest.required.filter(
      (p) =>
        !state.manifest.done.some(
          (x) => x.table === p.table && x.offset === p.offset,
        ),
    );
    for (let i = 0; i < remaining.length; i++) {
      await api(prefix + "/" + id + "/page", "POST", remaining[i]);
      text.textContent = "已暂存 " + (i + 1) + " / " + remaining.length + " 批";
    }
    progress.append(
      button(
        "确认恢复 " + tenant.name,
        async () => {
          if (
            !(await cxAsk(
              "确认恢复 " +
                tenant.name +
                " 的业务数据？当前业务将由所选备份替换，所有机构用户需重新登录。",
            ))
          )
            return;
          await api(prefix + "/" + id + "/commit", "POST", {});
          await dataTools(c, tenantId);
          notice("恢复完成");
        },
        "primary",
      ),
    );
  }
}
async function businessView(c, tenantId) {
  const { tenant } = await api("tenants/" + tenantId);
  let lease = null;
  const resourceNames = {
    students: "学员档案",
    teachers: "教师档案",
    lessons: "课程",
    schedule_templates: "固定模板",
    locations: "教室",
    course_types: "课程设置",
    packages: "课时包",
    payroll: "教师月课酬",
    costs: "其他成本",
    student_payments: "学费收款",
    classes: "班级",
    leads: "招生线索",
    followup_notes: "沟通记录",
    followup_tasks: "跟进任务",
    referrals: "合作升学推荐",
  };
  c.replaceChildren(el("h1", tenant.name + " · 业务查看"));
  const banner = el("p", "当前为只读模式", { class: "impact-note" }),
    form = el("form", null, { class: "panel" }),
    resource = choice(
      form,
      "业务模块",
      "resource",
      Object.entries(resourceNames).map(([id, name]) => ({ id, name })),
      "students",
    );
  const month = field(
    form,
    "查看月份（北京时间）",
    "month",
    new Date()
      .toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" })
      .slice(0, 7),
    "month",
  );
  const area = el("section");
  c.append(banner, form, area);
  form.append(
    button("开启30分钟代管", async () => {
      const reason = await cxAskText(
        "开启 30 分钟代管",
        "请填写代管原因（至少5字）；全部修改会以“系统维护”留机构审计。",
        "开启代管",
      );
      if (!reason) return;
      lease = await api("tenants/" + tenantId + "/maintenance", "POST", {
        reason,
      });
      banner.textContent =
        "代管已开启，至 " + bjt(lease.expires_at) + "，原因：" + reason;
    }),
  );
  form.append(
    button("退出代管", async () => {
      if (lease)
        await api(
          "tenants/" + tenantId + "/maintenance/" + lease.id,
          "DELETE",
          {},
        );
      lease = null;
      banner.textContent = "当前为只读模式";
    }),
  );
  submit(form, "查看", () => load(0));
  await load(0);
  async function load(offset) {
    const routes = {
      packages: "/credits/packages",
      payroll: "/finance/payroll",
      costs: "/finance/costs",
      student_payments: "/credits/payments",
      classes: "/tools/classes",
      leads: "/tools/leads",
      followup_notes: "/tools/followup_notes",
      followup_tasks: "/tools/followup_tasks",
      referrals: "/tools/referrals",
    };
    const path = routes[resource.value] || "/data/" + resource.value;
    const result = await api(
      "tenants/" +
        tenantId +
        "/business?path=" +
        encodeURIComponent(path) +
        "&query=" +
        encodeURIComponent("?offset=" + offset + "&month=" + month.value),
    );
    area.replaceChildren();
    for (const row of result.items || []) {
      const p = el("section", null, { class: "panel" });
      p.append(
        el(
          "h2",
          row.name ||
            [row.student_name, row.teacher_name, row.course_name]
              .filter(Boolean)
              .join(" · ") ||
            resourceNames[resource.value],
        ),
        el(
          "p",
          row.start_at?.slice(0, 16).replace("T", " ") ||
            row.grade ||
            row.note ||
            row.subjects ||
            "",
        ),
      );
      for (const [label, key] of [
        ["余额", "balance"],
        ["应计课酬", "total_amount"],
        ["收款金额", "amount"],
        ["已付", "paid_amount"],
        ["未付", "unpaid_amount"],
      ])
        if (typeof row[key] === "number")
          p.append(
            el(
              "p",
              label +
                "：" +
                (key === "balance"
                  ? row[key] + "课时"
                  : "¥" + row[key].toFixed(2)),
            ),
          );
      if (row.status && admin.labels.lessons[row.status])
        p.append(el("p", admin.labels.lessons[row.status]));
      if (row.confirmation_status)
        p.append(
          el(
            "p",
            row.confirmation_status === "confirmed" ? "已确认" : "未确认",
          ),
        );
      if (row.title) p.append(el("p", row.title));
      if (row.content)
        p.append(el("p", row.content, { class: "preserve-text" }));
      if (row.notes) p.append(el("p", row.notes, { class: "preserve-text" }));
      if (["students", "teachers"].includes(resource.value))
        p.append(
          button("代管编辑姓名与备注", async () => {
            if (!lease || lease.expires_at <= Date.now())
              throw Error("请先开启有效的代管模式");
            const { panel, close } = drawer("代管编辑资料"),
              f = el("form");
            field(f, "姓名", "name", row.name);
            if (resource.value === "students")
              field(f, "教务备注", "notes", row.notes || "", "textarea", false);
            submit(f, "保存并记录审计", async (data) => {
              await api("tenants/" + tenantId + "/operate", "POST", {
                lease: lease.id,
                path: "/data/" + resource.value + "/" + row.id,
                method: "PATCH",
                data: { ...data, version: row.version },
              });
              close();
              await load(offset);
            });
            panel.append(f);
          }),
        );
      area.append(p);
    }
    if (offset) area.append(button("上一页", () => load(offset - 200)));
    if (Number.isInteger(result.next_offset))
      area.append(button("下一页", () => load(result.next_offset)));
  }
}

function promoSelect(form, label, name, options, value) {
  const wrap = el("label", label, { class: "field" }),
    input = el("select", null, { name });
  for (const [id, text] of options)
    input.append(el("option", text, { value: id }));
  input.value = value;
  wrap.append(input);
  form.append(wrap);
  return input;
}
function promoEpoch(value) {
  return value ? new Date(value + ":00+08:00").getTime() : null;
}
async function promoAdminUpload(file, kind, progress) {
  if (!file || file.size > 2097152) throw Error("图片须小于2MB");
  const data = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(Error("图片读取失败"));
    r.readAsDataURL(file);
  });
  const job = await api("promo/images", "POST", { kind });
  for (let i = 0; i < data.length; i += 500000) {
    progress.textContent =
      "上传 " +
      Math.floor(i / 500000 + 1) +
      "/" +
      Math.ceil(data.length / 500000);
    await api("promo/images/" + job.id + "/part", "POST", {
      index: i / 500000,
      data: data.slice(i, i + 500000),
    });
  }
  return api("promo/images/" + job.id + "/complete", "POST", {});
}
async function promoAdminImage(id) {
  const res = await fetch("/api/promo/images/" + id);
  if (!res.ok) throw Error("图片读取失败");
  const url = URL.createObjectURL(await res.blob());
  const image = new Image();
  image.src = url;
  await image.decode();
  return { url, image };
}
// 合作课详情页的缩略图：同一张图只取一次、只建一个临时地址，反复打开详情不会越积越多；最多留 40 张，超出的释放掉。
const cxThumbs = new Map();
function promoAdminThumb(key) {
  if (!cxThumbs.has(key)) {
    cxThumbs.set(key, promoAdminImage(key).catch((e) => (cxThumbs.delete(key), Promise.reject(e))));
    while (cxThumbs.size > 40) {
      const [old, p] = cxThumbs.entries().next().value;
      cxThumbs.delete(old);
      p.then((x) => URL.revokeObjectURL(x.url), () => {});
    }
  }
  return cxThumbs.get(key);
}
// 推广中心列表、发布、合作课跟进页已由文件末尾的新版页面（cx*）接管。
// 海报占位框编辑器保存后回到新版合作课页面。
async function promoAdminDetail(c, id) {
  return cxCourse(c, id);
}
function promoSvg(tag, attrs = {}) {
  const n = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
}
async function promoPosterEditor(c, id) {
  const { panel, close } = drawer("批量海报与占位框"),
    form = el("form"),
    files = field(
      form,
      "底图：PNG/JPEG，宽1080，可多选",
      "posters",
      "",
      "file",
    );
  files.accept = "image/png,image/jpeg";
  files.multiple = true;
  panel.append(
    el(
      "p",
      "先选底图。拖动彩色框调整位置，数值可调整大小；同一批共用此组位置。不同版式可分批上传。",
    ),
  );
  const editor = el("section"),
    progress = el("p", ""),
    controls = {};
  form.append(editor);
  let dims = null,
    svg = null;
  const initial = {
    logo: { x: 60, y: 60, width: 200, height: 140 },
    qr: { x: 800, y: 800, width: 200, height: 200 },
    text: {
      x: 60,
      y: 1000,
      width: 960,
      height: 50,
      font_size: 28,
      color: "#333333",
      align: "left",
    },
  };
  files.addEventListener("change", async () => {
    const file = files.files[0];
    if (!file) return;
    const url = URL.createObjectURL(file),
      image = new Image();
    image.src = url;
    await image.decode();
    if (image.naturalWidth !== 1080) {
      URL.revokeObjectURL(url);
      notice("海报底图宽度必须为1080");
      return;
    }
    dims = { width: 1080, height: image.naturalHeight };
    initial.qr.y = Math.max(0, dims.height - 280);
    initial.text.y = Math.max(0, dims.height - 80);
    editor.replaceChildren();
    svg = promoSvg("svg", {
      viewBox: "0 0 1080 " + dims.height,
      role: "img",
      "aria-label": "海报占位框，可拖动",
    });
    svg.classList.add("promo-editor");
    svg.append(
      promoSvg("image", {
        href: url,
        x: 0,
        y: 0,
        width: 1080,
        height: dims.height,
      }),
    );
    for (const [key, title, color] of [
      ["logo", "机构Logo", "#4a7ac7"],
      ["qr", "顾问二维码", "#d49832"],
      ["text", "主办方署名", "#965bc5"],
    ]) {
      const group = el("fieldset");
      group.append(el("legend", title));
      controls[key] = {};
      const rect = promoSvg("rect", {
        ...initial[key],
        fill: "transparent",
        stroke: color,
        "stroke-width": 5,
      });
      for (const name of ["x", "y", "width", "height"]) {
        const input = field(
          group,
          { x: "横坐标", y: "纵坐标", width: "宽度", height: "高度" }[name],
          key + "_" + name,
          initial[key][name],
          "number",
        );
        input.addEventListener("input", () =>
          rect.setAttribute(name, input.value),
        );
        controls[key][name] = input;
      }
      if (key === "text") {
        controls[key].font_size = field(
          group,
          "字号",
          "font_size",
          28,
          "number",
        );
        controls[key].color = field(group, "颜色", "color", "#333333", "color");
        controls[key].align = promoSelect(
          group,
          "对齐",
          "align",
          [
            ["left", "左对齐"],
            ["center", "居中"],
            ["right", "右对齐"],
          ],
          "left",
        );
      }
      let drag = null;
      rect.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        rect.setPointerCapture(e.pointerId);
        drag = {
          x: e.clientX,
          y: e.clientY,
          ox: Number(controls[key].x.value),
          oy: Number(controls[key].y.value),
        };
      });
      rect.addEventListener("pointermove", (e) => {
        if (!drag) return;
        const bounds = svg.getBoundingClientRect(),
          ratio = Math.max(1080 / bounds.width, dims.height / bounds.height);
        const x = Math.round(
            Math.max(
              0,
              Math.min(
                1080 - Number(controls[key].width.value),
                drag.ox + (e.clientX - drag.x) * ratio,
              ),
            ),
          ),
          y = Math.round(
            Math.max(
              0,
              Math.min(
                dims.height - Number(controls[key].height.value),
                drag.oy + (e.clientY - drag.y) * ratio,
              ),
            ),
          );
        controls[key].x.value = x;
        controls[key].y.value = y;
        rect.setAttribute("x", x);
        rect.setAttribute("y", y);
      });
      rect.addEventListener("pointerup", () => {
        drag = null;
      });
      svg.append(rect);
      editor.append(group);
    }
    editor.prepend(svg);
  });
  form.append(progress);
  submit(form, "上传并发布海报", async () => {
    if (!dims || !files.files.length) throw Error("请先选择底图");
    const slots = {};
    for (const key of Object.keys(controls)) {
      slots[key] = {};
      for (const [name, input] of Object.entries(controls[key]))
        slots[key][name] = ["color", "align"].includes(name)
          ? input.value
          : Number(input.value);
    }
    for (const file of files.files) {
      const image = await promoAdminUpload(file, "poster", progress);
      await api("promo/" + id + "/posters", "POST", {
        image_key: image.id,
        slots,
      });
    }
    close();
    await promoAdminDetail(c, id);
  });
  panel.append(form);
}
async function promoSinglePoster(c, id, p) {
  const { panel, close } = drawer("单张海报占位微调"),
    form = el("form"),
    preview = await promoAdminImage(p.image_key),
    svg = promoSvg("svg", {
      viewBox: "0 0 " + p.width + " " + p.height,
      role: "img",
      "aria-label": "单张海报占位框",
    });
  svg.classList.add("promo-editor");
  svg.append(
    promoSvg("image", { href: preview.url, width: p.width, height: p.height }),
  );
  form.append(svg);
  const controls = {};
  for (const [key, label, color] of [
    ["logo", "机构Logo", "#4a7ac7"],
    ["qr", "顾问二维码", "#d49832"],
    ["text", "主办方署名", "#965bc5"],
  ]) {
    const f = el("fieldset");
    f.append(el("legend", label));
    controls[key] = {};
    const rect = promoSvg("rect", {
      x: p.slots[key].x,
      y: p.slots[key].y,
      width: p.slots[key].width,
      height: p.slots[key].height,
      stroke: color,
      "stroke-width": 5,
      fill: "transparent",
    });
    for (const n of ["x", "y", "width", "height"]) {
      const input = field(
        f,
        { x: "横坐标", y: "纵坐标", width: "宽度", height: "高度" }[n],
        key + "_" + n,
        p.slots[key][n],
        "number",
      );
      input.addEventListener("input", () => rect.setAttribute(n, input.value));
      controls[key][n] = input;
    }
    if (key === "text") {
      controls[key].font_size = field(
        f,
        "字号",
        "font_size",
        p.slots.text.font_size,
        "number",
      );
      controls[key].color = field(
        f,
        "颜色",
        "color",
        p.slots.text.color,
        "color",
      );
      controls[key].align = promoSelect(
        f,
        "对齐",
        "align",
        [
          ["left", "左对齐"],
          ["center", "居中"],
          ["right", "右对齐"],
        ],
        p.slots.text.align,
      );
    }
    let start = null;
    rect.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      rect.setPointerCapture(e.pointerId);
      start = {
        x: e.clientX,
        y: e.clientY,
        ox: Number(controls[key].x.value),
        oy: Number(controls[key].y.value),
      };
    });
    rect.addEventListener("pointermove", (e) => {
      if (!start) return;
      const bounds = svg.getBoundingClientRect(),
        k = Math.max(p.width / bounds.width, p.height / bounds.height),
        x = Math.round(
          Math.max(
            0,
            Math.min(
              p.width - Number(controls[key].width.value),
              start.ox + (e.clientX - start.x) * k,
            ),
          ),
        ),
        y = Math.round(
          Math.max(
            0,
            Math.min(
              p.height - Number(controls[key].height.value),
              start.oy + (e.clientY - start.y) * k,
            ),
          ),
        );
      controls[key].x.value = x;
      controls[key].y.value = y;
      rect.setAttribute("x", x);
      rect.setAttribute("y", y);
    });
    rect.addEventListener("pointerup", () => {
      start = null;
    });
    svg.append(rect);
    form.append(f);
  }
  submit(form, "保存位置", async () => {
    const slots = {};
    for (const [key, v] of Object.entries(controls)) {
      slots[key] = {};
      for (const [name, input] of Object.entries(v))
        slots[key][name] = ["color", "align"].includes(name)
          ? input.value
          : Number(input.value);
    }
    await api("promo/" + id + "/posters", "POST", {
      id: p.id,
      version: p.version,
      image_key: p.image_key,
      slots,
    });
    URL.revokeObjectURL(preview.url);
    close();
    await promoAdminDetail(c, id);
  });
  panel.append(form);
}

// ======================================================================
// ---------- 艺界星途 · 机构的新功能设置（Claude，阶段 2） ----------
// 只改学科、四个新模块开关、AI 上限；其他字段由上面的原表单管理。保存带版本号，冲突时提示刷新。
const YX_SUBJECTS = [
  ["music_interest", "音乐 · 兴趣"],
  ["music_exam", "音乐 · 艺考"],
  ["art_interest", "美术 · 兴趣"],
  ["art_exam", "美术 · 艺考"],
];
const YX_MODULES = [
  ["content", "招生内容", "公众号、朋友圈、海报文案助手"],
  ["plans", "课程方案", "给家长的学习方案与报价"],
  ["growth_reports", "成长报告", "阶段成长报告，发布到家长端"],
  ["school_db", "院校库", "艺考院校资料（默认关闭）"],
];
async function yxOpsPanel(c, id) {
  let cfg;
  try {
    cfg = await api("ops/tenants/" + id);
  } catch (e) {
    const p = el("section", null, { class: "panel" });
    p.append(el("h2", "艺界星途功能"), el("p", "读取失败：" + e.message, { class: "muted" }));
    return [p];
  }
  const form = el("form", null, { class: "panel yx-ops" });
  form.append(
    el("h2", "艺界星途功能"),
    el("p", "这里的改动立即生效；学科模板内容在后续版本导入，现在先记录机构开通了哪些学科。", { class: "muted" }),
  );
  const subjects = el("fieldset", null, { class: "yx-ops-group" });
  subjects.append(el("legend", "开通学科"));
  const on = new Set((cfg.subjects || []).map((x) => x.key));
  for (const [key, label] of YX_SUBJECTS) {
    const line = el("label", null, { class: "yx-ops-check" }),
      input = el("input", null, { type: "checkbox", name: "subject_" + key });
    input.checked = on.has(key);
    line.append(input, el("span", label));
    subjects.append(line);
  }
  const mods = el("fieldset", null, { class: "yx-ops-group" });
  mods.append(el("legend", "功能开关"));
  for (const [key, label, hint] of YX_MODULES) {
    const line = el("label", null, { class: "yx-ops-check" }),
      input = el("input", null, { type: "checkbox", name: "module_" + key });
    input.checked = !!cfg.modules?.[key];
    line.append(input, el("span", label), el("small", hint));
    mods.append(line);
  }
  const ai = el("fieldset", null, { class: "yx-ops-group" });
  ai.append(el("legend", "AI 每日次数上限（留空 = 平台默认）"));
  const fast = field(ai, "快速（文案、改写）", "fast_daily_limit", cfg.ai_override?.fast_daily_limit ?? "", "number", false);
  const deep = field(ai, "深度（方案、报告）", "deep_daily_limit", cfg.ai_override?.deep_daily_limit ?? "", "number", false);
  for (const x of [fast, deep]) {
    x.min = "0";
    x.step = "1";
    x.placeholder = "平台默认";
  }
  form.append(subjects, mods, ai);
  submit(form, "保存功能设置", async () => {
    const num = (v) => (String(v).trim() === "" ? null : Number(v));
    for (const v of [fast.value, deep.value])
      if (String(v).trim() !== "" && !(Number.isInteger(Number(v)) && Number(v) >= 0)) throw Error("AI 上限请填 0 或正整数，留空用平台默认");
    try {
      await api("ops/tenants/" + id, "PUT", {
        id,
        version: cfg.version,
        subjects: YX_SUBJECTS.map(([k]) => k).filter((k) => form.elements["subject_" + k].checked),
        modules: Object.fromEntries(YX_MODULES.map(([k]) => [k, form.elements["module_" + k].checked])),
        ai_override: { fast_daily_limit: num(fast.value), deep_daily_limit: num(deep.value) },
      });
    } catch (e) {
      if (e.code === "version_conflict" || /version_conflict/.test(e.message)) {
        notice("机构资料刚被修改过，已刷新为最新内容，请重新确认后再保存。");
        await detail(c, id);
        return;
      }
      throw e;
    }
    notice("已保存");
    await detail(c, id);
  });
  const kick = el("section", null, { class: "panel yx-ops-kick" });
  kick.append(
    el("h2", "强制全机构下线"),
    el("p", "账号被盗、违规等紧急情况使用：本机构所有人（员工、老师、学员、家长）立即退出登录。不影响数据，也不会停用机构。", { class: "muted" }),
  );
  kick.append(
    button("强制下线…", async () => {
      const reason = await cxAskText("强制“" + cfg.name + "”全部下线？", "请写明原因（至少 5 个字），会记入平台日志。", "下一步");
      if (!reason) return;
      const typed = await yxAskName(cfg.name);
      if (!typed) return;
      if (typed.trim() !== cfg.name) return notice("机构全名不一致，已取消");
      const fresh = await api("ops/tenants/" + id);
      await api("ops/tenants/" + id + "/revoke-sessions", "POST", { version: fresh.version, reason, confirm_name: typed.trim() });
      notice("已让本机构所有账号退出登录");
    }, "danger"),
  );
  return [form, kick];
}
// 输入机构全名确认（不限字数，机构名可能少于 5 个字）。
function yxAskName(name) {
  return new Promise((resolve) => {
    const d = el("dialog", null, { class: "cx-dialog", "aria-label": "确认机构全名" });
    const form = el("form");
    const input = el("input", null, { type: "text", "aria-label": "机构全名", autocomplete: "off" });
    const done = (v) => {
      d.close();
      d.remove();
      resolve(v);
    };
    const ops = h("div", "cx-dialog-ops");
    const no = el("button", "取消", { type: "button", class: "button" });
    no.addEventListener("click", () => done(null));
    ops.append(no, el("button", "确认下线", { type: "submit", class: "button danger" }));
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const v = input.value.trim();
      if (!v) return notice("请输入机构全名");
      done(v);
    });
    d.addEventListener("cancel", (e) => {
      e.preventDefault();
      done(null);
    });
    form.append(input, ops);
    d.append(el("h2", "再次确认"), h("p", "muted", "请输入机构全名“" + name + "”。"), form);
    document.body.append(d);
    d.showModal();
    input.focus();
  });
}

// 艺界星途：平台 AI 模型与默认次数（接口 v0.3.6，/api/ops/ai/settings）。服务密钥只在 Cloudflare 环境变量里设置，这里不显示也不能填。
async function yxAiSettingsPage(c) {
  const cfg = await api("ops/ai/settings");
  c.replaceChildren(el("h1", "AI 模型"));
  const form = el("form", null, { class: "panel yx-ops" });
  form.append(
    el("p", "所有机构共用。模型名称填 DeepSeek 的模型名（如 deepseek-chat、deepseek-reasoner）；服务密钥 DEEPSEEK_API_KEY 只在 Cloudflare 后台的环境变量里设置，这里看不到也改不了。", { class: "muted" }),
    el("p", "当前状态：" + (cfg.fast_model && cfg.deep_model ? "已填写模型名称" : "还没填模型名称，机构端点 AI 会提示“AI 还没开通”"), { class: "muted" }),
  );
  const fm = field(form, "快速模式模型（文案、改写、一句话调整）", "fast_model", cfg.fast_model || "", "text", false);
  const dm = field(form, "深度模式模型（配课、长文）", "deep_model", cfg.deep_model || "", "text", false);
  const fl = field(form, "快速模式每个机构每天默认次数", "fast_daily_limit", cfg.fast_daily_limit, "number");
  const dl = field(form, "深度模式每个机构每天默认次数", "deep_daily_limit", cfg.deep_daily_limit, "number");
  for (const x of [fl, dl]) {
    x.min = "0";
    x.step = "1";
  }
  fm.placeholder = dm.placeholder = "如 deepseek-chat";
  submit(form, "保存", async () => {
    try {
      await api("ops/ai/settings", "PUT", {
        version: cfg.version,
        fast_model: fm.value.trim() || null,
        deep_model: dm.value.trim() || null,
        fast_daily_limit: Number(fl.value),
        deep_daily_limit: Number(dl.value),
      });
      notice("已保存");
    } catch (e) {
      notice(e.message);
    }
    await yxAiSettingsPage(c);
  });
  c.append(form);
}
// ======================================================================
// 艺界星途平台：学科模版包 · 模版与风格包 · AI 用量与每日上限（接口 v0.3.8，Claude，设计稿 v3）
// 只调用 /api/ops/...；不显示任何密钥；风格包图片只走平台授权地址，不用公开 R2 地址。
// ======================================================================
const YXO_DOC = [["plan", "方案"], ["report", "成长报告"], ["feedback_card", "课后反馈"], ["article", "公众号"]];
const YXO_DOC_NAME = Object.fromEntries(YXO_DOC);
const YXO_SCOPE = { admin_only: ["仅超管试用", "warn"], tenants: ["指定机构", "info"], all: ["全部机构", "ok"] };
const YXO_FORM = { one_to_one: "一对一", small_group: "小班", group: "集体课", camp: "集训", package: "课包" };
const yxoState = { doc: "", pack: null, ver: null, subject: null, subjectVer: null };
// 风格包图片：asset_base + 去掉开头 assets/ 的相对路径
// 停用：发布过但现在不可用。只有草稿、还没发布的包 active 也是 false，不算停用。
const yxoOff = (p) => !p.active && p.versions.some((v) => v.status === "published");
const yxoAsset = (v, path) => (path && v?.asset_base ? v.asset_base + String(path).replace(/^assets\//, "") : null);
function yxoDot(text, tone) {
  return h("span", "yxo-dot yxo-dot--" + tone, text);
}
function yxoVersionOf(pack, ver) {
  return pack.versions.find((v) => v.pack_version === ver) || pack.versions.find((v) => v.pack_version === pack.current_version) || pack.versions.at(-1);
}

// ---------- 模版与风格包 ----------
async function yxStylePacksPage(c) {
  const st = yxoState;
  const data = await api("ops/style-packs");
  const packs = data.items || [];
  const defaults = Object.fromEntries((data.defaults || []).map((x) => [x.doc_type, x.pack_id]));
  const up = el("input", null, { type: "file", accept: ".zip,application/zip", hidden: "" });
  up.addEventListener("change", async () => {
    const file = up.files[0];
    up.value = "";
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) return notice("风格包不能超过 10MB");
    const fd = new FormData();
    fd.append("file", file);
    // 上传不手工设 Content-Type，让浏览器自己带 multipart 边界。
    const r = await fetch("/api/ops/style-packs/upload", { method: "POST", body: fd });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (d.error === "style_pack_invalid") return yxoInvalid(d);
      if (d.error === "duplicate") return notice("同一个风格包的这个版本号已经上传过。改了设计请在 manifest 里换一个新版本号。");
      return notice(d.message || d.error || "上传失败");
    }
    st.pack = d.pack_id;
    st.ver = d.pack_version;
    notice("已上传为草稿“" + d.name + " v" + d.pack_version + "”，先预览检查，再选发布范围。");
    await yxStylePacksPage(c);
  });
  cxTop("模版与风格包", [], [cxBtn("下载格式说明", () => yxoFormatDoc()), cxBtn("＋ 上传风格包", () => up.click(), "primary")], h("span", "cx-head-sub", "方案 · 成长报告 · 课后反馈卡片 · 公众号文章"));
  c.replaceChildren(up);
  const grid = h("div", "yxo-split");
  const left = h("section", "cx-panel yxo-list");
  const tabs = h("div", "yxo-tabs");
  for (const [k, t] of [["", "全部"], ...YXO_DOC]) {
    const n = k ? packs.filter((p) => yxoVersionOf(p).manifest.doc_types.includes(k)).length : packs.length;
    const b = el("button", t + (k ? "" : " " + n), { type: "button", class: "yxo-tab", "aria-pressed": String(st.doc === k) });
    b.addEventListener("click", () => ((st.doc = k), yxStylePacksPage(c)));
    tabs.append(b);
  }
  left.append(tabs);
  const rows = packs.filter((p) => !st.doc || yxoVersionOf(p).manifest.doc_types.includes(st.doc));
  if (!st.pack || !packs.some((p) => p.id === st.pack)) st.pack = rows[0]?.id || null;
  const t = cxTable([["", "yxo-thumb-col"], ["风格包"], ["版本"], ["发布范围"], ["默认用于"]]);
  for (const p of rows) {
    const v = yxoVersionOf(p);
    const thumb = h("span", "yxo-thumb");
    const src = yxoAsset(v, v.manifest.thumbnail);
    if (src) thumb.append(el("img", null, { src, alt: "", loading: "lazy" }));
    else yxoSwatch(thumb, v.manifest);
    const name = cxStack(p.name + (yxoOff(p) ? "（已停用）" : ""), v.manifest.doc_types.map((d) => YXO_DOC_NAME[d]).join(" · "));
    const scope = yxoOff(p) ? yxoDot("已停用", "muted") : v.status === "draft" ? yxoDot("草稿 · 未发布", "muted") : yxoDot((YXO_SCOPE[v.scope] || [v.scope])[0], (YXO_SCOPE[v.scope] || [, "muted"])[1]);
    const def = YXO_DOC.filter(([d]) => defaults[d] === p.id).map(([, n]) => n).join("、") || "—";
    const r = t.row([thumb, name, "v" + v.pack_version + (p.versions.length > 1 ? " · 共 " + p.versions.length + " 版" : ""), scope, def], "yxo-row" + (p.id === st.pack ? " is-on" : "") + (yxoOff(p) ? " is-off" : ""));
    r.tabIndex = 0;
    const pick = () => {
      st.pack = p.id;
      st.ver = null;
      yxStylePacksPage(c);
    };
    r.addEventListener("click", pick);
    r.addEventListener("keydown", (e) => e.key === "Enter" && pick());
  }
  if (!rows.length) t.row(["", "还没有风格包。点右上角“上传风格包”。", "", "", ""]);
  left.append(t.wrap);
  const right = h("div", "yxo-side");
  grid.append(left, right);
  c.append(grid);
  const cur = packs.find((p) => p.id === st.pack);
  if (cur) await yxoPackDetail(right, cur, defaults, () => yxStylePacksPage(c));
}
// 颜色用 SVG 的 fill 属性画（控制台不写内联样式）。
const YXO_NS = "http://www.w3.org/2000/svg";
function yxoSvg(w, hh, shapes) {
  const svg = document.createElementNS(YXO_NS, "svg");
  svg.setAttribute("viewBox", "0 0 " + w + " " + hh);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("aria-hidden", "true");
  for (const [x, y, ww, hh2, fill, r] of shapes) {
    const rc = document.createElementNS(YXO_NS, "rect");
    for (const [k, v] of [["x", x], ["y", y], ["width", ww], ["height", hh2], ["fill", fill], ["rx", r || 0]]) rc.setAttribute(k, String(v));
    svg.append(rc);
  }
  return svg;
}
const yxoHex = (v, d) => (/^#[0-9a-f]{6}$/i.test(v || "") ? v : d);
function yxoSwatch(box, m) {
  const col = m?.tokens?.color || {};
  box.append(yxoSvg(30, 40, [[0, 0, 10, 40, yxoHex(col.primary, "#ddd")], [10, 0, 10, 40, yxoHex(col.paper, "#eee")], [20, 0, 10, 40, yxoHex(col.accent, "#ccc")]]));
}
async function yxoPackDetail(box, pack, defaults, again) {
  const st = yxoState;
  const detail = await api("ops/style-packs/" + encodeURIComponent(pack.id));
  const v = yxoVersionOf(detail, st.ver);
  st.ver = v.pack_version;
  // 检查结果
  const p1 = h("section", "cx-panel yxo-card");
  const head = h("div", "yxo-card-head");
  const tt = h("div", "yxo-title");
  tt.append(el("h2", detail.name), h("span", "muted", "v" + v.pack_version));
  head.append(tt);
  if (detail.versions.length > 1) {
    const sel = el("select", null, { "aria-label": "版本" });
    for (const x of detail.versions) sel.append(el("option", "v" + x.pack_version + (x.status === "draft" ? "（草稿）" : ""), { value: x.pack_version }));
    sel.value = v.pack_version;
    sel.addEventListener("change", () => ((st.ver = sel.value), again()));
    head.append(sel);
  }
  const ck = v.checks || { errors: [], warnings: [] };
  head.append(h("span", "cx-spacer"), ck.errors?.length ? yxoDot(ck.errors.length + " 项错误", "bad") : ck.warnings?.length ? yxoDot(ck.warnings.length + " 项提示", "warn") : yxoDot("检查通过", "ok"));
  p1.append(head);
  const list = h("ul", "yxo-checks");
  const item = (tone, text) => {
    const li = h("li", "is-" + tone);
    li.append(h("span", "yxo-check-ico", tone === "ok" ? "✓" : tone === "warn" ? "!" : "×"), h("span", "", text));
    list.append(li);
  };
  item("ok", "字段完整：颜色、字体、6 个组件的版式");
  if (ck.contrast) item("ok", "文字对比度：正文 " + Number(ck.contrast.ink_paper).toFixed(1) + " : 1，辅助文字 " + Number(ck.contrast.muted_paper).toFixed(1) + " : 1");
  item("ok", "字体：只用了平台已有字体");
  if (ck.usable_text_modes) item("ok", "主色上可用的文字：" + ck.usable_text_modes.map((m) => ({ light: "白字", dark: "深色字" })[m] || m).join("、"));
  for (const e of ck.errors || []) item("bad", e);
  for (const w of ck.warnings || []) item("warn", w);
  p1.append(list);
  p1.append(h("p", "muted yxo-note", "上传检查只看固定颜色。机构主色和实际照片上的文字，在机构端预览和导出时再检查，看不清会自动加底板。"));
  // 示意预览 + 平台示例数据
  p1.append(h("p", "yxo-sub", "用示例数据预览"));
  const prev = h("div", "yxo-previews");
  const col = v.manifest.tokens.color;
  const corner = yxoAsset(v, v.manifest.decor?.corner_image);
  for (const [d, name] of YXO_DOC.filter(([d]) => v.manifest.doc_types.includes(d))) {
    const f = h("figure", "yxo-prev yxo-prev--" + d);
    const page = h("div", "yxo-prev-page");
    const P = yxoHex(col.primary, "#6a35b8"),
      paper = yxoHex(col.paper, "#ffffff"),
      inkc = yxoHex(col.ink, "#211a30"),
      acc = yxoHex(col.accent, "#f4a85b");
    const shapes =
      d === "plan"
        ? [[0, 0, 60, 80, P], [8, 52, 14, 1.5, acc], [8, 56, 40, 4, "#ffffff"], [8, 62, 26, 2, "#ffffff"]]
        : d === "feedback_card"
          ? [[0, 0, 60, 80, "#f3f1f4"], [5, 6, 50, 13, P, 2], [5, 19, 50, 28, "#ffffff"], [10, 25, 34, 2, "#d8d3de"], [10, 31, 28, 2, "#d8d3de"]]
          : [[0, 0, 60, 80, paper], [0, 0, 60, 24, P], [7, 32, 32, 4, inkc], [7, 40, 42, 2, "#d8d3de"], [7, 45, 36, 2, "#d8d3de"]];
    page.append(yxoSvg(60, 80, shapes));
    if (corner && d === "plan") page.append(el("img", null, { src: corner, alt: "", class: "yxo-prev-corner" }));
    f.append(page, el("figcaption", name + (d === "plan" ? " · " + ({ stage: "舞台", folio: "画册", journal: "手札" }[v.manifest.components["plan.cover"]] || "") : "")));
    prev.append(f);
  }
  p1.append(prev);
  p1.append(
    cxBtn("看示例数据", async () => {
      const r = await api("ops/style-packs/" + encodeURIComponent(pack.id) + "/versions/" + encodeURIComponent(v.pack_version) + "/preview", "POST", {});
      const lines = (r.previews || []).map((x) => YXO_DOC_NAME[x.doc_type] + "：" + (x.render_data?.title || x.render_data?.student?.display_name || "示例") + (x.render_data?.example ? "（平台虚构示例）" : ""));
      await cxAsk("示例数据预览", lines.join("\n") + "\n\n这些是平台虚构的示例数据，不读任何机构或学员的真实信息，也不调用 AI。", "知道了");
    }),
  );
  box.append(p1);
  // 发布范围
  const p2 = h("section", "cx-panel yxo-card");
  p2.append(el("h2", "发布范围"));
  let scope = v.scope || "admin_only";
  const chosen = new Set((detail.scopes || []).filter((x) => x.pack_version === v.pack_version).map((x) => x.id));
  const isDraft = v.status === "draft";
  if (!isDraft) {
    // 发布后范围随版本一起冻结（v0.3.8）：这里只显示，不能改。要换范围请上传新的版本号。
    const t = (YXO_SCOPE[v.scope] || [v.scope, "muted"]);
    p2.append(yxoDot(t[0] + (v.scope === "tenants" ? " · " + chosen.size + " 家" : ""), t[1]));
    if (v.scope === "tenants")
      consoleTenants()
        .then((ts) => p2.querySelector(".yxo-dot").after(h("p", "muted yxo-note", ts.filter((x) => chosen.has(x.id)).map((x) => x.name).join("、") || "—")))
        .catch(() => {});
    p2.append(h("p", "muted yxo-note", "发布后范围和内容一起固定。要改范围，请把 manifest 里的版本号改大后重新上传，再按新范围发布。"));
  }
  const tenantsBox = h("div", "yxo-tenants");
  const radios = h("div", "yxo-radios");
  for (const [k, label] of [["admin_only", "仅超管试用"], ["tenants", "指定机构"], ["all", "全部机构"]]) {
    const l = el("label", null, { class: "yxo-radio" });
    const r = el("input", null, { type: "radio", name: "yxo_scope", value: k });
    r.checked = scope === k;
    r.addEventListener("change", () => {
      scope = k;
      tenantsBox.hidden = k !== "tenants";
    });
    l.append(r, h("span", "", label));
    if (k === "tenants") l.append(h("small", "muted", "可多选"));
    radios.append(l);
  }
  if (isDraft) {
    p2.append(radios, tenantsBox);
    tenantsBox.hidden = scope !== "tenants";
    consoleTenants()
      .then((ts) => {
        for (const t of ts) {
          const l = el("label", null, { class: "yxo-check" });
          const ckb = el("input", null, { type: "checkbox" });
          ckb.checked = chosen.has(t.id);
          ckb.addEventListener("change", () => (ckb.checked ? chosen.add(t.id) : chosen.delete(t.id)));
          l.append(ckb, h("span", "", t.name));
          tenantsBox.append(l);
        }
      })
      .catch((e) => tenantsBox.append(h("p", "muted", "机构列表读取失败：" + e.message)));
  }
  p2.append(h("p", "muted yxo-note", "已生成的方案和报告锁定当时的版本，发新版本不会改变旧文件的样子。停用后新文件选不到。"));
  const ops = h("div", "yxo-ops");
  const off = yxoOff(detail);
  if (off) p2.append(h("p", "yxo-note yxo-warn", "这个风格包已停用：机构新建文件选不到它，已发出的文件不受影响。"));
  if (!off && isDraft && !ck.errors?.length)
    ops.append(
      cxBtn("发布 v" + v.pack_version, async () => {
        if (scope === "tenants" && !chosen.size) return notice("请至少选一家机构");
        if (!(await cxAsk("发布“" + detail.name + " v" + v.pack_version + "”？", "发布后内容固定，不能再修改；新设计请另传新版本号。范围：" + { admin_only: "仅超管试用", tenants: "指定 " + chosen.size + " 家机构", all: "全部机构" }[scope] + "。", "发布"))) return;
        try {
          await api("ops/style-packs/" + encodeURIComponent(pack.id) + "/versions/" + encodeURIComponent(v.pack_version) + "/publish", "POST", { scope, tenant_ids: scope === "tenants" ? [...chosen] : [], version: v.version });
        } catch (e) {
          if (e.code === "version_conflict" || e.code === "invalid_state") {
            notice(e.code === "invalid_state" ? "这个版本已经发布过，内容和范围都已固定。" : "这个风格包刚被别人改过，已刷新，请重新确认。");
            return again();
          }
          throw e;
        }
        notice("已发布");
        await again();
      }, "primary"),
    );
  if (!off && detail.versions.some((x) => x.status === "published"))
    ops.append(
      cxBtn("停用", async () => {
        if (!(await cxAsk("停用“" + detail.name + "”？", "停用后机构新建文件选不到它；已发出的方案和报告保持原样。", "停用", "danger"))) return;
        await api("ops/style-packs/" + encodeURIComponent(pack.id) + "/disable", "POST", {});
        notice("已停用");
        await again();
      }),
    );
  p2.append(ops);
  box.append(p2);
  // 设为默认
  if (!off && v.status === "published") {
    const p3 = h("section", "cx-panel yxo-card");
    p3.append(el("h2", "设为默认"), h("p", "muted yxo-note", "机构没有自己选风格时用默认。默认包对某家机构不可用时，自动换成它能用的包。"));
    const rowsBox = h("div", "yxo-defaults");
    for (const [d, name] of YXO_DOC.filter(([d]) => v.manifest.doc_types.includes(d))) {
      const r = h("div", "yxo-default-row");
      r.append(h("span", "", name));
      if (defaults[d] === pack.id) r.append(yxoDot("当前默认", "ok"));
      else
        r.append(
          cxBtn("设为默认", async () => {
            await api("ops/style-packs/default", "PUT", { doc_type: d, pack_id: pack.id });
            notice(name + "的默认风格已改为“" + detail.name + "”");
            await again();
          }),
        );
      rowsBox.append(r);
    }
    p3.append(rowsBox);
    box.append(p3);
  }
  if (detail.used_count != null) box.append(h("p", "muted yxo-note", "已有 " + detail.used_count + " 份文件使用这个风格包。"));
}
async function yxoInvalid(d) {
  // 实际返回：details.checks.errors 为检查错误，details.fields 为逐字段说明。
  const errs = [...new Set([...(d.details?.checks?.errors || []), ...(d.details?.fields || []).map((x) => (x.field ? x.field + "：" : "") + (x.message || ""))])];
  await cxAsk("风格包没有通过检查", (d.message || "格式不正确") + (errs.length ? "\n\n" + errs.map((x) => "• " + (typeof x === "string" ? x : x.message || JSON.stringify(x))).join("\n") : "") + "\n\n请按“下载格式说明”修改后重新上传。", "知道了");
}
function yxoFormatDoc() {
  const text = [
    "艺界星途 · 风格包格式说明（接口 v0.3.8）",
    "",
    "一、压缩包结构：根目录只有 manifest.json 和 assets/ 文件夹。",
    "  · assets 里只能放 PNG / JPEG / WebP 图片；单张不超过 2MB，打印用建议宽 1600 像素以上。",
    "  · 压缩前后总量都不超过 10MB。不能放 SVG、脚本、HTML、字体或隐藏文件。",
    "",
    "二、manifest.json 必填字段：",
    "  id（英文小写和下划线，上传后不能改）、name、version（如 1.0.0，每次改设计都换新号）、",
    "  doc_types（plan 方案 / report 成长报告 / feedback_card 课后反馈卡片 / article 公众号文章，可多选）、",
    "  subjects（* 或 music_interest / music_exam / art_interest / art_exam）、tokens、components、decor、cover_text_modes、thumbnail。",
    "",
    "三、tokens：",
    "  color：primary、ink、paper、accent、muted 五个六位色号（如 #A3271F），use_tenant_primary（true 表示用机构主色替换 primary）。",
    "  正文（ink）和辅助文字（muted）在底色（paper）上的对比度都要不低于 4.5；主色上至少白字或深色字有一种不低于 4.5。",
    "  font：display、body、latin 只能选 noto-sans-sc、noto-serif-sc、cormorant-italic。",
    "",
    "四、components（六个都要写）：",
    "  plan.cover：stage 舞台 / folio 画册 / journal 手札",
    "  plan.section_header：numeral 大号编号 / plain 简洁",
    "  plan.stage_block：band 色带 / card 卡片",
    "  plan.total_card：solid 实底 / outline 描边",
    "  report.header：photo 照片头图 / band 色带",
    "  feedback_card.header：band 色带 / plain 简洁",
    "",
    "五、decor：cover_frame 目前只能是 none；corner_image 可选，填包内图片路径（如 assets/corner.png）。",
    "六、cover_text_modes：auto / dark / light / panel 中选一个或多个。",
    "七、thumbnail：列表缩略图，填包内图片路径，或 null。",
    "",
    "发布后内容固定，不能覆盖。改设计请换 version 重新上传。已发出的方案和报告一直使用当时的版本。",
  ].join("\n");
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const a = el("a", "", { href: url, download: "艺界星途_风格包格式说明.txt" });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ---------- 学科模版包 ----------
async function yxSubjectPacksPage(c) {
  const st = yxoState;
  const data = await api("ops/subject-packs");
  const packs = data.items || [];
  cxTop("学科模版包", [], [], h("span", "cx-head-sub", "四个学科的课程库、阶段、节点日历和报告维度；机构导入时复制一份，之后各改各的"));
  if (!packs.some((p) => p.key === st.subject)) st.subject = packs[0]?.key || null;
  c.replaceChildren();
  const grid = h("div", "yxo-split is-subject");
  const left = h("div", "yxo-subjects");
  for (const p of packs) {
    const b = el("button", null, { type: "button", class: "yxo-subject" + (p.key === st.subject ? " is-on" : ""), "aria-pressed": String(p.key === st.subject) });
    const drafts = p.versions.filter((v) => v.status === "draft").length;
    b.append(el("strong", p.name), h("small", "muted", "已发布 v" + (p.current_published_version || "—") + (drafts ? " · " + drafts + " 份草稿" : "")));
    b.addEventListener("click", () => ((st.subject = p.key), (st.subjectVer = null), yxSubjectPacksPage(c)));
    left.append(b);
  }
  left.append(h("p", "muted yxo-note", "平台发布新版本不会自动改到已开通的机构；机构在“学科包”里点“更新”才补上新增的条目，原有名称和价格不变。"));
  const main = h("div", "yxo-subject-main");
  grid.append(left, main);
  c.append(grid);
  const pack = packs.find((p) => p.key === st.subject);
  if (pack) yxoSubjectDetail(main, pack, () => yxSubjectPacksPage(c));
}
function yxoSubjectDetail(box, pack, again) {
  const st = yxoState;
  const vs = [...pack.versions].sort((a, b) => (a.status === b.status ? 0 : a.status === "draft" ? -1 : 1));
  let v = pack.versions.find((x) => x.pack_version === st.subjectVer) || vs[0];
  st.subjectVer = v.pack_version;
  const draft = v.status === "draft";
  const content = structuredClone(v.content);
  let dirty = false;
  const head = h("section", "cx-panel yxo-card");
  const hh = h("div", "yxo-card-head");
  const tt = h("div", "yxo-title");
  tt.append(el("h2", pack.name), h("span", "muted", "v" + v.pack_version));
  hh.append(tt, draft ? yxoDot("草稿 · 可以修改", "warn") : yxoDot("已发布 · 内容固定", "ok"));
  const sel = el("select", null, { "aria-label": "版本" });
  for (const x of pack.versions) sel.append(el("option", "v" + x.pack_version + (x.status === "draft" ? "（草稿）" : ""), { value: x.pack_version }));
  sel.value = v.pack_version;
  sel.addEventListener("change", () => ((st.subjectVer = sel.value), again()));
  hh.append(h("span", "cx-spacer"), sel);
  const save = cxBtn("保存草稿", async () => {
    yxoCheckContent(content);
    try {
      await api("ops/subject-packs", "PUT", { key: pack.key, name: pack.name, pack_version: v.pack_version, version: v.version, content });
    } catch (e) {
      if (e.code === "version_conflict") {
        await cxAsk("草稿刚被别人保存过", "已经刷新为最新内容。请核对后重新修改、保存；你刚才的改动没有保存。", "知道了");
        return again();
      }
      if (e.code === "invalid_state") {
        notice("这个版本已经发布，不能再改。请新建草稿。");
        return again();
      }
      throw e;
    }
    notice("草稿已保存");
    await again();
  }, "primary");
  save.disabled = true;
  const mark = () => {
    if (!draft) return;
    dirty = true;
    save.disabled = false;
  };
  const ops = h("div", "yxo-ops");
  if (draft) {
    ops.append(
      save,
      cxBtn("发布 v" + v.pack_version, async () => {
        if (dirty) return notice("先保存草稿，再发布");
        if (!(await cxAsk("发布“" + pack.name + " v" + v.pack_version + "”？", "发布后内容固定，不能再修改。已开通的机构不会自动更新，需要机构自己点“更新”才补上新增条目。", "发布"))) return;
        try {
          await api("ops/subject-packs/" + encodeURIComponent(pack.key) + "/versions/" + encodeURIComponent(v.pack_version) + "/publish", "POST", { version: v.version });
        } catch (e) {
          if (e.code === "version_conflict") {
            notice("草稿刚被修改过，已刷新，请核对后再发布。");
            return again();
          }
          throw e;
        }
        notice("已发布");
        await again();
      }),
    );
  } else if (!pack.versions.some((x) => x.status === "draft"))
    ops.append(
      cxBtn("＋ 基于这个版本新建草稿", async () => {
        const nv = await yxoAskVersion(v.pack_version);
        if (!nv) return;
        try {
          await api("ops/subject-packs", "POST", { key: pack.key, name: pack.name, pack_version: nv, content: v.content });
        } catch (e) {
          if (e.code === "duplicate" || /exists|duplicate/.test(e.code || "")) return notice("这个版本号已经有了，换一个");
          throw e;
        }
        st.subjectVer = nv;
        notice("已新建草稿 v" + nv);
        await again();
      }, "primary"),
    );
  hh.append(ops);
  head.append(hh, h("p", "muted yxo-note", "每个条目都有固定编号：改名称不改编号；新加的条目自动取新编号。删掉平台条目不会停用机构已导入的条目。价格只由机构自己填。"));
  box.append(head);
  // 课程库
  const courses = h("section", "cx-panel yxo-card");
  const ch = h("div", "yxo-card-head");
  ch.append(el("h2", "课程库 · " + content.courses.length + " 门"));
  if (draft)
    ch.append(
      h("span", "cx-spacer"),
      cxBtn("＋ 课程", () => {
        content.courses.push({ group: "", name: "新课程", form: "one_to_one", minutes: 45, duration_text: null, pricing: null, active: true, optional: false, key: "c_" + yxoKey() });
        mark();
        drawCourses();
      }),
    );
  courses.append(ch);
  const ct = h("div", "yxo-edit-table");
  courses.append(ct);
  const inp = (val, on, attrs = {}) => {
    const i = el("input", null, { type: "text", ...attrs });
    i.value = val ?? "";
    i.disabled = !draft;
    i.addEventListener("input", () => (on(i.value), mark()));
    return i;
  };
  const drawCourses = () => {
    ct.replaceChildren();
    const hr = h("div", "yxo-erow is-head");
    for (const x of ["课程组", "课程名称", "形式", "时长（分钟）", "或说明", "可选费用", ""]) hr.append(h("span", "", x));
    ct.append(hr);
    for (const x of content.courses) {
      const r = h("div", "yxo-erow" + (x.active === false ? " is-off" : ""));
      const form = el("select", null, { "aria-label": "形式" });
      for (const [k, t] of Object.entries(YXO_FORM)) form.append(el("option", t, { value: k }));
      form.value = x.form;
      form.disabled = !draft;
      form.addEventListener("change", () => ((x.form = form.value), mark()));
      const opt = el("input", null, { type: "checkbox", "aria-label": "可选费用" });
      opt.checked = !!x.optional;
      opt.disabled = !draft;
      opt.addEventListener("change", () => ((x.optional = opt.checked), mark()));
      const off = el("button", x.active === false ? "恢复" : "停用", { type: "button", class: "yxo-link" });
      off.disabled = !draft;
      off.addEventListener("click", () => ((x.active = x.active === false), mark(), drawCourses()));
      r.append(
        inp(x.group, (v2) => (x.group = v2), { "aria-label": "课程组", maxlength: "20" }),
        inp(x.name, (v2) => (x.name = v2), { "aria-label": "课程名称", maxlength: "40" }),
        form,
        inp(x.minutes ?? "", (v2) => (x.minutes = v2 === "" ? null : Number(v2)), { type: "number", min: "1", "aria-label": "时长（分钟）" }),
        inp(x.duration_text ?? "", (v2) => (x.duration_text = v2 || null), { "aria-label": "时长说明", maxlength: "20", placeholder: "如 半天" }),
        opt,
        off,
      );
      ct.append(r);
    }
  };
  drawCourses();
  box.append(courses);
  // 阶段 · 节点日历 · 报告维度
  const two = h("div", "yxo-two");
  const stages = h("section", "cx-panel yxo-card");
  stages.append(el("h2", "阶段 · " + content.stages.length));
  for (const s of content.stages) {
    const r = h("div", "yxo-line");
    r.append(inp(s.name, (v2) => (s.name = v2), { "aria-label": "阶段名称", maxlength: "20" }), h("small", "muted", (s.default_months ? s.default_months.min + "–" + s.default_months.max + " 个月" : "") + (s.anchor_node ? " · 对齐 " + s.anchor_node : "")));
    stages.append(r);
  }
  const cal = h("section", "cx-panel yxo-card");
  cal.append(el("h2", "节点日历 · " + content.calendar.length));
  for (const n of content.calendar) {
    const r = h("div", "yxo-line");
    r.append(inp(n.name, (v2) => (n.name = v2), { "aria-label": "节点名称", maxlength: "20" }), inp((n.months || []).join(","), (v2) => (n.months = v2.split(/[,，\s]+/).map(Number).filter((m) => m >= 1 && m <= 12)), { "aria-label": "月份（逗号分隔）", placeholder: "如 7,8" }));
    cal.append(r);
  }
  two.append(stages, cal);
  box.append(two);
  const cls = h("section", "cx-panel yxo-card");
  cls.append(el("h2", "成长报告班型与维度"));
  for (const k of content.classes) {
    const r = h("div", "yxo-class");
    r.append(inp(k.name, (v2) => (k.name = v2), { "aria-label": "班型名称", maxlength: "20" }));
    const dims = h("div", "yxo-dims");
    for (const d of k.dimensions) dims.append(inp(d.name, (v2) => (d.name = v2), { "aria-label": "维度名称", maxlength: "20" }));
    if (draft) {
      const add = el("button", "＋ 维度", { type: "button", class: "yxo-link" });
      add.addEventListener("click", () => {
        k.dimensions.push({ key: "d_" + yxoKey(), name: "新维度", order: k.dimensions.length + 1, feedback_tags: [] });
        mark();
        dims.insertBefore(inp("新维度", (v2) => (k.dimensions.at(-1).name = v2)), add);
      });
      dims.append(add);
    }
    r.append(dims);
    cls.append(r);
  }
  box.append(cls);
  // 可移植的示例方案随学科包发布，机构导入后保留为只读示例。
  const samples = h("section", "cx-panel yxo-card");
  samples.append(el("h2", "示例方案"), h("p", "muted", "示例不含个人信息或机构价格，引用本学科包的课程与阶段。导入示例文件后保存草稿，再随版本发布。"));
  const sampleList = h("div", "yxo-edit-table");
  const published = pack.versions.filter(x => x.status !== "draft").flatMap(x => x.content.sample_plans || []);
  const changedSample = sample => {
    const previous = Math.max(0, ...published.filter(x => x.key === sample.key).map(x => x.version));
    sample.version = Math.max(sample.version, previous + 1);
    mark();
  };
  const drawSamples = () => {
    sampleList.replaceChildren();
    if (!content.sample_plans?.length) sampleList.append(h("p", "muted", "还没有示例方案"));
    for (const sample of content.sample_plans || []) {
      const row = h("div", "yxo-card");
      row.append(el("strong", sample.key + " · v" + sample.version), inp(sample.name, value => changedSample(Object.assign(sample, { name: value })), { "aria-label": "示例名称", maxlength: "100" }), inp(sample.description, value => changedSample(Object.assign(sample, { description: value })), { "aria-label": "示例说明", maxlength: "1000" }));
      row.append(h("p", "muted", [sample.applicability?.subject, ...(sample.applicability?.directions || []), ...(sample.applicability?.grades || [])].filter(Boolean).join(" · ")));
      if (draft) row.append(cxBtn("移除示例", async () => {
        if (!(await cxAsk("移除示例“" + sample.name + "”？", "只从当前草稿移除，机构已导入的示例不受影响。", "移除"))) return;
        content.sample_plans = content.sample_plans.filter(x => x !== sample);
        mark();
        drawSamples();
      }));
      sampleList.append(row);
    }
  };
  if (draft) {
    const upload = el("input", null, { type: "file", accept: ".json,application/json", "aria-label": "导入示例方案文件" });
    upload.addEventListener("change", async () => {
      try {
        const file = upload.files?.[0];
        if (!file) return;
        if (file.size > 1024 * 1024) throw Error("示例文件不能超过 1MB");
        const value = JSON.parse(await file.text()), incoming = Array.isArray(value) ? value : [value];
        const next = structuredClone(content.sample_plans || []);
        const seen = new Set();
        for (const sample of incoming) {
          if (!sample || typeof sample.key !== "string" || !sample.name || !Number.isInteger(sample.version) || sample.version < 1 || sample.doc_version !== 2 || sample.doc?.subject !== pack.key || sample.applicability?.subject !== pack.key) throw Error("请选择本学科的可移植 v2 示例方案文件，包含名称、固定编号和整数版本号。");
          if (seen.has(sample.key)) throw Error("文件中示例编号重复");
          seen.add(sample.key);
          const index = next.findIndex(x => x.key === sample.key);
          if (index >= 0) {
            if (!(await cxAsk("替换示例“" + next[index].name + "”？", "替换当前草稿中的同编号示例，已发布版本不变。", "替换"))) return;
            sample.version = Math.max(sample.version, next[index].version + 1);
            next[index] = sample;
          } else next.push(sample);
        }
        content.sample_plans = next;
        mark();
        drawSamples();
        notice("已导入，请保存草稿；保存时会校验隐私和课程引用。");
      } catch (e) { notice(e.message); }
      finally { upload.value = ""; }
    });
    samples.append(upload);
  }
  samples.append(sampleList);
  drawSamples();
  box.append(samples);
  // 写作规则（只读摘要）
  const tone = h("section", "cx-panel yxo-card");
  tone.append(el("h2", "AI 写作规则"));
  const kv = (k, val) => {
    const r = h("div", "yxo-kv");
    r.append(h("span", "muted", k), h("span", "", val));
    tone.append(r);
  };
  kv("语气", content.tone || "—");
  kv("内容场景", (content.content_types || []).map((x) => x.name).join("、") || "—");
  kv("禁用说法", (content.constraints?.prohibited_terms || []).join("、") || "—");
  kv("政策来源", content.constraints?.policy_source || "—");
  kv("学员隐私", content.constraints?.student_privacy || "—");
  kv("报告依据", content.constraints?.report_basis || "—");
  tone.append(h("p", "muted yxo-note", "配课规则、阶段规则和以上写作规则随版本一起保存；全平台禁用词在“AI 用量与每日上限”里维护。"));
  box.append(tone);
}
function yxoCheckContent(c) {
  for (const x of c.courses) if (!String(x.name).trim()) throw Error("有课程没写名称");
  for (const x of c.courses) if (x.minutes != null && !(Number.isInteger(x.minutes) && x.minutes > 0)) throw Error("“" + x.name + "”的时长要是正整数分钟，或留空写说明");
  for (const x of c.stages) if (!String(x.name).trim()) throw Error("有阶段没写名称");
  for (const x of c.calendar) if (!String(x.name).trim() || !x.months?.length) throw Error("节点“" + (x.name || "未命名") + "”要写名称和月份");
  for (const k of c.classes) if (!k.dimensions.length || k.dimensions.some((d) => !String(d.name).trim())) throw Error("班型“" + k.name + "”至少一个维度，且都要有名称");
}
const yxoKey = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
function yxoAskVersion(cur) {
  const n = String(cur).split(".");
  n[n.length - 1] = String(Number(n.at(-1)) + 1);
  return new Promise((resolve) => {
    const d = el("dialog", null, { class: "cx-dialog", "aria-label": "新版本号" });
    const form = el("form");
    const input = el("input", null, { type: "text", "aria-label": "新版本号", value: n.join(".") });
    const done = (v) => {
      d.close();
      d.remove();
      resolve(v);
    };
    const ops = h("div", "cx-dialog-ops");
    const no = el("button", "取消", { type: "button", class: "button" });
    no.addEventListener("click", () => done(null));
    ops.append(no, el("button", "新建草稿", { type: "submit", class: "button primary" }));
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const v = input.value.trim();
      if (!/^\d+(\.\d+){1,2}$/.test(v)) return notice("版本号写成 0.2 或 1.0.0 这样的格式");
      done(v);
    });
    d.addEventListener("cancel", (e) => (e.preventDefault(), done(null)));
    form.append(input, ops);
    d.append(el("h2", "新版本号"), h("p", "muted", "复制 v" + cur + " 的内容作为草稿。"), form);
    document.body.append(d);
    d.showModal();
    input.select();
  });
}

// ---------- 机构图库容量（v0.4.1）----------
const yxoMB = (n) => (n >= 1073741824 ? (n / 1073741824).toFixed(1) + " GB" : Math.round(n / 1048576) + " MB");
async function yxGalleryStoragePanel(c, id) {
  const box = el("section", null, { class: "panel" });
  box.append(el("h2", "图库容量"));
  let g;
  try {
    g = await api("tenants/" + id + "/gallery-storage");
  } catch (e) {
    box.append(el("p", e.message, { class: "muted" }));
    return box;
  }
  box.append(el("p", "已用 " + yxoMB(g.used) + " / " + (g.limit ? yxoMB(g.limit) : "不允许上传") + (g.complete ? "" : "（还有 " + g.pending + " 张旧图未统计）") + (g.missing ? " · " + g.missing + " 张图片文件已缺失" : ""), { class: "muted" }));
  const form = el("form");
  field(form, "容量上限（MB，0 表示禁止新增上传）", "limit_mb", String(Math.round(g.limit / 1048576)), "number");
  submit(form, "保存上限", async (d) => {
    const mb = Number(d.limit_mb);
    if (!Number.isFinite(mb) || mb < 0) throw Error("请填写 0 或正数");
    try {
      await api("tenants/" + id + "/gallery-storage", "PUT", { limit: Math.round(mb * 1048576), version: g.version });
    } catch (e) {
      if (e.code === "version_conflict") throw Error("机构资料刚被改过，请刷新后再改");
      throw e;
    }
    await detail(c, id);
    notice("图库容量已更新");
  });
  box.append(form);
  if (!g.complete)
    box.append(
      button("继续统计旧图", async () => {
        await api("tenants/" + id + "/gallery-storage/recount", "POST", {});
        await detail(c, id);
      }),
    );
  return box;
}

// ---------- AI 用量与每日上限 ----------
const yxoUsage = { group: "day", days: 7, tenant: "" };
const YXO_TOOL = { content: "招生内容", plan: "课程方案", feedback: "课后反馈", report: "成长报告", settings: "一句话改设置" };
async function yxAiUsagePage(c) {
  const st = yxoUsage;
  const bj = (d) => new Date(d.getTime() + 8 * 3600000).toISOString().slice(0, 10);
  const to = bj(new Date()),
    from = bj(new Date(Date.now() - (st.days - 1) * 86400000));
  const qs = new URLSearchParams({ from, to, group: st.group });
  if (st.tenant) qs.set("tenant_id", st.tenant);
  const [cfg, usage, terms, tenantsList] = await Promise.all([api("ops/ai/settings"), api("ops/ai/usage?" + qs), api("ops/compliance/terms"), consoleTenants().catch(() => [])]);
  const names = new Map(tenantsList.map((t) => [t.id, t.name]));
  cxTop("AI 用量与每日上限", [], [], h("span", "cx-head-sub", "按北京时间统计；服务密钥只在 Cloudflare 设置，这里看不到"));
  c.replaceChildren();
  const items = usage.items || [];
  const sum = (tier, k) => items.filter((x) => !tier || x.tier === tier).reduce((a, x) => a + (x[k] || 0), 0);
  c.append(
    cxKpis([
      [sum("fast", "calls"), "快速 · 调用次数"],
      [sum("deep", "calls"), "深度 · 调用次数"],
      [sum("", "failed"), "失败次数", sum("", "failed") ? "warn" : ""],
      [(sum("", "prompt_tokens") + sum("", "completion_tokens")).toLocaleString("zh-CN"), "用掉的 token"],
    ]),
  );
  const grid = h("div", "yxo-split");
  const left = cxPanel("用量明细", from === to ? from : from + " 至 " + to);
  const bar = h("div", "yxo-filter");
  bar.append(
    cxSeg([["day", "按天"], ["tenant", "按机构"], ["tool", "按工具"]], st.group, (v) => ((st.group = v), yxAiUsagePage(c)), "分组"),
    cxSeg([["1", "今天"], ["7", "7 天"], ["30", "30 天"]], String(st.days), (v) => ((st.days = Number(v)), yxAiUsagePage(c)), "时间"),
  );
  const ts = el("select", null, { "aria-label": "机构" });
  ts.append(el("option", "全部机构", { value: "" }));
  for (const t of tenantsList) ts.append(el("option", t.name, { value: t.id }));
  ts.value = st.tenant;
  ts.addEventListener("change", () => ((st.tenant = ts.value), yxAiUsagePage(c)));
  bar.append(ts);
  left.append(bar);
  const t = cxTable([[{ day: "日期", tenant: "机构", tool: "工具" }[st.group]], ["档位"], ["调用", "num"], ["成功", "num"], ["失败", "num"], ["token", "num"], ["平均耗时", "num"]]);
  for (const x of items)
    t.row([
      st.group === "tenant" ? names.get(x.key) || x.key : st.group === "tool" ? YXO_TOOL[x.key] || x.key : x.key,
      x.tier === "deep" ? "深度" : "快速",
      String(x.calls),
      String(x.successful),
      x.failed ? yxoDot(String(x.failed), "bad") : "0",
      (x.prompt_tokens + x.completion_tokens).toLocaleString("zh-CN"),
      x.calls ? (x.duration_ms / x.calls / 1000).toFixed(1) + " 秒" : "—",
    ]);
  if (!items.length) t.row(["这段时间没有 AI 调用", "", "", "", "", "", ""]);
  left.append(t.wrap);
  // v0.4.1：失败原因汇总（只给平台看，机构端不显示）
  const why = {};
  for (const x of items) for (const [k, n] of Object.entries(x.failure_reasons || {})) why[k] = (why[k] || 0) + (n || 0);
  const WHY = { timeout: "超时", protocol_invalid: "返回格式不对", response_too_large: "返回内容过长", other: "其他", provider_http_401: "密钥无效（401）", provider_http_402: "DeepSeek 余额不足（402）", provider_http_404: "模型名不对（404）", provider_http_429: "请求过多（429）" };
  const whyList = Object.entries(why).filter(([, n]) => n);
  if (whyList.length) left.append(h("p", "muted yxo-note", "失败原因：" + whyList.map(([k, n]) => (WHY[k] || k.replace("provider_http_", "DeepSeek 返回 ")) + " " + n + " 次").join("；")));
  const right = h("div", "yxo-side");
  // 平台模型与默认上限
  const p1 = cxPanel("模型与默认每日上限", "所有机构共用；单个机构可在“机构管理 › 详情”里单独调整");
  const form = el("form", null, { class: "yxo-form" });
  const fm = field(form, "快速模式模型（文案、改写、一句话调整）", "fast_model", cfg.fast_model || "", "text", false);
  const dm = field(form, "深度模式模型（配课、长文）", "deep_model", cfg.deep_model || "", "text", false);
  const fl = field(form, "快速 · 每个机构每天", "fast_daily_limit", cfg.fast_daily_limit, "number");
  const dl = field(form, "深度 · 每个机构每天", "deep_daily_limit", cfg.deep_daily_limit, "number");
  for (const x of [fl, dl]) (x.min = "0"), (x.step = "1");
  fm.placeholder = dm.placeholder = "填 DeepSeek 账号里的模型名";
  form.append(h("p", "muted yxo-note", cfg.fast_model && cfg.deep_model ? "已填写模型名。DEEPSEEK_API_KEY 在 Cloudflare Pages 的 Secret 里设置。" : "还没填模型名，机构点 AI 会提示“AI 还没开通”。"));
  submit(form, "保存", async () => {
    // 模型名必须填写（接口不接受空值）；暂不想开 AI，把两档每日上限改成 0 即可。
    const fast = fm.value.trim(),
      deep = dm.value.trim();
    if (!fast || !deep) throw Error("两个模型名都要填写。暂时不开 AI 的话，把每日上限改成 0。");
    const fl2 = Number(fl.value),
      dl2 = Number(dl.value);
    if (![fl2, dl2].every((x) => Number.isInteger(x) && x >= 0)) throw Error("每日上限要填 0 或正整数");
    try {
      await api("ops/ai/settings", "PUT", { version: cfg.version, fast_model: fast, deep_model: deep, fast_daily_limit: fl2, deep_daily_limit: dl2 });
    } catch (e) {
      if (e.code === "version_conflict") {
        notice("设置刚被别人改过，没有保存。已刷新为最新设置，请核对后重新填写。");
        return yxAiUsagePage(c);
      }
      throw e;
    }
    notice("已保存");
    await yxAiUsagePage(c);
  });
  p1.append(form);
  // 全平台禁用词
  const p2 = cxPanel("全平台禁用词", "AI 生成和机构端检查都会避开；每行一个");
  const ta = el("textarea", null, { rows: "6", "aria-label": "禁用词，每行一个" });
  ta.value = (terms.items || []).filter((x) => x.active).map((x) => x.term).join("\n");
  p2.append(
    ta,
    cxBtn("保存禁用词", async () => {
      const list = [...new Set(ta.value.split("\n").map((x) => x.trim()).filter(Boolean))];
      await api("ops/compliance/terms", "PUT", { terms: list });
      notice("已保存 " + list.length + " 个禁用词");
    }, "primary"),
  );
  right.append(p1, p2);
  grid.append(left, right);
  c.append(grid);
}

// 推广中心改版（控制台）：内容列表、合作课跟进、发布向导、控制台账号。
// 只调用既有推广与账号接口；金额为整数元；时间按北京时间显示。
// ======================================================================
function h(tag, cls, text) {
  const n = el(tag, text);
  if (cls) n.className = cls;
  return n;
}
function cxBtn(text, fn, kind = "") {
  const b = button(text, fn, kind);
  b.classList.add("cx-btn");
  return b;
}
function cxChip(text, tone = "muted") {
  return h("span", "cx-chip cx-chip--" + tone, text);
}
function cxTop(title, crumbs = [], actions = [], extra = null) {
  if (!cxHead) return;
  cxHead.title.replaceChildren();
  for (const [label, fn] of crumbs) {
    const b = el("button", label, { type: "button", class: "cx-crumb" });
    b.addEventListener("click", fn);
    cxHead.title.append(b, h("span", "cx-crumb-sep", "›"));
  }
  cxHead.title.append(el(crumbs.length ? "h1" : "h1", title));
  if (extra) cxHead.title.append(extra);
  cxHead.actions.replaceChildren(...actions);
}
const cxYuan = (n) => (n === null || n === undefined ? "—" : (n < 0 ? "-¥" : "¥") + Math.abs(Number(n)).toLocaleString("zh-CN"));
// 毫秒时间戳或北京时间字符串（"2026-11-05T19:00" / 带 +08:00）→ 毫秒
const cxMs = (v) => (typeof v === "number" ? v : Date.parse(String(v).length <= 16 ? v + ":00+08:00" : v));
const cxBj = (v) => new Date(cxMs(v) + 8 * 3600000).toISOString();
const cxWeek = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const cxMd = (v) => cxBj(v).slice(5, 10);
const cxHm = (v) => cxBj(v).slice(11, 16);
const cxWd = (v) => cxWeek[new Date(cxBj(v).slice(0, 10) + "T12:00:00Z").getUTCDay()];
const cxMask = (phone) => (phone ? String(phone).slice(0, 3) + "****" + String(phone).slice(-4) : "");
// 页内确认框（不用浏览器原生弹窗）。
function cxAsk(title, text, ok = "确认", tone = "primary") {
  return new Promise((resolve) => {
    const d = el("dialog", null, { class: "cx-dialog", "aria-label": title });
    const done = (v) => {
      d.close();
      d.remove();
      resolve(v);
    };
    const ops = h("div", "cx-dialog-ops");
    const no = el("button", "取消", { type: "button", class: "button" });
    const yes = el("button", ok, { type: "button", class: "button " + tone });
    no.addEventListener("click", () => done(false));
    yes.addEventListener("click", () => done(true));
    d.addEventListener("cancel", (e) => {
      e.preventDefault();
      done(false);
    });
    ops.append(no, yes);
    d.append(el("h2", title), h("p", "preserve-text", text), ops);
    document.body.append(d);
    d.showModal();
    no.focus();
  });
}
function cxAskText(title, text, ok = "确认") {
  return new Promise((resolve) => {
    const d = el("dialog", null, { class: "cx-dialog", "aria-label": title });
    const form = el("form");
    const input = el("textarea", null, { rows: "3", "aria-label": title });
    const done = (v) => {
      d.close();
      d.remove();
      resolve(v);
    };
    const ops = h("div", "cx-dialog-ops");
    const no = el("button", "取消", { type: "button", class: "button" });
    no.addEventListener("click", () => done(null));
    ops.append(no, el("button", ok, { type: "submit", class: "button primary" }));
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const v = input.value.trim();
      if (v.length < 5) return notice("请至少填写 5 个字");
      done(v);
    });
    d.addEventListener("cancel", (e) => {
      e.preventDefault();
      done(null);
    });
    form.append(input, ops);
    d.append(el("h2", title), h("p", "muted", text), form);
    document.body.append(d);
    d.showModal();
    input.focus();
  });
}
// 表格：列 [标题, 类名]；手机上横向滚动。
function cxTable(cols, fit = false) {
  const wrap = h("div", "cx-table-wrap"),
    table = h("table", "cx-table" + (fit ? " cx-table--fit" : "")),
    head = el("thead"),
    tr = el("tr"),
    body = el("tbody");
  for (const [label, cls] of cols) tr.append(h("th", cls || "", label));
  head.append(tr);
  table.append(head, body);
  wrap.append(table);
  const row = (cells, cls) => {
    const r = el("tr");
    if (cls) r.className = cls;
    cells.forEach((v, i) => {
      const td = h("td", cols[i]?.[1] || "");
      if (v instanceof Node) td.append(v);
      else td.textContent = v ?? "";
      r.append(td);
    });
    body.append(r);
    return r;
  };
  return { wrap, body, row };
}
function cxStack(main, sub, cls = "") {
  const box = h("div", "cx-stack " + cls);
  box.append(main instanceof Node ? main : h("span", "", main));
  if (sub) box.append(sub instanceof Node ? sub : h("small", "", sub));
  return box;
}
function cxSeg(options, value, onChange, label) {
  const g = el("div", null, { class: "cx-seg", role: "radiogroup", "aria-label": label });
  const set = (v) => {
    for (const b of g.children) b.setAttribute("aria-checked", String(b.dataset.value === v));
  };
  for (const [v, text] of options) {
    const b = el("button", text, { type: "button", role: "radio", "data-value": v });
    b.addEventListener("click", () => {
      set(v);
      onChange(v);
    });
    g.append(b);
  }
  set(value);
  return g;
}
function cxSwitch(on, label, onToggle) {
  const b = el("button", null, { type: "button", role: "switch", class: "cx-switch", "aria-checked": String(!!on), "aria-label": label });
  b.append(h("span", "cx-switch-knob"));
  b.addEventListener("click", async () => {
    b.disabled = true;
    try {
      await onToggle(b.getAttribute("aria-checked") !== "true");
    } catch (e) {
      notice(e.message);
    } finally {
      b.disabled = false;
    }
  });
  return b;
}
function cxPanel(title, sub, actions = []) {
  const p = h("section", "cx-panel");
  const head = h("div", "cx-panel-head");
  const t = h("div", "cx-panel-title");
  t.append(el("h2", title));
  if (sub) t.append(h("p", "muted", sub));
  head.append(t, h("span", "cx-spacer"), ...actions);
  p.append(head);
  return p;
}
function cxKpis(items) {
  const box = h("div", "cx-kpis");
  for (const [value, label, tone, extra] of items) {
    const k = h("div", "cx-kpi" + (tone ? " cx-kpi--" + tone : ""));
    k.append(h("strong", "", String(value)), h("span", "", label));
    if (extra) k.append(extra);
    box.append(k);
  }
  return box;
}
const cxType = (row, pc) =>
  row.type === "course" ? ((pc?.format || row.format) === "lecture" ? "讲座" : "合作课") : row.type === "material" ? "物料" : "通知";
const cxDot = (row, pc) => h("span", "cx-dot cx-dot--" + (row.type === "course" ? ((pc?.format || row.format) === "lecture" ? "lecture" : "course") : row.type), "");
function cxStatus(row, pc) {
  if (row.status === "archived") return ["已下架", "muted"];
  if (row.status === "draft") return ["草稿", "muted"];
  if (row.publish_at > Date.now()) return ["待发布", "muted"];
  if (pc) return [{ recruiting: "招募中", opened: "已开班", running: "进行中", ended: "已结束", failed: "未成班" }[pc.status] || "招募中", pc.status === "recruiting" ? "info" : pc.status === "failed" ? "muted" : "ok"];
  return ["展示中", "info"];
}
const cxState = { tab: "all" };
const cxDetails = new Map();
async function cxDetail(id, fresh = false) {
  if (fresh || !cxDetails.has(id)) cxDetails.set(id, api("promo/" + id + "?offset=0").catch((e) => (cxDetails.delete(id), Promise.reject(e))));
  return cxDetails.get(id);
}
function cxAudience(row) {
  return row.audience === "all" ? "全部机构" : row.audience === "type" ? (row.audience_type || "") + "类" : "指定 " + (row.delivered || 0) + " 家";
}

// ---------- 1. 内容列表 ----------
async function cxPromo(c, tab = cxState.tab) {
  cxState.tab = tab;
  cxDetails.clear();
  const data = await api("promo?offset=0");
  // 服务端每页 200 条；超过时继续取后面的页，保证旧内容不会“消失”（通常只有一页）。
  for (let page = data.items; page.length === 200 && data.items.length < 5000; ) {
    page = (await api("promo?offset=" + data.items.length)).items || [];
    data.items.push(...page);
  }
  if (!c.isConnected) return;
  cxTop("推广中心", [], [cxBtn("＋ 发布内容", () => cxPublish(c), "primary")]);
  c.replaceChildren();
  const s = data.summary || {};
  c.append(
    cxKpis([
      [s.awaiting_contact || 0, "申请待顾问联系", s.awaiting_contact ? "warn" : ""],
      [s.unpaid_institutions || 0, "已确认席位、未确认收款的机构", s.unpaid_institutions ? "warn" : ""],
      [s.recruiting || 0, "招募中的合作课"],
      [s.published_this_month || 0, "本月已发布内容"],
    ]),
  );
  const live = data.items.filter((r) => r.status !== "archived");
  const groups = {
    all: live,
    course: live.filter((r) => r.type === "course"),
    material: live.filter((r) => r.type === "material"),
    message: live.filter((r) => r.type === "message"),
    archived: data.items.filter((r) => r.status === "archived"),
  };
  const panel = h("section", "cx-panel cx-panel--flush");
  const tabs = el("div", null, { class: "cx-tabs", role: "tablist", "aria-label": "内容分类" });
  for (const [k, label] of [
    ["all", "全部"],
    ["course", "合作课与讲座"],
    ["material", "招生物料"],
    ["message", "通知"],
    ["archived", "已下架"],
  ]) {
    const b = el("button", label + (k === "archived" ? "" : " " + groups[k].length), { type: "button", role: "tab", "aria-selected": String(k === tab) });
    b.addEventListener("click", () => cxPromo(c, k).catch((e) => notice(e.message)));
    tabs.append(b);
  }
  panel.append(tabs);
  const t = cxTable([
    ["内容", "cx-col-main"],
    ["状态"],
    ["发给"],
    ["显示时间"],
    ["查看机构", "cx-num"],
    ["申请机构", "cx-num"],
    ["确认席位", "cx-num"],
    ["跟进"],
    ["", "cx-col-op"],
  ]);
  const rows = groups[tab] || [];
  const jobs = [];
  for (const r of rows) {
    const name = h("div", "cx-title-line");
    const open = el("button", r.title, { type: "button", class: "cx-link" });
    open.addEventListener("click", () => cxCourse(c, r.id).catch((e) => notice(e.message)));
    name.append(cxDot(r), open);
    const sub = h("small", "cx-sub", cxType(r));
    if (r.type === "course" && r.is_free) sub.prepend(h("span", "cx-free", "免费"));
    const status = h("span", "cx-status-cell");
    const [st, tone] = cxStatus(r);
    status.append(cxChip(st, tone));
    const course = r.type === "course";
    const seats = h("span", "", course ? String(r.confirmed_seats || 0) + (r.min_size ? " / 最低 " + r.min_size : "") : "—");
    const follow = h("span", "cx-follow");
    if (r.awaiting_contact) follow.append(cxChip(r.awaiting_contact + " 家待联系", "warn"));
    if (r.unpaid_confirmed) follow.append(cxChip(r.unpaid_confirmed + " 家未收款", "warn"));
    const op = cxBtn(r.status === "draft" ? "编辑" : course && r.awaiting_contact ? "跟进" : "查看", () => cxCourse(c, r.id));
    t.row(
      [
        cxStack(name, sub),
        status,
        cxAudience(r),
        cxMd(r.publish_at) + (r.expire_at ? " 至 " + cxMd(r.expire_at) : " 起"),
        r.status === "draft" ? "—" : (r.viewed || 0) + " / " + (r.delivered || 0),
        course ? String(r.applications || 0) : "—",
        seats,
        follow,
        op,
      ],
      r.status !== "published" ? "is-dim" : "",
    );
    // 列表接口没有课程状态和课次，合作课逐条补读详情（本页一次访问只读一次）。
    if (course && r.status !== "archived")
      jobs.push(async () => {
        const d = await cxDetail(r.id);
        const pc = d.course;
        if (!pc) return;
        const [st2, tone2] = cxStatus(r, pc);
        status.replaceChildren(cxChip(st2, tone2));
        const live2 = d.sessions.filter((x) => !x.cancelled);
        const parts = [cxType(r, pc), live2.length + " 课次"];
        if (pc.status === "recruiting") parts.push("申请截止 " + cxMd(pc.apply_deadline));
        else if (live2.length) {
          const next = live2.find((x) => Date.parse(x.start_at) > Date.now());
          parts.push(next ? "下次 " + cxMd(next.start_at) : "已全部上完");
        }
        sub.replaceChildren(...(pc.is_free ? [h("span", "cx-free", "免费")] : []), parts.join(" · "));
        if (pc.status !== "recruiting") seats.textContent = String(r.confirmed_seats || 0);
        if (pc.status === "recruiting" && r.awaiting_contact) op.textContent = "跟进";
      });
    if (r.type === "material" && r.status !== "draft")
      jobs.push(async () => {
        const d = await cxDetail(r.id);
        if (d.stats?.downloads) follow.append(h("span", "muted", "下载 / 保存 " + d.stats.downloads));
      });
  }
  if (!rows.length) t.row([h("span", "muted", tab === "archived" ? "没有已下架的内容" : "还没有内容，点右上角“发布内容”")]);
  panel.append(t.wrap, h("p", "cx-foot", "共 " + rows.length + " 条 · 查看机构 = 已打开过这条内容的机构 / 收到这条内容的机构"));
  c.append(panel);
  for (const job of jobs) await job().catch(() => {});
}

// ---------- 2. 合作课跟进（也用于物料、通知的详情） ----------
async function cxCourse(c, id, focusTenant = null) {
  const data = await cxDetail(id, true),
    row = data.campaign,
    pc = data.course;
  const [st, tone] = cxStatus(row, pc);
  const chipText = pc && pc.status === "recruiting" ? st + " · " + cxMd(pc.apply_deadline) + " 截止" : st;
  const acts = [cxBtn("编辑内容", () => cxEdit(c, data))];
  if (row.status === "published")
    acts.push(
      cxBtn("下架", async () => {
        if (!(await cxAsk("下架这条内容？", "下架后机构端不再显示；已开班的合作课课次不受影响，可随时重新上架。", "下架"))) return;
        await api("promo/" + id + "/state", "PUT", { version: row.version, status: "archived" });
        notice("已下架");
        await cxCourse(c, id);
      }),
    );
  if (row.status === "archived")
    acts.push(
      cxBtn("删除", async () => {
        const reason = await cxAskText("彻底删除这条内容？", "只有已下架、没有任何机构报名、确认席位或开班记录的内容可以删除；有关联时请保持下架。请写明原因（至少 5 个字）。", "删除");
        if (!reason) return;
        await api("promo/" + id, "DELETE", { version: row.version, reason, operation_id: crypto.randomUUID() });
        notice("已删除");
        await cxPromo(c);
      }),
    );
  if (row.status !== "published")
    acts.push(
      cxBtn(row.status === "draft" ? "发布" : "重新上架", async () => {
        await api("promo/" + id + "/state", "PUT", { version: row.version, status: "published" });
        notice("已发布，机构端按显示时间可见");
        await cxCourse(c, id);
      }, "primary"),
    );
  if (!c.isConnected) return;
  cxTop(row.title, [["推广中心", () => cxPromo(c).catch((e) => notice(e.message))]], acts, cxChip(chipText, tone));
  c.replaceChildren();
  const stats = data.stats || {},
    sum = data.application_summary || {};
  const pct = stats.delivered ? Math.round(((stats.viewed || 0) / stats.delivered) * 100) + "%" : "";
  if (pc) {
    const bar = el("progress", null, { class: "cx-progress", max: String(pc.min_size || 1), value: String(Math.min(sum.confirmed || 0, pc.min_size || 1)), "aria-label": "已确认席位进度" });
    c.append(
      cxKpis([
        [stats.delivered || 0, "发给机构"],
        [stats.viewed || 0, "已查看", "", pct ? h("em", "", pct) : null],
        [sum.institutions || 0, "已申请", "", h("em", "", "预计 " + (sum.estimated || 0) + " 人" + (sum.unsure ? " · " + sum.unsure + " 家不确定" : ""))],
        [sum.confirmed || 0, "已确认席位", (sum.confirmed || 0) < pc.min_size ? "warn" : "ok", cxStack(h("em", "", "/ 最低 " + pc.min_size + " 才能开班"), bar)],
      ]),
    );
    c.append(cxApplications(c, data));
    const grid = h("div", "cx-grid");
    grid.append(cxSessions(c, data), await cxFollowups(c, data, focusTenant));
    c.append(grid);
  } else {
    c.append(
      cxKpis([
        [stats.delivered || 0, "发给机构"],
        [stats.viewed || 0, "已查看", "", pct ? h("em", "", pct) : null],
        [stats.downloads || 0, "海报下载 / 保存"],
        [cxMd(row.publish_at) + (row.expire_at ? " 至 " + cxMd(row.expire_at) : " 起"), "显示时间"],
      ]),
    );
    const body = cxPanel(row.type === "message" ? "通知内容" : "说明", cxAudience(row));
    if (row.summary) body.append(h("p", "cx-lead", row.summary));
    if (row.body) body.append(h("p", "preserve-text", row.body));
    c.append(body);
  }
  c.append(await cxPosters(c, data));
}
function cxApplications(c, data) {
  const pc = data.course,
    id = data.campaign.id,
    sum = data.application_summary || {};
  const recruiting = pc.status === "recruiting";
  const short = Math.max(0, pc.min_size - (sum.confirmed || 0));
  const acts = [];
  if (recruiting || pc.status === "opened" || pc.status === "running")
    acts.push(
      cxBtn("未成班 · 取消未来课次", async () => {
        const reason = await cxAskText("未成班 / 取消未来课次", "会取消所有机构课表里还没上的合作课次，并通知申请机构。请写明原因（至少 5 个字）。", "确认取消");
        if (!reason) return;
        await api("promo/" + id + "/fail", "POST", { version: pc.version, reason });
        notice("已处理：未来课次已取消");
        await cxCourse(c, id);
      }),
    );
  if (recruiting) {
    const open = cxBtn(short ? "确认开班（还差 " + short + " 席）" : "确认开班", async () => {
      if (!(await cxAsk("确认开班？", "开班后全部课次会排进已确认机构的课表，已确认的席位不能再修改。", "确认开班"))) return;
      await api("promo/" + id + "/open", "POST", { version: pc.version });
      notice("已开班，课次已进入机构课表");
      await cxCourse(c, id);
    }, "primary");
    open.disabled = short > 0;
    if (short) open.title = "确认席位达到最低开班人数后才能开班";
    acts.push(open);
  }
  const live = data.applications.filter((a) => a.status !== "withdrawn");
  const p = cxPanel("机构申请 " + live.length, "联系机构确认人数后填写席位；收款在系统外完成，这里只做标记", acts);
  const t = cxTable([
    ["机构"],
    ["联系人"],
    ["预计", "cx-num"],
    ["跟进"],
    ["确认席位", "cx-num"],
    ["应收", "cx-num"],
    ["已收款"],
    ["负责顾问"],
    ["", "cx-col-op"],
  ]);
  const save = async (a, patch) => {
    await api("promo/" + id + "/applications/" + a.id, "PUT", {
      status: a.status === "confirmed" ? "confirmed" : "following",
      confirmed_size: a.confirmed_size || undefined,
      consultant: a.consultant || admin.username,
      consultant_note: a.consultant_note || "",
      version: a.version,
      ...patch,
    });
  };
  for (const a of [...live, ...data.applications.filter((x) => x.status === "withdrawn")]) {
    const gone = a.status === "withdrawn" || a.status === "failed";
    const contact = h("span", "cx-contact");
    contact.append(a.contact_name || "—");
    if (a.contact_phone) {
      const ph = el("button", cxMask(a.contact_phone), { type: "button", class: "cx-phone", title: "点击显示完整号码" });
      ph.addEventListener("click", () => (ph.textContent = a.contact_phone));
      contact.append(" · ", ph);
    }
    const follow = h("div", "cx-stack");
    const fs = a.status === "applied" ? ["待联系", "warn"] : a.status === "withdrawn" ? ["已撤回", "muted"] : a.status === "failed" ? ["未成班", "muted"] : ["已联系", "info"];
    follow.append(cxChip(...fs));
    if (a.last_followup_summary) follow.append(h("small", "cx-sub", a.last_followup_summary));
    else if (a.unsure) follow.append(h("small", "cx-sub", "人数还不确定"));
    let seats;
    if (recruiting && !gone) {
      seats = el("input", null, { type: "number", min: "1", max: "200", step: "1", inputmode: "numeric", class: "cx-seat", placeholder: "—", "aria-label": a.tenant_name + " 确认席位" });
      seats.value = a.status === "confirmed" ? String(a.confirmed_size) : "";
      seats.addEventListener("change", async () => {
        const n = Number(seats.value);
        try {
          if (seats.value === "" || n === 0) await save(a, { status: "following" });
          else if (!Number.isInteger(n) || n < 1 || n > 200) throw Error("席位请填 1–200 的整数");
          else await save(a, { status: "confirmed", confirmed_size: n });
          notice(seats.value ? "已确认 " + n + " 席" : "已改为未确认");
          await cxCourse(c, id);
        } catch (e) {
          notice(e.message);
          seats.value = a.status === "confirmed" ? String(a.confirmed_size) : "";
        }
      });
    } else seats = h("span", "", ["confirmed", "opened"].includes(a.status) ? String(a.confirmed_size) : "—");
    const due = pc.is_free ? h("span", "cx-free-text", "免费") : h("span", "", a.amount_due === null || a.amount_due === undefined ? "—" : cxYuan(a.amount_due));
    const paid = h("span", "cx-paid");
    if (a.amount_due !== null && a.amount_due !== undefined && !pc.is_free) {
      paid.append(
        cxSwitch(a.paid, a.tenant_name + " 已收款", async (on) => {
          await api("promo/" + id + "/applications/" + a.id + "/paid", "PUT", { version: a.version, paid: on });
          notice(on ? "已标记收款（只做标记，不进入机构财务）" : "已撤销收款标记");
          await cxCourse(c, id);
        }),
      );
      if (!a.paid) paid.append(cxChip("待收款", "warn"));
      else if (a.paid_at) paid.append(h("small", "muted", cxMd(a.paid_at)));
    } else paid.append("—");
    const rec = cxBtn("记录跟进", () => cxCourse(c, id, a.tenant_id));
    t.row(
      [cxStack(h("strong", "", a.tenant_name), cxMd(a.created_at) + " 申请"), contact, a.unsure ? "不确定" : String(a.est_size ?? "—"), follow, seats, due, paid, a.consultant || "—", gone ? "" : rec],
      gone ? "is-dim" : "",
    );
  }
  if (!data.applications.length) t.row([h("span", "muted", "还没有机构申请")]);
  p.append(t.wrap);
  const foot = h("p", "cx-foot", "已查看未申请：" + (sum.viewed_not_applied || 0) + " 家　　未查看：" + (sum.unviewed || 0) + " 家");
  p.append(foot);
  return p;
}
function cxSessionForm(c, id, s) {
  const { panel, close } = drawer(s ? "改期 · 第 " + s.n + " 次" : "批量设置会议");
  const form = el("form");
  if (s) {
    field(form, "时间（北京时间）", "start_at", s.start_at.slice(0, 16), "datetime-local");
    promoSelect(form, "时长", "duration", [["30", "30 分钟"], ["45", "45 分钟"], ["60", "60 分钟"]], String(s.duration));
  }
  field(form, "腾讯会议号", "meeting_no", s?.meeting_no || "", "text", false);
  field(form, "入会链接", "meeting_url", s?.meeting_url || "", "url", false);
  form.append(h("p", "muted", s ? "保存后同步到所有已开班机构的课表；会议信息只给机构员工看，学员端不显示。" : "只改还没开始的课次；会议信息只给机构员工看，学员端不显示。"));
  submit(form, s ? "保存并同步" : "应用到未开始的课次", async (d) => {
    const list = s ? [s] : c.__cxSessions.filter((x) => !x.cancelled && Date.parse(x.start_at) > Date.now());
    for (const x of list)
      await api("promo/" + id + "/sessions/" + x.id, "PUT", {
        start_at: s ? d.start_at : x.start_at.slice(0, 16),
        duration: Number(s ? d.duration : x.duration),
        meeting_no: d.meeting_no,
        meeting_url: d.meeting_url,
        version: x.version,
      });
    close();
    notice(s ? "已改期并同步" : "已设置 " + list.length + " 个课次");
    await cxCourse(c, id);
  });
  panel.append(form);
}
function cxSessions(c, data) {
  const id = data.campaign.id;
  const list = data.sessions.slice().sort((a, b) => a.start_at.localeCompare(b.start_at)).map((s, i) => ({ ...s, n: i + 1 }));
  c.__cxSessions = list;
  const p = cxPanel("课次与会议 " + list.length, "开班后自动推送到每家机构的课表，改期会同步", [cxBtn("批量设置会议", () => cxSessionForm(c, id, null))]);
  const t = cxTable([["课次"], ["时间"], ["腾讯会议"], ["", "cx-col-op"]]);
  const rows = [];
  for (const s of list) {
    const end = cxMs(s.start_at) + s.duration * 60000;
    const meet = s.meeting_no ? h("span", "", s.meeting_no) : h("span", "cx-missing", "未填写");
    const past = cxMs(s.start_at) <= Date.now();
    const r = t.row(
      [
        "第 " + s.n + " 次",
        cxMd(s.start_at) + " " + cxWd(s.start_at) + " " + cxHm(s.start_at) + "–" + new Date(end + 8 * 3600000).toISOString().slice(11, 16),
        s.cancelled ? cxChip("已取消", "muted") : meet,
        s.cancelled || past ? h("span", "muted", past ? "已开始" : "") : cxBtn("改期", () => cxSessionForm(c, id, s)),
      ],
      s.cancelled || past ? "is-dim" : "",
    );
    rows.push(r);
  }
  p.append(t.wrap);
  if (rows.length > 6) {
    for (const r of rows.slice(6)) r.hidden = true;
    const more = el("button", "… 共 " + rows.length + " 次，展开全部", { type: "button", class: "cx-more" });
    more.addEventListener("click", () => {
      for (const r of rows) r.hidden = false;
      more.remove();
    });
    p.append(more);
  }
  return p;
}
async function cxFollowups(c, data, focusTenant) {
  const id = data.campaign.id;
  const apps = data.applications.filter((a) => a.status !== "withdrawn");
  const p = h("section", "cx-panel cx-timeline");
  if (!apps.length) {
    p.append(el("h2", "跟进记录"), h("p", "muted", "机构申请后，可以在这里记录每次沟通。"));
    return p;
  }
  const current = apps.find((a) => a.tenant_id === focusTenant) || apps.find((a) => a.status === "applied") || apps[0];
  const head = h("div", "cx-panel-head");
  const pick = el("select", null, { "aria-label": "选择机构" });
  for (const a of apps) pick.append(el("option", a.tenant_name, { value: a.tenant_id }));
  pick.value = current.tenant_id;
  pick.addEventListener("change", () => cxCourse(c, id, pick.value).catch((e) => notice(e.message)));
  head.append(el("h2", "跟进记录"), h("span", "cx-spacer"), pick);
  p.append(head);
  const list = h("ol", "cx-events");
  const items = (await api("promo/" + id + "/followups?tenant_id=" + current.tenant_id + "&offset=0")).items;
  for (const f of items) {
    const li = el("li");
    li.append(h("small", "", cxMd(f.created_at) + " " + cxHm(f.created_at) + " · " + f.admin_name), h("p", "preserve-text", f.text));
    list.append(li);
  }
  if (!items.length) list.append(h("li", "cx-empty", "还没有跟进记录"));
  const form = el("form", null, { class: "cx-note-form" });
  const text = el("textarea", null, { rows: "3", maxlength: "500", placeholder: "记一笔：沟通了什么、下一步是什么", "aria-label": "跟进内容" });
  const save = el("button", "保存跟进", { type: "submit", class: "button primary cx-btn" });
  form.append(text, save);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const v = text.value.trim();
    if (!v) return notice("请先写跟进内容");
    save.disabled = true;
    try {
      await api("promo/" + id + "/followups", "POST", { tenant_id: current.tenant_id, text: v });
      // 记过跟进即视为已联系：仍是“已申请”的改为“跟进中”。
      if (current.status === "applied" && data.course.status === "recruiting")
        await api("promo/" + id + "/applications/" + current.id, "PUT", { status: "following", consultant: current.consultant || admin.username, consultant_note: current.consultant_note || "", version: current.version });
      notice("已保存跟进");
      await cxCourse(c, id, current.tenant_id);
    } catch (err) {
      notice(err.message);
      save.disabled = false;
    }
  });
  p.append(list, form);
  return p;
}
async function cxPosters(c, data) {
  const id = data.campaign.id,
    pc = data.course;
  const p = cxPanel(
    "招生物料",
    "海报 " + data.posters.length + " 张" + (pc?.detail_image_key ? " · 课程详情长图 1 张（自动加入）" : "") + "；机构端自动合成本机构 Logo 和二维码",
    [cxBtn("上传海报底图", () => promoPosterEditor(c, id))],
  );
  const grid = h("div", "cx-thumbs");
  const add = async (key, label, fn) => {
    const fig = el("figure", null, { class: "cx-thumb" });
    try {
      const img = await promoAdminThumb(key);
      fig.append(el("img", null, { src: img.url, alt: label }));
    } catch {
      fig.append(h("span", "muted", "图片读取失败"));
    }
    const cap = el("figcaption");
    cap.append(h("span", "", label));
    if (fn) cap.append(cxBtn("调整占位", fn));
    fig.append(cap);
    grid.append(fig);
  };
  let i = 0;
  for (const poster of data.posters) await add(poster.image_key, "海报 " + ++i, () => promoSinglePoster(c, id, poster));
  if (pc?.detail_image_key) await add(pc.detail_image_key, "课程详情长图", null);
  if (!grid.children.length) grid.append(h("p", "muted", "还没有海报。上传宽 1080 像素的底图，拖动框决定机构 Logo 和二维码的位置。"));
  p.append(grid);
  return p;
}
// 编辑内容：标题、简介、正文；合作课另有形式、主讲、免费、价格、详情长图。
function cxEdit(c, data) {
  const row = data.campaign,
    pc = data.course;
  const { panel, close } = drawer("编辑内容");
  const form = el("form");
  field(form, "标题", "title", row.title);
  field(form, "简介", "summary", row.summary, "textarea", false);
  field(form, "正文", "body", row.body, "textarea", false);
  let format = pc?.format || "course",
    free = !!pc?.is_free,
    long = null;
  const progress = h("p", "muted", "");
  if (pc) {
    form.append(h("p", "cx-label", "形式"), cxSeg([["course", "合作课"], ["lecture", "讲座"]], format, (v) => (format = v), "形式"));
    field(form, "主讲", "lecturer", pc.lecturer);
    const prices = h("div", "cx-row2");
    const seat = field(prices, "席位价（元 / 人）", "seat_price", pc.seat_price ?? "", "number", false),
      sug = field(prices, "建议收费（元 / 人）", "suggested_price", pc.suggested_price ?? "", "number", false);
    seat.step = sug.step = "1";
    const locked = data.applications.some((a) => ["confirmed", "opened"].includes(a.status));
    form.append(
      h("p", "cx-label", "收费"),
      cxSeg([["paid", "按席位收费"], ["free", "免费"]], free ? "free" : "paid", (v) => {
        free = v === "free";
        prices.hidden = free;
      }, "收费方式"),
    );
    if (locked) form.append(h("p", "muted", "已有确认席位，收费方式不能再改。"));
    prices.hidden = free;
    form.append(prices);
    const file = field(form, "更换课程详情长图（宽 750 像素，可不换）", "detail_image", "", "file", false);
    file.accept = "image/png,image/jpeg";
    file.addEventListener("change", async () => {
      long = file.files[0] || null;
      if (long && (await cxWidth(long)) !== 750) {
        notice("课程详情长图宽度须为 750 像素");
        file.value = "";
        long = null;
      }
    });
  }
  form.append(progress);
  submit(form, "保存", async (d) => {
    const payload = { version: row.version, title: d.title, summary: d.summary, body: d.body };
    if (pc) {
      const whole = (v, label) => {
        if (v === "" || v === undefined) return free ? null : (() => { throw Error("请填写" + label); })();
        const n = Number(v);
        if (!Number.isInteger(n) || n < 0) throw Error(label + "请填整数元");
        return n;
      };
      Object.assign(payload, {
        course_version: pc.version,
        format,
        is_free: free ? 1 : 0,
        lecturer: d.lecturer,
        seat_price: free ? null : whole(d.seat_price, "席位价"),
        suggested_price: free ? null : whole(d.suggested_price, "建议收费"),
      });
      if (long) payload.detail_image_key = (await promoAdminUpload(long, "detail", progress)).id;
    }
    await api("promo/" + row.id, "PATCH", payload);
    close();
    notice("已保存");
    await cxCourse(c, row.id);
  });
  panel.append(form);
}
async function cxWidth(file) {
  const url = URL.createObjectURL(file),
    img = new Image();
  img.src = url;
  try {
    await img.decode();
    return img.naturalWidth;
  } catch {
    return 0;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---------- 3. 发布向导（一页 6 步，右侧实时预览机构看到的卡片） ----------
async function cxPublish(c) {
  const st = {
    kind: "course", // course | lecture | material | message
    free: false,
    audience: "all",
    long: null,
    posters: [],
    slots: null,
  };
  let tenantsList = null;
  try {
    tenantsList = await consoleTenants();
  } catch {
    tenantsList = null; // 主管顾问看不到机构名单：只能发给全部或按类型。
  }
  const go = (mode) => () => send(mode);
  if (!c.isConnected) return;
  cxTop("发布内容", [["推广中心", () => cxPromo(c).catch((e) => notice(e.message))]], [cxBtn("存为草稿", go("draft")), cxBtn("定时发布", go("schedule")), cxBtn("立即发布", go("now"), "primary")]);
  c.replaceChildren();
  const layout = h("div", "cx-publish");
  const form = el("form", null, { class: "cx-steps", novalidate: "" });
  form.addEventListener("submit", (e) => e.preventDefault());
  const aside = h("div", "cx-preview");
  layout.append(form, aside);
  c.append(layout);
  const step = (n, title) => {
    const s = h("section", "cx-panel cx-step");
    const head = h("div", "cx-step-head");
    head.append(h("span", "cx-step-n", String(n)), el("h2", title));
    s.append(head);
    form.append(s);
    return s;
  };
  const input = (box, label, name, type = "text", attrs = {}) => {
    const wrap = h("label", "field", label);
    const i = el(type === "textarea" ? "textarea" : "input", null, { name, ...attrs });
    if (type !== "textarea") i.type = type;
    wrap.append(i);
    box.append(wrap);
    i.addEventListener("input", preview);
    return i;
  };
  // 1 类型
  const s1 = step(1, "内容类型");
  s1.append(
    cxSeg([["course", "合作课"], ["lecture", "讲座"], ["material", "招生物料"], ["message", "通知"]], st.kind, (v) => {
      st.kind = v;
      sync();
    }, "内容类型"),
    h("p", "muted", "合作课和讲座可以申请名额、开班；招生物料只发海报；通知只发文字。"),
  );
  // 2 信息
  const s2 = step(2, "课程信息");
  const title = input(s2, "标题", "title", "text", { maxlength: "120" });
  const summary = input(s2, "简介", "summary", "textarea", { maxlength: "300", rows: "3" });
  const pair = h("div", "cx-row2");
  const grade = input(pair, "适合年级（写进正文第一行，可不填）", "grade", "text", { maxlength: "40", placeholder: "如：小学四年级至初三" });
  const lecturer = input(pair, "主讲", "lecturer", "text", { maxlength: "100" });
  s2.append(pair);
  const body = input(s2, "正文（可不填）", "body", "textarea", { maxlength: "9000", rows: "4" });
  const longBox = h("div", "cx-long");
  const longThumb = h("div", "cx-long-thumb");
  const longPick = el("input", null, { type: "file", accept: "image/png,image/jpeg", class: "cx-file", id: "cx-long-file" });
  const longDrop = el("label", null, { class: "cx-drop", for: "cx-long-file" });
  longDrop.append(h("span", "", "拖入或点击选择长图：宽 750 像素，高度不限，PNG / JPG"));
  const takeLong = async (f) => {
    if (!f) return;
    if ((await cxWidth(f)) !== 750) return notice("课程详情长图宽度须为 750 像素");
    if (st.long?.url) URL.revokeObjectURL(st.long.url);
    st.long = { file: f, url: URL.createObjectURL(f) };
    longThumb.replaceChildren(el("img", null, { src: st.long.url, alt: "课程详情长图预览" }));
    longDrop.classList.add("is-has");
    longDrop.firstChild.textContent = "已选 " + f.name + "，点击可更换";
  };
  longPick.addEventListener("change", () => takeLong(longPick.files[0]));
  cxDropZone(longDrop, (files) => takeLong(files[0]));
  const longText = h("div", "cx-long-text");
  longText.append(h("p", "cx-label", "课程详情长图（必填）"), longPick, longDrop, h("p", "muted", "机构打开课程时，长图放在页面中间最显眼的位置；手机上整屏显示。长图也会自动加入这门课的招生物料，供机构下载。"));
  longBox.append(longThumb, longText);
  s2.append(longBox);
  // 3 席位
  const s3 = step(3, "席位与开班");
  const prices = h("div", "cx-row4");
  const seat = input(prices, "席位价（元 / 人）", "seat_price", "number", { min: "0", step: "1", inputmode: "numeric" });
  const sug = input(prices, "建议收费（元 / 人）", "suggested_price", "number", { min: "0", step: "1", inputmode: "numeric" });
  const minSize = input(prices, "最低开班人数", "min_size", "number", { min: "1", step: "1", inputmode: "numeric" });
  const deadline = input(prices, "申请截止", "deadline", "date");
  const freeNote = h("p", "muted", "");
  s3.append(
    cxSeg([["paid", "按席位收费"], ["free", "免费"]], "paid", (v) => {
      st.free = v === "free";
      sync();
    }, "收费方式"),
    freeNote,
    prices,
    h("p", "muted", "价格只有机构主管能看到；教务需主管授权。确认席位总数达到最低人数后才能开班。"),
  );
  // 4 课次
  const s4 = step(4, "课次与会议");
  const plan = h("div", "cx-row4");
  const first = input(plan, "首次上课", "first", "datetime-local");
  const repeatWrap = h("label", "field", "重复");
  const repeat = el("select", null, { name: "repeat" });
  for (const [v, t] of [["7", "每周一次"], ["14", "每两周一次"], ["1", "每天一次"]]) repeat.append(el("option", t, { value: v }));
  repeatWrap.append(repeat);
  plan.append(repeatWrap);
  const count = input(plan, "次数", "count", "number", { min: "1", max: "200", step: "1", inputmode: "numeric" });
  const durWrap = h("label", "field", "每次时长");
  const duration = el("select", null, { name: "duration" });
  for (const v of ["30", "45", "60"]) duration.append(el("option", v + " 分钟", { value: v }));
  duration.value = "45";
  durWrap.append(duration);
  plan.append(durWrap);
  repeat.addEventListener("change", preview);
  duration.addEventListener("change", preview);
  const meet = h("div", "cx-row2");
  const meetNo = input(meet, "腾讯会议号（所有课次相同时填这里）", "meeting_no", "text", { maxlength: "100" });
  const meetUrl = input(meet, "入会链接", "meeting_url", "url", { maxlength: "500" });
  const planNote = h("p", "muted", "");
  s4.append(plan, meet, planNote);
  // 5 范围
  const s5 = step(5, "发给谁、何时显示");
  const audOpts = [["all", "全部机构"], ["type", "按机构类型"]];
  if (tenantsList) audOpts.push(["selected", "指定机构"]);
  const typeWrap = h("label", "field", "机构类型");
  const typePick = el("select", null, { name: "audience_type" });
  for (const t of typeOptions) typePick.append(el("option", t, { value: t }));
  typeWrap.append(typePick);
  const pickBox = h("div", "cx-tenant-pick");
  const checks = [];
  if (tenantsList) {
    const search = el("input", null, { type: "search", placeholder: "搜索机构", "aria-label": "搜索机构" });
    const list = h("div", "cx-checks");
    for (const t of tenantsList) {
      const l = h("label", "cx-check");
      const cb = el("input", null, { type: "checkbox", value: t.id });
      cb.addEventListener("change", preview);
      l.append(cb, h("span", "", t.name), h("small", "muted", t.type || ""));
      list.append(l);
      checks.push({ cb, l, name: t.name });
    }
    search.addEventListener("input", () => {
      const q = search.value.trim();
      for (const x of checks) x.l.hidden = !!q && !x.name.includes(q);
    });
    pickBox.append(search, list);
  }
  s5.append(
    cxSeg(audOpts, "all", (v) => {
      st.audience = v;
      sync();
    }, "发送范围"),
    typeWrap,
    pickBox,
  );
  const when = h("div", "cx-row2");
  const from = input(when, "开始显示（不填 = 立即）", "publish_at", "datetime-local");
  const to = input(when, "停止显示（不填 = 不限）", "expire_at", "datetime-local");
  s5.append(when);
  if (!tenantsList) s5.append(h("p", "muted", "主管顾问账号看不到机构名单，可以发给全部机构或按机构类型发送。"));
  // 6 海报
  const s6 = step(6, "配套海报");
  const posterPick = el("input", null, { type: "file", accept: "image/png,image/jpeg", multiple: "", class: "cx-file", id: "cx-poster-file" });
  const posterDrop = el("label", null, { class: "cx-drop", for: "cx-poster-file" });
  posterDrop.append(h("span", "", "拖入或点击选择海报底图（宽 1080 像素，PNG / JPG，可多张）"));
  const editor = h("div", "cx-slot-editor");
  const takePosters = async (files) => {
    const ok = [];
    for (const f of files) {
      if ((await cxWidth(f)) !== 1080) {
        notice(f.name + " 宽度不是 1080 像素，已跳过");
        continue;
      }
      ok.push(f);
    }
    if (!ok.length) return;
    st.posters = ok;
    posterDrop.firstChild.textContent = "已选 " + ok.length + " 张，点击可重新选择";
    posterDrop.classList.add("is-has");
    const ed = await cxSlotEditor(ok[0]);
    st.slots = ed.slots;
    editor.replaceChildren(ed.element);
    preview();
  };
  posterPick.addEventListener("change", () => takePosters([...posterPick.files]));
  cxDropZone(posterDrop, (files) => takePosters(files));
  const posterSide = h("div", "cx-poster-side");
  posterSide.append(posterPick, posterDrop, h("p", "muted", "拖动虚线框，决定机构 Logo、二维码和机构名放在哪里。同一批底图共用一套位置。第一张海报也会用作内容缩略图。"));
  const posterRow = h("div", "cx-poster-row");
  posterRow.append(editor, posterSide);
  s6.append(posterRow);
  const progress = h("p", "muted cx-progress-text", "");
  form.append(progress);

  // 右侧预览
  const pv = h("div", "cx-pv-card");
  const pvNote = h("p", "muted", "");
  aside.append(h("p", "cx-label", "机构看到的样子"), pv, pvNote);
  const sessionsPlan = () => {
    if (!first.value || !count.value) return [];
    const n = Math.min(200, Math.max(1, Number(count.value) || 0)),
      gap = Number(repeat.value) * 86400000,
      start = Date.parse(first.value + ":00+08:00");
    return Array.from({ length: n }, (_, i) => new Date(start + i * gap + 8 * 3600000).toISOString().slice(0, 16));
  };
  function preview() {
    const course = st.kind === "course" || st.kind === "lecture";
    const list = sessionsPlan();
    pv.replaceChildren();
    pv.className = "cx-pv-card cx-pv--" + st.kind;
    const tags = h("div", "cx-pv-tags");
    if (course && st.free) tags.append(h("span", "cx-free", "免费"));
    tags.append(cxChip(st.kind === "lecture" ? "讲座" : st.kind === "course" ? (list.length > 1 ? "线上长期课" : "线上课") : st.kind === "material" ? "招生物料" : "通知", "info"), cxChip("新", "warn"));
    pv.append(tags, h("h3", "", title.value || "（标题）"));
    if (course) {
      if (list.length) pv.append(h("p", "", (list.length > 1 ? (repeat.value === "7" ? "每" + cxWd(list[0]) : repeat.value === "14" ? "隔周" + cxWd(list[0]) : "每天") + " " + cxHm(list[0]) + " · " + list.length + " 课次 · " : "") + cxMd(list[0]) + " 开课"));
      pv.append(h("p", "", st.free ? "费用：免费" : seat.value ? "¥" + seat.value + " / 席" + (sug.value ? " · 建议收费 ¥" + sug.value : "") : "席位价待填"));
      if (deadline.value) pv.append(h("p", "cx-pv-dl", "申请截止 " + deadline.value.slice(5)));
      pv.append(h("span", "cx-pv-btn", "申请名额"));
    } else if (summary.value) pv.append(h("p", "", summary.value));
    if (st.kind === "material" || (st.posters.length && course)) pv.append(h("p", "muted", "海报 " + st.posters.length + " 张，自动合成机构 Logo 和二维码"));
    const target = st.audience === "all" ? "所有机构" : st.audience === "type" ? typePick.value + "类机构" : checks.filter((x) => x.cb.checked).length + " 家机构";
    pvNote.textContent = "发布后" + target + "的“招生”菜单出现“新”标记" + (course ? "，今天页出现“艺界星途推荐”" : "") + "。";
    planNote.textContent = list.length ? "将生成 " + list.length + " 个课次（" + cxMd(list[0]) + " 至 " + list[list.length - 1].slice(5, 10) + "）。会议信息只推给机构员工，学员端不显示；单个课次可在详情里改期。" : "填好首次上课和次数后，这里显示会生成哪些课次。";
  }
  function sync() {
    const course = st.kind === "course" || st.kind === "lecture";
    s2.querySelector("h2").textContent = course ? "课程信息" : st.kind === "material" ? "物料说明" : "通知内容";
    pair.hidden = !course;
    longBox.hidden = !course;
    s3.hidden = s4.hidden = !course;
    s6.hidden = st.kind === "message";
    prices.querySelector('[name="seat_price"]').closest("label").hidden = st.free;
    prices.querySelector('[name="suggested_price"]').closest("label").hidden = st.free;
    freeNote.textContent = st.free ? "选“免费”后，机构卡片和通知上会显示醒目的“免费”标签，不显示席位价和应付金额。" : "";
    typeWrap.hidden = st.audience !== "type";
    pickBox.hidden = st.audience !== "selected";
    // 步骤编号随显示的步骤重排
    let n = 0;
    for (const s of form.querySelectorAll(".cx-step")) if (!s.hidden) s.querySelector(".cx-step-n").textContent = String(++n);
    preview();
  }
  typePick.addEventListener("change", preview);
  sync();

  async function send(mode) {
    const course = st.kind === "course" || st.kind === "lecture";
    const need = (cond, msg, el2) => {
      if (!cond) {
        el2?.focus?.();
        throw Error(msg);
      }
    };
    need(title.value.trim(), "请填写标题", title);
    let publishAt = from.value ? Date.parse(from.value + ":00+08:00") : Date.now();
    if (mode === "schedule") need(from.value && publishAt > Date.now(), "定时发布请先在第 5 步填写将来的“开始显示”时间", from);
    if (mode === "now") publishAt = Math.min(publishAt, Date.now());
    const expire = to.value ? Date.parse(to.value + ":00+08:00") : null;
    if (expire !== null) need(expire > publishAt, "停止显示须晚于开始显示", to);
    const payload = {
      type: course ? "course" : st.kind,
      title: title.value.trim(),
      summary: summary.value.trim(),
      body: (course && grade.value.trim() ? "适合年级：" + grade.value.trim() + "\n" : "") + body.value.trim(),
      audience: st.audience,
      audience_type: st.audience === "type" ? typePick.value : undefined,
      tenant_ids: st.audience === "selected" ? checks.filter((x) => x.cb.checked).map((x) => x.cb.value) : undefined,
      publish_at: publishAt,
      expire_at: expire,
      status: mode === "draft" ? "draft" : "published",
    };
    if (st.audience === "selected") need(payload.tenant_ids.length, "请至少选择 1 家机构");
    if (course) {
      const whole = (v, label, el2, optional) => {
        if (v === "" && optional) return null;
        const n = Number(v);
        need(v !== "" && Number.isInteger(n) && n >= 0, label + "请填整数", el2);
        return n;
      };
      need(lecturer.value.trim(), "请填写主讲", lecturer);
      need(st.long, "请上传课程详情长图（宽 750 像素）", longPick);
      const list = sessionsPlan();
      need(list.length, "请填写首次上课时间和次数", first);
      need(deadline.value, "请填写申请截止日期", deadline);
      const dl = Date.parse(deadline.value + "T23:59:59+08:00");
      need(dl < Date.parse(list[0] + ":00+08:00"), "申请截止须早于第一次上课", deadline);
      Object.assign(payload, {
        format: st.kind === "lecture" ? "lecture" : "course",
        is_free: st.free ? 1 : 0,
        lecturer: lecturer.value.trim(),
        seat_price: st.free ? null : whole(seat.value, "席位价", seat),
        suggested_price: st.free ? null : whole(sug.value, "建议收费", sug, false),
        min_size: whole(minSize.value, "最低开班人数", minSize),
        apply_deadline: dl,
        sessions: list.map((start_at) => ({ start_at, duration: Number(duration.value), meeting_no: meetNo.value.trim(), meeting_url: meetUrl.value.trim() })),
      });
      need(payload.min_size >= 1, "最低开班人数至少 1 人", minSize);
    }
    if (st.kind === "material") need(st.posters.length, "招生物料请至少上传 1 张海报底图", posterPick);
    if (mode !== "draft" && !(await cxAsk(mode === "schedule" ? "定时发布？" : "立即发布？", (mode === "schedule" ? "将在 " + from.value.replace("T", " ") + " 起显示给" : "马上显示给") + (st.audience === "all" ? "全部机构" : st.audience === "type" ? typePick.value + "类机构" : payload.tenant_ids.length + " 家机构") + "。", "发布"))) return;
    for (const b of cxHead.actions.querySelectorAll("button")) b.disabled = true;
    try {
      if (course) payload.detail_image_key = (await promoAdminUpload(st.long.file, "detail", progress)).id;
      const keys = [];
      for (const f of st.posters) keys.push((await promoAdminUpload(f, "poster", progress)).id);
      if (keys.length) payload.cover = keys[0];
      progress.textContent = "正在保存内容…";
      const { id } = await api("promo", "POST", payload);
      let i = 0;
      for (const key of keys) {
        progress.textContent = "正在保存海报 " + ++i + "/" + keys.length;
        await api("promo/" + id + "/posters", "POST", { image_key: key, slots: st.slots() });
      }
      notice(mode === "draft" ? "已存为草稿" : mode === "schedule" ? "已定时发布" : "已发布");
      await cxCourse(c, id);
    } finally {
      for (const b of cxHead.actions.querySelectorAll("button")) b.disabled = false;
      progress.textContent = "";
    }
  }
}
function cxDropZone(zone, take) {
  zone.addEventListener("dragover", (e) => {
    e.preventDefault();
    zone.classList.add("is-over");
  });
  zone.addEventListener("dragleave", () => zone.classList.remove("is-over"));
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    zone.classList.remove("is-over");
    if (e.dataTransfer.files.length) take([...e.dataTransfer.files]);
  });
}
// 海报占位框：底图上拖动 Logo、二维码、机构名三个虚线框。
async function cxSlotEditor(file) {
  const url = URL.createObjectURL(file),
    img = new Image();
  img.src = url;
  await img.decode();
  const W = 1080,
    H = img.naturalHeight;
  const slots = {
    logo: { x: 60, y: Math.max(0, H - 260), width: 160, height: 160 },
    qr: { x: 820, y: Math.max(0, H - 280), width: 200, height: 200 },
    text: { x: 250, y: Math.max(0, H - 200), width: 520, height: 60, font_size: 34, color: "#333333", align: "left" },
  };
  const svg = promoSvg("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": "海报占位框，可拖动" });
  svg.classList.add("cx-slot-svg");
  svg.append(promoSvg("image", { href: url, x: 0, y: 0, width: W, height: H }));
  for (const [key, label] of [["logo", "Logo"], ["qr", "机构二维码"], ["text", "机构名"]]) {
    const g = promoSvg("g", { class: "cx-slot cx-slot--" + key, tabindex: "0", "aria-label": label + "位置，可拖动或用方向键移动" });
    const r = promoSvg("rect", { x: slots[key].x, y: slots[key].y, width: slots[key].width, height: slots[key].height, rx: 12 });
    const t = promoSvg("text", { x: slots[key].x + slots[key].width / 2, y: slots[key].y + slots[key].height / 2 + 12, "text-anchor": "middle" });
    t.textContent = label;
    g.append(r, t);
    const place = (x, y) => {
      const s = slots[key];
      s.x = Math.round(Math.max(0, Math.min(W - s.width, x)));
      s.y = Math.round(Math.max(0, Math.min(H - s.height, y)));
      r.setAttribute("x", s.x);
      r.setAttribute("y", s.y);
      t.setAttribute("x", s.x + s.width / 2);
      t.setAttribute("y", s.y + s.height / 2 + 12);
    };
    let drag = null;
    g.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      g.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, y: e.clientY, ox: slots[key].x, oy: slots[key].y };
      g.classList.add("is-drag");
    });
    g.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const b = svg.getBoundingClientRect(),
        k = W / b.width;
      place(drag.ox + (e.clientX - drag.x) * k, drag.oy + (e.clientY - drag.y) * k);
    });
    const end = () => {
      drag = null;
      g.classList.remove("is-drag");
    };
    g.addEventListener("pointerup", end);
    g.addEventListener("pointercancel", end);
    g.addEventListener("keydown", (e) => {
      const d = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] }[e.key];
      if (!d) return;
      e.preventDefault();
      place(slots[key].x + d[0], slots[key].y + d[1]);
    });
    svg.append(g);
  }
  const box = h("div", "cx-slot-box");
  box.append(svg);
  return { element: box, slots: () => JSON.parse(JSON.stringify(slots)) };
}

// ---------- 4. 控制台账号 ----------
async function cxAccounts(c) {
  const data = await api("platform/accounts?offset=0");
  if (!c.isConnected) return;
  cxTop("控制台账号", [], [cxBtn("＋ 添加顾问", () => cxAddConsultant(c), "primary")]);
  c.replaceChildren();
  const grid = h("div", "cx-grid cx-grid--accounts");
  const left = h("div", "cx-col");
  const p = h("section", "cx-panel cx-panel--flush");
  const t = cxTable([["账号"], ["身份"], ["两步验证"], ["创建时间"], ["状态"], ["", "cx-col-op"]], true);
  const owners = data.items.filter((a) => a.role === "owner" && a.active).length;
  for (const a of data.items) {
    const self = a.username === admin.username;
    let op;
    if (self) op = h("span", "muted", "本人");
    else if (a.role === "owner" && a.active && owners <= 1) op = h("span", "muted", "");
    else
      op = cxBtn(a.active ? "停用" : "启用", async () => {
        if (a.active && !(await cxAsk("停用 " + a.username + "？", "停用后该账号立即退出登录，不能再登录控制台；之后可以重新启用。", "停用", "danger"))) return;
        await api("platform/accounts/" + a.id, "PATCH", { active: !a.active });
        notice(a.active ? "已停用" : "已启用");
        await cxAccounts(c);
      });
    t.row(
      [h("strong", "", a.username), cxChip(a.role === "owner" ? "超级管理员" : "主管顾问", a.role === "owner" ? "info" : "violet"), "已开启", bjt(a.created_at).slice(0, 10), a.active ? cxChip("启用", "ok") : cxChip("已停用", "muted"), op],
      a.active ? "" : "is-dim",
    );
  }
  p.append(t.wrap, h("p", "cx-foot", "每个账号都必须绑定两步验证。操作日志会记录是谁发布内容、确认席位、标记收款。"));
  left.append(p);
  // 平台开关：合作升学推荐（默认关闭）
  const feat = await api("platform/features/referrals").catch(() => null);
  if (feat) {
    const f = cxPanel("功能开关", "平台级设置，只有超级管理员能改");
    const line = h("div", "cx-switch-row");
    const txt = h("div", "cx-stack");
    txt.append(h("strong", "", "合作升学推荐"), h("small", "muted", "打开后机构端“招生”下出现“合作升学”，学员详情里出现推荐入口；关闭时全部隐藏，数据保留。"));
    line.append(
      txt,
      cxSwitch(feat.enabled, "合作升学推荐", async (on) => {
        await api("platform/features/referrals", "PUT", { enabled: on });
        admin = await api("me");
        notice(on ? "已打开合作升学推荐" : "已关闭合作升学推荐");
        shell();
        root.querySelector('.cx-nav [data-key="accounts"]')?.click();
      }),
    );
    f.append(line);
    left.append(f);
  }
  const right = cxPanel("两种身份能做什么");
  const pt = cxTable([["功能"], ["超级管理员", "cx-num"], ["主管顾问", "cx-num"]], true);
  for (const [k, both] of [
    ["发布、编辑、下架推广内容", true],
    ["跟进申请、确认席位、开班、改期", true],
    ["标记机构已收款", true],
    ["看申请机构的名称和联系人", true],
    ["机构名单、合同到期、机构账号", false],
    ["平台公告、安全告警、操作日志", false],
    ["备份恢复、数据导入", false],
    ["添加或停用控制台账号", false],
  ])
    pt.row([k, h("span", "cx-yes", "可以"), both ? h("span", "cx-yes", "可以") : h("span", "cx-no", "不能")]);
  right.append(pt.wrap);
  grid.append(left, right);
  c.append(grid);
}
function cxAddConsultant(c) {
  const { panel, close } = drawer("添加主管顾问");
  const form = el("form");
  let prepared = null;
  const steps = h("ol", "cx-howto");
  for (const s of ["点“生成绑定密钥”，把密钥交给顾问，在手机验证器（如 Google Authenticator、微软 Authenticator）里添加。", "填写顾问的用户名和初始密码。", "让顾问报出验证器上当前的六位动态口令，填进来完成绑定。"]) steps.append(el("li", s));
  form.append(steps);
  const secretText = el("code", "尚未生成", { class: "secret" });
  const copy = cxBtn("复制密钥", async () => {
    if (!prepared) return;
    try {
      await navigator.clipboard.writeText(prepared.secret);
      notice("已复制");
    } catch {
      notice("当前浏览器不允许自动复制，请手动选择密钥复制");
    }
  });
  copy.hidden = true;
  form.append(
    cxBtn("生成绑定密钥", async () => {
      prepared = await api("platform/accounts/prepare", "POST", {});
      secretText.textContent = prepared.secret;
      copy.hidden = false;
    }),
    secretText,
    copy,
  );
  field(form, "用户名", "username").autocomplete = "off";
  field(form, "初始密码（含字母和数字，8–64 位）", "password", "", "password").autocomplete = "new-password";
  const code = field(form, "验证器当前六位动态口令", "totp");
  code.inputMode = "numeric";
  submit(form, "添加顾问", async (d) => {
    if (!prepared) throw Error("请先生成绑定密钥，并在验证器里添加");
    await api("platform/accounts", "POST", { ...d, secret: prepared.secret, until: prepared.until, proof: prepared.proof });
    close();
    notice("已添加主管顾问。顾问登录时用自己的用户名、密码和验证器口令。");
    await cxAccounts(c);
  });
  panel.append(form);
}
