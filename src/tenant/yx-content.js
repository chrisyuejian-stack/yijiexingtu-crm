// 艺界星途 · 招生内容（Claude，接口 v0.3.6 §4.4；界面按设计稿 v3「招生 · 招生内容」「招生内容编辑器 · 公众号」）
// 列表：从场景开始 + 内容表格。编辑器：左“文章 / 品牌与模版”，中间直接显示排版后的文章（点一段即可改），右“内容助手”。
// AI 只给建议：点“填入 / 用这个版本”才写进正文，可以撤销，最后由人保存。

const YXC_TYPES = [["article", "公众号"], ["moments", "朋友圈"], ["xhs", "小红书"], ["poster_text", "海报文字"], ["group_notice", "家长群通知"], ["event_invite", "活动邀请"]];
const YXC_STATUS = { draft: ["草稿", "muted"], ready: ["待发布", "warn"], copied: ["已复制", "ok"], published: ["已发布", "ok"] };
const YXC_BLOCKS = [["paragraph", "段落"], ["heading", "小标题"], ["quote", "导语"], ["image", "图片"], ["list", "分条列表"], ["table", "表格"], ["divider", "分隔线"]];
const YXC_REWRITE = [["polish", "润色"], ["shorten", "缩短"], ["expand", "扩写"], ["warmer", "更亲切"], ["professional", "更专业"], ["list", "改成列表"], ["table", "改成表格"]];
const YXC_FACT = { ok: ["一致", "is-ok"], match: ["一致", "is-ok"], mismatch: ["不一致", "is-bad"], needs_confirm: ["请确认", "is-warn"], missing: ["请确认", "is-warn"] };
// v0.4.0：招生内容 AI 创意优先，服务端只给提醒（flags），不拦截。
const YXC_TONES = [["formal", "严谨"], ["balanced", "平衡"], ["lively", "活泼"], ["playful", "有梗"]];
const YXC_FLAG = { ad_law: ["广告法", "is-bad"], banned: ["禁用词", "is-bad"], fact_mismatch: ["和资料不符", "is-bad"], needs_confirm: ["请确认", "is-warn"], privacy: ["学员隐私", "is-warn"], placeholder: ["待填", "is-warn"] };
const YXC_CREATIVE = ["outline", "section", "versions", "rewrite"];
const YXC_EN = { article: "Article", moments: "Moments", xhs: "Notes", poster_text: "Poster", group_notice: "Notice", event_invite: "Invitation" };
const YXC_ICON = { article: "book", moments: "users", xhs: "edit", poster_text: "eye", group_notice: "bell", event_invite: "calendar" };
// 广告法常见违禁说法（只做提醒，最终以人工审稿为准）
const YXC_BANNED = ["最好", "最佳", "第一", "顶级", "包过", "保过", "保证", "100%", "百分百", "国家级", "唯一", "首选", "万能", "绝对"];
const YXC_MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const yxcListState = { type: "", status: "", author: "" };

// ---------- 列表 ----------
async function yxContentPage(c) {
  const st = yxcListState,
    V = globalThis.ChannelV2;
  const [all, scenes, accounts] = await Promise.all([
    api("content?limit=200"),
    api("content/scenes").catch(() => ({ items: [] })),
    enabled("accounts") ? api("accounts?limit=200").catch(() => ({ items: [] })) : { items: [] },
  ]);
  const people = new Map((accounts.items || []).map((x) => [x.id, x.name]));
  if (me.user?.id) people.set(me.user.id, me.user.name);
  c.replaceChildren();
  c.classList.add("yx-page", "yxv-content");
  // 顶部：说明 + 今日 AI + 新建
  const top = el("div", null, { class: "yxv-top" });
  const intro = el("div");
  intro.append(el("p", "Enrolment Studio", { class: "yx-eyebrow" }), el("p", "公众号、朋友圈、小红书、海报文字、家长群通知。事实只取机构档案和你勾选的资料。", { class: "v-muted" }));
  const right = el("div", null, { class: "yxv-top-right" });
  if (enabled("ai", "use")) right.append(yxvUsageMeter());
  if (enabled("content", "write")) right.append(button("＋ 新建内容", () => yxContentEditor(null, () => yxContentPage(c)), "primary"));
  top.append(intro, right);
  c.append(top);
  // 从场景开始
  const list = (scenes.items || []).filter((x) => x.months?.length || x.subject).slice(0, 4);
  if (list.length && enabled("content", "write")) {
    const h = el("div", null, { class: "yxv-sec-head" });
    h.append(el("h2", "从场景开始"), el("span", "按学科模版的节点和课程库推荐", { class: "v-muted" }));
    const grid = el("div", null, { class: "yxv-scenes" });
    const now = new Date().getMonth() + 1;
    for (const x of list) {
      const card = el("button", null, { type: "button", class: "yxv-scene" });
      const big = el("div", null, { class: "yxv-scene-big" });
      if (x.months?.length) {
        const next = [...x.months].sort((a, b) => ((a - now + 12) % 12) - ((b - now + 12) % 12))[0];
        big.append(el("b", YXC_MONTH[next - 1], { class: "yx-num" }), el("small", next + " 月"));
      } else big.append(el("b", String(x.required?.length || 0), { class: "yx-num" }), el("small", "个必有小节"));
      const body = el("div");
      body.append(el("strong", x.name.split(" / ")[0]), el("p", (x.required || []).join("、") || "按节点安排起草", { class: "v-muted" }), el("span", "开始起草 ›", { class: "yxv-link" }));
      card.append(big, body);
      card.addEventListener("click", () => yxContentEditor(null, () => yxContentPage(c), { scene: x.id, subject: x.subject }));
      grid.append(card);
    }
    c.append(h, grid);
  }
  // 表格
  const items = all.items || [];
  const box = el("div", null, { class: "v-panel yxv-table-box" });
  const bar = el("div", null, { class: "yxv-filter" });
  const tabs = el("div", null, { class: "yxv-seg" });
  for (const [k, t] of [["", "全部"], ...YXC_TYPES]) {
    const n = k ? items.filter((x) => x.type === k).length : items.length;
    const b = el("button", null, { type: "button", "aria-pressed": String(st.type === k) });
    b.append(t + " ", el("span", String(n), { class: "v-muted" }));
    b.addEventListener("click", () => ((st.type = k), yxContentPage(c)));
    tabs.append(b);
  }
  const ss = el("select", null, { "aria-label": "状态" });
  ss.append(el("option", "状态：全部", { value: "" }));
  for (const [k, [t]] of Object.entries(YXC_STATUS)) ss.append(el("option", "状态：" + t, { value: k }));
  ss.value = st.status;
  ss.addEventListener("change", () => ((st.status = ss.value), yxContentPage(c)));
  const au = el("select", null, { "aria-label": "作者" });
  au.append(el("option", "作者：全部", { value: "" }));
  for (const id of [...new Set(items.map((x) => x.author_id))]) au.append(el("option", "作者：" + (people.get(id) || "同事"), { value: id }));
  au.value = st.author;
  au.addEventListener("change", () => ((st.author = au.value), yxContentPage(c)));
  bar.append(tabs, el("span", null, { class: "v-spacer" }), ss, au);
  box.append(bar);
  const rows = items.filter((x) => (!st.type || x.type === st.type) && (!st.status || x.status === st.status) && (!st.author || x.author_id === st.author));
  if (!rows.length) box.append(el("p", items.length ? "没有符合条件的内容。" : "还没有内容。从上面的场景开始，或点“新建内容”。", { class: "v-muted v-pad" }));
  else {
    const t = el("table", null, { class: "yxv-table" });
    const hr = el("tr");
    for (const h of ["标题", "类型", "场景", "状态", "作者", "更新"]) hr.append(el("th", h));
    const tb = el("tbody");
    const sceneName = (id) => (scenes.items || []).find((x) => x.id === id)?.name.split(" / ")[0] || "—";
    for (const d of rows) {
      const tr = el("tr", null, { tabindex: "0" });
      const ti = el("td", null, { class: "yxv-title-cell" });
      const ic = el("span", null, { class: "yxv-ico" });
      ic.append(UI.icon(YXC_ICON[d.type] || "book"));
      ti.append(ic, el("span", d.title || "（未命名）"));
      const s = YXC_STATUS[d.status] || [d.status, "muted"];
      const stc = el("td");
      stc.append(el("span", s[0], { class: "yx-dot is-" + s[1] }));
      tr.append(ti, el("td", yxcTypeName(d.type)), el("td", sceneName(d.scene), { class: "v-muted" }), stc, el("td", people.get(d.author_id) || "同事"), el("td", yxhAgo(d.updated_at), { class: "v-muted" }));
      const open = () => yxContentEditor(d.id, () => yxContentPage(c));
      tr.addEventListener("click", open);
      tr.addEventListener("keydown", (e) => e.key === "Enter" && open());
      tb.append(tr);
    }
    const th = el("thead");
    th.append(hr);
    t.append(th, tb);
    box.append(t);
  }
  c.append(box);
}
// 今日 AI：快速 / 深度两条小进度条（设计稿 v3）
function yxvUsageMeter() {
  const box = el("div", null, { class: "yxv-usage" });
  box.append(el("span", "✦ 今日 AI", { class: "yxv-usage-label" }));
  yxAiUsage().then((u) => {
    if (!u) return box.remove();
    for (const [k, t] of [["fast", "快速"], ["deep", "深度"]]) {
      const g = el("span", null, { class: "yxv-usage-item" });
      const bar = el("span", null, { class: "yxv-usage-bar" }),
        fill = el("span");
      fill.style.setProperty("width", Math.min(100, (u[k].used / Math.max(1, u[k].limit)) * 100) + "%");
      bar.append(fill);
      g.append(t + " ", el("b", String(u[k].used)), el("span", " / " + u[k].limit, { class: "v-muted" }), bar);
      box.append(g);
    }
  });
  return box;
}

// ---------- 编辑器 ----------
async function yxContentEditor(id, onClose, preset) {
  yxDisposeEditors();
  const shell = el("div", null, { class: "yxp-editor yxc-editor yxv-editor ui-root", role: "dialog", "aria-modal": "true", "aria-label": "招生内容" });
  document.body.append(shell);
  shell.append(UI.tableSkeleton());
  const st = { doc: null, dirty: false, scenes: [], courses: [], tags: [], gallery: [], styles: [], results: [], undo: [], subjects: [], sel: null, tab: "article", aiTab: "draft", unsupported: [], flags: [], tone: "balanced", refs: "", len: 1200, savedAt: null };
  shell.yxDispose = () => {
    st.closed = true;
    clearTimeout(st.qTimer);
    st.qSeq = (st.qSeq || 0) + 1;
  };
  const close = async () => {
    if (st.dirty && !(await UI.confirm({ title: "有未保存的修改，确定离开？", consequence: "离开后这些修改会丢失。" }))) return;
    shell.yxDispose?.();
    shell.remove();
    await onClose?.();
  };
  shell.addEventListener("keydown", (e) => yxEditorEscape(e, shell) && close());
  try {
    const subjects = await api("settings/subjects").catch(() => []);
    st.subjects = subjects;
    st.doc = id
      ? await api("content/" + encodeURIComponent(id))
      : { type: "article", subject: preset?.subject || subjects[0]?.key || null, scene: preset?.scene || null, title: "", brief: "", sources: { profile: true, course_ids: [], gallery_tags: [], prices: false }, blocks: [], status: "draft", applied_suggestion_ids: [] };
    if (id) st.savedAt = st.doc.updated_at;
    await yxcLoadRefs(st);
    st.styles = await api("styles?doc_type=article")
      .then((r) => r.items || [])
      .catch(() => []);
  } catch (e) {
    shell.replaceChildren(UI.empty({ text: e.message, action: { label: "关闭", onSelect: close } }));
    return;
  }
  const render = () => shell.isConnected && yxcRender(shell, st, close, render);
  render();
}
async function yxcRun(st, action, extra, label, rerender, fresh) {
  if (!st.doc.id || st.dirty) await yxcSave(st);
  const body = { content_id: st.doc.id, ...extra, ...(st.aiDeep ? { tier: "deep" } : {}) };
  if (YXC_CREATIVE.includes(action)) {
    body.tone = st.tone || "balanced";
    if (st.refs.trim()) body.references = st.refs.trim().slice(0, 8000);
  }
  const res = await yxAi("content/" + action, body, fresh);
  const key = action + JSON.stringify(extra.section_key ?? extra.block_index ?? "");
  st.results = [{ key, action, extra, label, res }, ...st.results.filter((r) => r.key !== key)];
  if (action === "outline" && res.suggestions[0]) st.outline = res.suggestions[0].payload.sections;
  rerender();
}
function yxcAdopt(st, sg, apply, mark, rerender, entry) {
  const doc = st.doc;
  yxcHistCommit(st);
  apply();
  if (entry) st.results = st.results.filter((r) => r !== entry);
  // 记下资料里找不到依据的句子，正文里对应段落下方提示。
  for (const b of sg.basis || []) if (b.type === "unsupported" && b.text && !st.unsupported.includes(b.text)) st.unsupported.push(b.text);
  for (const f of sg.flags || []) if (f.kind !== "ad_law" && f.kind !== "placeholder" && !st.flags.some((x) => x.kind === f.kind && x.quote === f.quote)) st.flags.push(f);
  doc.applied_suggestion_ids = [...new Set([...(doc.applied_suggestion_ids || []), sg.id])];
  mark();
  yxcHistCommit(st);
  rerender();
}
// 大纲里这一节写了没有：有这个小标题，且下面跟着正文。
function yxcSectionDone(doc, title) {
  const i = doc.blocks.findIndex((b) => b.type === "heading" && b.text.trim() === String(title).trim());
  return i >= 0 && !!doc.blocks[i + 1] && doc.blocks[i + 1].type !== "heading";
}
function yxcBanned(doc) {
  const text = doc.title + "\n" + yxcText(doc.blocks);
  return YXC_BANNED.filter((w) => text.includes(w));
}
function yxcRender(shell, st, close, rerender) {
  const V = globalThis.ChannelV2,
    doc = st.doc,
    ro = !enabled("content", "write");
  if (!st.hist) yxcHistInit(st);
  const mark = (fromHist) => {
    st.dirty = true;
    saved.textContent = "有未保存的修改";
    saved.classList.add("is-dirty");
    save.disabled = false;
    if (!fromHist) yxcHistSoon(st, () => yxcHistButtons(st));
    yxcHistButtons(st);
  };
  // ⌘/Ctrl+Z 撤销，⌘/Ctrl+Shift+Z 或 Ctrl+Y 重做（AI 面板输入框里保留浏览器自己的撤销）
  shell.onkeydown = (e) => {
    if (ro || !(e.metaKey || e.ctrlKey)) return;
    const k = e.key.toLowerCase();
    if (k !== "z" && k !== "y") return;
    if (e.target.closest?.("input, textarea, select") ) return;
    e.preventDefault();
    yxcHistGo(st, k === "z" && !e.shiftKey, mark, rerender);
  };
  shell.replaceChildren();
  shell.append(yxvRail(close));
  const main = el("div", null, { class: "yxv-main" });
  shell.append(main);
  // 顶栏：面包屑、类型、保存状态；右侧核对提示和操作
  const bar = el("header", null, { class: "yxp-bar yxv-bar" });
  const crumbs = el("nav", null, { class: "yxv-crumbs", "aria-label": "位置" });
  const back = button("‹ 返回", close);
  back.classList.add("yxv-back");
  crumbs.append(back, V.link("招生", close), el("span", "›", { "aria-hidden": "true" }), V.link("招生内容", close), el("span", "›", { "aria-hidden": "true" }));
  for (const x of [...crumbs.children].slice(1)) x.classList.add("yxv-crumb");
  const title = el("input", null, { type: "text", class: "yxv-title-input", "aria-label": "内容标题", value: doc.title || "", placeholder: "给这篇内容起个名字", maxlength: "80" });
  title.disabled = ro;
  title.addEventListener("input", () => {
    doc.title = title.value;
    mark();
    shell.querySelector(".yxv-art-title")?.replaceChildren(title.value || "标题");
  });
  crumbs.append(title);
  const typeTag = el("span", yxcTypeName(doc.type) + (doc.type === "article" ? "文章" : ""), { class: "yxv-tag" });
  const saved = el("span", st.dirty ? "有未保存的修改" : st.savedAt ? "已保存 " + String(st.savedAt).slice(11, 16) : "还没保存", { class: "yxv-saved" + (st.dirty ? " is-dirty" : "") });
  const save = button("保存", () => yxcSave(st).then(() => ((st.savedAt = st.doc.updated_at), rerender())).catch((e) => notice(e.message)));
  save.disabled = !st.dirty;
  const banned = yxcBanned(doc);
  const checks = el("span", null, { class: "yxv-checks" });
  if (st.unsupported.length) checks.append(el("span", st.unsupported.length + " 处没有依据", { class: "yx-dot is-warn" }));
  const holes = yxcHoles(doc);
  if (holes.length) checks.append(el("span", "待填 " + holes.length + " 处", { class: "yx-dot is-warn", title: holes.join("、") }));
  const live = yxcLiveFlags(st);
  if (live.length) checks.append(el("span", live.length + " 处提醒", { class: "yx-dot is-warn", title: live.map((f) => f.text + "：" + f.quote).join("\n") }));
  const bn = el("span", "广告法用词 " + banned.length + " 处", { class: "yx-dot " + (banned.length ? "is-bad" : "is-ok") });
  if (banned.length) bn.title = "请改掉：" + banned.join("、");
  checks.append(bn);
  const menu =
    doc.id && !ro
      ? UI.actionMenu({
          label: "更多",
          items: [
            ...(doc.status !== "ready" ? [{ label: "标为待发布", onSelect: () => yxcStatus(st, "ready", rerender) }] : []),
            ...(doc.status !== "published" ? [{ label: "标为已发布（只做记录）", onSelect: () => yxcStatus(st, "published", rerender) }] : []),
            ...(doc.status !== "draft" ? [{ label: "改回草稿", onSelect: () => yxcStatus(st, "draft", rerender) }] : []),
            { label: "删除", danger: true, onSelect: () => yxcDelete(st, shell, close) },
          ],
        }).element
      : null;
  const copyText = doc.type === "article" ? "复制到公众号" : "复制全文";
  bar.append(crumbs, typeTag, saved, el("span", null, { class: "v-spacer" }), checks, ...(ro ? [] : [save]), ...(menu ? [menu] : []), button("导出长图", () => yxcLongImage(st).catch((e) => notice(e.message || "长图生成失败"))), button(copyText, () => yxcCopy(st, rerender), "primary"));
  main.append(bar);
  const body = el("div", null, { class: "yxv-body" });
  const left = el("div", null, { class: "yxv-left", role: "region", "aria-label": "文章设置" }),
    mid = el("div", null, { class: "yxv-mid", role: "main", "aria-label": "正文" }),
    right = el("div", null, { class: "yxv-ai", role: "complementary", "aria-label": "内容助手" });
  body.append(left, mid, right);
  main.append(body);
  yxcLeft(left, st, ro, mark, rerender);
  yxcCanvas(mid, st, ro, mark, rerender);
  if (!ro && enabled("ai", "use")) yxcPanel(right, st, mark, rerender);
  else right.append(el("p", ro ? "你的账号只能查看内容。" : "你的账号没有使用 AI 的权限。", { class: "v-muted v-pad" }));
}
// 编辑器左侧窄条：返回各大页面（设计稿 v3 的折叠侧栏）
function yxvRail(close) {
  const rail = el("nav", null, { class: "yxv-rail", "aria-label": "返回" });
  const logo = el("span", (brand?.display_name || "艺").slice(0, 1), { class: "yxv-rail-logo" });
  rail.append(logo);
  for (const [ic, t, hash] of [["home", "今天", "today"], ["calendar", "课表", "schedule-week"], ["user", "学员", "students"], ["link", "招生", "yx-content"], ["wallet", "财务", "finance-income"]]) {
    const b = el("button", null, { type: "button", class: "yxv-rail-btn" + (hash === "yx-content" ? " is-on" : ""), title: t, "aria-label": t });
    b.append(UI.icon(ic));
    b.addEventListener("click", async () => {
      await close();
      if (!document.querySelector(".yxp-editor")) location.hash = hash;
    });
    rail.append(b);
  }
  return rail;
}
function yxcSection(parent, title, extra) {
  const s = el("section", null, { class: "yxv-sec" });
  const h = el("div", null, { class: "yxv-sec-h" });
  h.append(el("h3", title));
  if (extra) h.append(extra);
  s.append(h);
  parent.append(s);
  return s;
}
function yxcLeft(left, st, ro, mark, rerender) {
  const doc = st.doc;
  const tabs = el("div", null, { class: "yxv-seg yxv-seg-full", role: "tablist" });
  for (const [k, t] of [["article", "文章"], ["brand", "品牌与模版"]]) {
    const b = el("button", t, { type: "button", role: "tab", "aria-selected": String(st.tab === k), "aria-pressed": String(st.tab === k) });
    b.addEventListener("click", () => ((st.tab = k), rerender()));
    tabs.append(b);
  }
  left.append(tabs);
  if (st.tab === "brand") {
    const s = yxcSection(left, "机构品牌");
    const row = el("div", null, { class: "yxv-brandrow" });
    const sw = el("span", null, { class: "yxv-swatch" });
    sw.style.setProperty("background", getComputedStyle(document.documentElement).getPropertyValue("--theme") || "#6a35b8");
    row.append(sw, el("span", (brand?.display_name || "") + " · 主色来自品牌包"));
    s.append(row, el("p", "Logo、主色和咨询二维码在“机构设置 · 品牌与图库”里维护，所有文章统一使用。", { class: "v-muted" }));
    s.append(globalThis.ChannelV2.link("去品牌与图库", () => (location.hash = "inst-brand")));
    yxcStyles(yxcSection(left, "风格模版", el("small", "颜色取自品牌包", { class: "v-muted" })), st, ro, mark, rerender);
    return;
  }
  // 风格模版
  yxcStyles(yxcSection(left, "风格模版", el("small", "颜色取自品牌包", { class: "v-muted" })), st, ro, mark, rerender);
  // 选中块
  const s1 = el("section", null, { class: "yxv-sec" });
  const h1 = el("div", null, { class: "yxv-sec-h" });
  const b = st.sel != null ? doc.blocks[st.sel] : null;
  h1.append(el("h3", b ? "选中：" + (YXC_BLOCKS.find((x) => x[0] === b.type)?.[1] || "") : "选中：无"));
  if (b && !ro) {
    const mv = (d) => {
      const j = st.sel + d;
      if (j < 0 || j >= doc.blocks.length) return;
      [doc.blocks[st.sel], doc.blocks[j]] = [doc.blocks[j], doc.blocks[st.sel]];
      st.sel = j;
      mark();
      rerender();
    };
    const del = button("删除", () => {
      doc.blocks.splice(st.sel, 1);
      st.sel = null;
      mark();
      rerender();
    });
    del.classList.add("yxv-danger");
    const ops = el("div", null, { class: "yxv-btnrow" });
    ops.append(button("上移", () => mv(-1)), button("下移", () => mv(1)), del);
    s1.append(h1, ops);
  } else s1.append(h1);
  s1.append(el("p", "点文章里任意一段即可选中。顶部“插入”会加在选中模块下方。", { class: "v-muted" }));
  left.append(s1);
  // 文章开头（v0.3.9 article 字段；旧文章 article 为空时，头图沿用第一张图片）
  if (doc.type !== "article") return;
  const A = yxcArticleView(st);
  const s2 = yxcSection(left, "文章开头");
  const row = (label, input) => {
    const r = el("label", null, { class: "yxv-field" });
    r.append(el("small", label, { class: "v-muted" }), input);
    s2.append(r);
  };
  const txt = (val, ph, set, attrs = {}) => {
    const i = el("input", null, { type: "text", value: val || "", placeholder: ph, maxlength: "20", ...attrs });
    i.disabled = ro;
    i.addEventListener("input", () => (set(i.value), mark(), yxcRefreshMeta(st)));
    return i;
  };
  row("栏目", txt(doc.article?.column, A.columnDefault, (v) => (yxcArt(st).column = v)));
  const hr = el("div", null, { class: "yxv-kv" });
  hr.append(el("small", "头图", { class: "v-muted" }));
  const hb = el("div", null, { class: "yxv-btnrow" });
  if (!ro) {
    hb.append(
      button(A.headerId ? "从图库换" : "从图库选", () =>
        yxcPickImage(st, (imgId) => {
          yxcArt(st).header_image_id = imgId;
          mark();
          rerender();
        }),
      ),
    );
    if (A.headerId)
      hb.append(
        button("去掉", () => {
          yxcArt(st).header_image_id = null;
          mark();
          rerender();
        }),
      );
  }
  hr.append(hb);
  s2.append(hr);
  row("作者", txt(doc.article?.author, brand?.display_name || "机构名", (v) => (yxcArt(st).author = v)));
  const date = el("input", null, { type: "date", value: doc.article?.publish_date || "" });
  date.disabled = ro;
  date.addEventListener("change", () => ((yxcArt(st).publish_date = date.value || null), mark(), yxcRefreshMeta(st)));
  row("日期（空着就用保存日期）", date);
  // 文末
  const s3 = yxcSection(left, "文末附上");
  for (const [k, t, src] of [["qr", "咨询二维码", "品牌与图库"], ["address", "地址与上课时间", "机构档案"]]) {
    const r = el("label", null, { class: "yxv-kv yxv-toggle" });
    const c = el("input", null, { type: "checkbox" });
    c.checked = A.footer[k] !== false;
    c.disabled = ro;
    c.addEventListener("change", () => {
      const a = yxcArt(st);
      a.footer = { ...(a.footer || { qr: true, address: true }), [k]: c.checked };
      mark();
      rerender();
    });
    const tx = el("span");
    tx.append(c, " " + t);
    r.append(tx, el("small", src, { class: "v-muted" }));
    s3.append(r);
  }
  const miss = [];
  if (A.footer.qr !== false && !st.brandInfo?.qr_image_id) miss.push("还没上传咨询二维码");
  if (A.footer.address !== false && !st.profile?.address) miss.push("机构档案里还没填地址");
  s3.append(el("p", miss.length ? miss.join("；") + "。" : "内容在“机构设置”里维护，这里只引用。", { class: miss.length ? "yxv-note-warn" : "v-muted" }));
}
const shellRef = () => document.querySelector(".yxv-editor") || document.body;
// 文章开头显示值：article 有值用 article，没有就用场景、机构名、保存日期；旧文章头图沿用第一张图片。
function yxcArticleView(st) {
  const doc = st.doc,
    a = doc.article;
  const scene = st.scenes.find((x) => x.id === doc.scene);
  const legacyHead = a == null && doc.blocks[0]?.type === "image" ? doc.blocks[0] : null;
  return {
    legacyHead,
    headerId: a == null ? legacyHead?.image_id || null : a.header_image_id || null,
    columnDefault: "招生 · " + (scene ? scene.name.split(" / ")[0] : yxcTypeName(doc.type)),
    column: a?.column || "招生 · " + (scene ? scene.name.split(" / ")[0] : yxcTypeName(doc.type)),
    author: a?.author || brand?.display_name || "",
    date: String(a?.publish_date || doc.updated_at || new Date().toISOString()).slice(0, 10).replaceAll("-", "."),
    footer: a?.footer || { qr: true, address: true },
  };
}
// 第一次改文章开头时建立 article；旧文章的第一张图片转成头图，不再留在正文里。
function yxcArt(st) {
  const doc = st.doc;
  if (doc.article == null) {
    const legacy = doc.blocks[0]?.type === "image" ? doc.blocks[0] : null;
    doc.article = { column: "", header_image_id: legacy?.image_id || null, author: "", publish_date: null, footer: { qr: true, address: true } };
    if (legacy) {
      doc.blocks.shift();
      if (st.sel != null) st.sel = st.sel > 0 ? st.sel - 1 : null;
    }
  }
  return doc.article;
}
function yxcRefreshMeta(st) {
  const A = yxcArticleView(st);
  const m = shellRef().querySelector(".yxv-art-meta");
  if (m) m.textContent = A.author + " · " + A.date;
  const e = shellRef().querySelector(".yxv-art-top .yx-eyebrow");
  if (e && st.doc.type === "article") e.textContent = A.column;
}
function yxcStyles(sec, st, ro, mark, rerender) {
  const doc = st.doc;
  const grid = el("div", null, { class: "yxv-styles" });
  const list = st.styles.length ? st.styles : [{ id: doc.style?.pack_id || "stp_article", name: "简洁文章", version: doc.style?.pack_version, manifest: null }];
  for (const s of list) {
    const on = (doc.style?.pack_id || "stp_article") === s.id;
    const b = el("button", null, { type: "button", class: "yxv-style" + (on ? " is-on" : ""), "aria-pressed": String(on) });
    const sw = el("span", null, { class: "yxv-style-sw" });
    const col = s.manifest?.tokens?.color || {};
    for (const k of ["paper", "ink", "primary"]) {
      const i = el("i");
      i.style.setProperty("background", col[k] || "#ddd");
      sw.append(i);
    }
    b.append(sw, el("span", s.name));
    b.disabled = ro;
    b.addEventListener("click", () => {
      if (on) return;
      doc.style = { pack_id: s.id, pack_version: s.version };
      mark();
      rerender();
    });
    grid.append(b);
  }
  sec.append(grid);
  if (st.styles.length < 2) sec.append(el("p", "平台上架新的文章风格后会出现在这里；已写好的文章锁定当时的版本。", { class: "v-muted" }));
}
// ---------- 中间：排版后的文章，点一段即可改 ----------
function yxcCanvas(mid, st, ro, mark, rerender) {
  const doc = st.doc;
  // 顶部工具条：插入 / 修改（撤销、重做）/ 文字格式（参照枫琴公众号编辑器）
  if (!ro) {
    const tb = el("div", null, { class: "yxv-insert yxv-toolbar", role: "toolbar", "aria-label": "编辑工具" });
    const grp = (name) => {
      const g = el("div", null, { class: "yxv-tgrp" });
      g.append(el("span", name, { class: "yxv-tlabel" }));
      tb.append(g);
      return g;
    };
    const ins = grp("插入");
    for (const [k, t] of YXC_BLOCKS) {
      const b = el("button", t, { type: "button" });
      b.addEventListener("click", () => {
        const add = (blk) => {
          const at = st.sel == null ? doc.blocks.length : st.sel + 1;
          doc.blocks.splice(at, 0, blk);
          st.sel = at;
          mark();
          yxcHistCommit(st);
          rerender();
        };
        if (k === "image") return yxcPickImage(st, (imgId) => add({ type: "image", image_id: imgId, caption: "" }));
        add(k === "heading" ? { type: k, text: "小标题", level: 2 } : k === "list" ? { type: k, items: ["第一条"], ordered: false } : k === "table" ? { type: k, rows: [["项目", "说明"], ["", ""]] } : k === "divider" ? { type: k } : { type: k, text: "" });
      });
      ins.append(b);
    }
    const edit = grp("修改");
    const un = el("button", "↶ 撤销", { type: "button", class: "yxv-hist", "data-h": "undo", title: "撤销（⌘/Ctrl+Z）" }),
      re = el("button", "↷ 重做", { type: "button", class: "yxv-hist", "data-h": "redo", title: "重做（⌘/Ctrl+Shift+Z）" });
    un.addEventListener("click", () => yxcHistGo(st, true, mark, rerender));
    re.addEventListener("click", () => yxcHistGo(st, false, mark, rerender));
    edit.append(un, re);
    const fmt = grp("文字");
    for (const [k, t, cls] of [["b", "B", "is-b"], ["i", "斜体", "is-i"], ["hl", "高亮", "is-hl"], ["em", "强调色", "is-em"], ["clear", "清除", ""]]) {
      const b = el("button", t, { type: "button", class: "yxv-fmt " + cls, title: { b: "加粗", i: "斜体", hl: "荧光笔高亮", em: "品牌色强调", clear: "清除选中文字的格式" }[k] });
      // mousedown 不抢焦点，保住选区
      b.addEventListener("mousedown", (e) => e.preventDefault());
      b.addEventListener("click", () => (yxcHistCommit(st), yxInlineApply(k), yxcHistCommit(st), yxcHistButtons(st)));
      fmt.append(b);
    }
    mid.append(tb);
    setTimeout(() => yxcHistButtons(st), 0);
  }
  const stage = el("div", null, { class: "yxv-stage" });
  const art = el("article", null, { class: "yxv-art is-" + doc.type });
  const col = st.styles.find((s) => s.id === (doc.style?.pack_id || "stp_article"))?.manifest?.tokens?.color;
  const primary = (col?.use_tenant_primary !== false && getComputedStyle(document.documentElement).getPropertyValue("--theme").trim()) || col?.primary;
  if (primary) art.style.setProperty("--yxv-primary", primary);
  const AV = yxcArticleView(st);
  const head = doc.type === "article" ? AV.legacyHead : null;
  if (doc.type === "article" && AV.headerId) {
    const f = el("figure", null, { class: "yxv-art-head" });
    f.append(el("img", null, { src: yxcMedia(AV.headerId), alt: "头图" }), el("figcaption", "头图 · 在左边“文章开头”里换"));
    art.append(f);
  }
  const top = el("div", null, { class: "yxv-art-top" });
  top.append(el("p", doc.type === "article" ? AV.column : (YXC_EN[doc.type] || "Article") + " · " + new Date().getFullYear(), { class: "yx-eyebrow" }), el("h1", doc.title || "标题", { class: "yxv-art-title" }), el("p", doc.type === "article" ? AV.author + " · " + AV.date : (brand?.display_name || "") + " · " + String(doc.updated_at || new Date().toISOString()).slice(0, 10).replaceAll("-", "."), { class: "yxv-art-meta" }), el("hr"));
  art.append(top);
  if (!doc.blocks.length || (doc.blocks.length === 1 && head)) art.append(el("p", "右边“内容助手”选好场景和资料，点“生成大纲”或“生成 3 个版本”；也可以用上面的“插入”直接写。", { class: "v-muted yxv-empty" }));
  let n = 0;
  doc.blocks.forEach((b, i) => {
    if (i === 0 && head) return;
    const wrap = el("div", null, { class: "yxv-blk is-" + b.type + (st.sel === i ? " is-sel" : ""), "data-index": String(i) });
    wrap.addEventListener("click", (e) => {
      if (st.sel === i) return;
      st.sel = i;
      rerender();
      setTimeout(() => {
        const blk = shell()?.querySelector('.yxv-blk[data-index="' + i + '"]');
        blk?.scrollIntoView({ block: "center", behavior: "smooth" });
        blk?.querySelector("[contenteditable]")?.focus({ preventScroll: true });
      }, 0);
    });
    const shell = () => document.querySelector(".yxv-editor");
    // plain=true：标题等只存纯文字（v0.5 约定：标题不带行内格式）
    const editable = (tag, text, on, cls, single, plain) => {
      const x = plain ? el(tag, text, { class: cls || "" }) : yxInlineFill(el(tag, null, { class: cls || "" }), text);
      if (!ro && st.sel === i) {
        x.setAttribute("contenteditable", "true");
        x.setAttribute("spellcheck", "false");
        x.addEventListener("input", () => (on(plain ? x.textContent.replace(/\n/g, " ") : single ? yxInlineSerialize(x).replace(/\n/g, " ") : yxInlineSerialize(x)), mark()));
        x.addEventListener("keydown", (e) => {
          if (e.key !== "Enter" || e.isComposing) return;
          e.preventDefault();
          if (!single) document.execCommand("insertLineBreak");
        });
        // 粘贴只取纯文字，不带外部网页的样式
        x.addEventListener("paste", (e) => {
          e.preventDefault();
          const t = e.clipboardData?.getData("text/plain") || "";
          document.execCommand("insertText", false, single ? t.replace(/\s*\n\s*/g, " ") : t);
        });
      }
      return x;
    };
    if (b.type === "heading") {
      if (b.level !== 3) n++;
      const h = el("div", null, { class: "yxv-h" });
      if (b.level !== 3) h.append(el("span", String(n).padStart(2, "0"), { class: "yx-num" }));
      h.append(editable("h2", b.text, (v) => (b.text = v), "", true, true), el("i"));
      wrap.append(h);
    } else if (b.type === "paragraph") wrap.append(editable("p", b.text, (v) => (b.text = v)));
    else if (b.type === "quote") wrap.append(editable("blockquote", b.text, (v) => (b.text = v)));
    else if (b.type === "list") {
      const ul = el(b.ordered ? "ol" : "ul");
      for (const it of b.items) ul.append(yxInlineFill(el("li"), it));
      wrap.append(ul);
      if (st.sel === i && !ro) {
        const t = yxcArea(b.items.join("\n"), "分条列表，每行一条", (v) => {
          b.items = v.split("\n");
          ul.replaceChildren();
          for (const item of b.items) ul.append(yxInlineFill(el("li"), item));
          mark();
        }, false, 3);
        t.classList.add("yxv-inline-edit");
        t.addEventListener("click", (e) => e.stopPropagation());
        wrap.append(t);
      }
    } else if (b.type === "table") {
      const t = el("table");
      b.rows.forEach((r, k) => {
        const tr = el("tr");
        for (const cell of r) tr.append(yxInlineFill(el(k ? "td" : "th"), cell));
        t.append(tr);
      });
      wrap.append(t);
      if (st.sel === i && !ro) {
        const ta = yxcArea(b.rows.map((r) => r.join(" | ")).join("\n"), "表格：每行一排，用 | 分隔", (v) => {
          const rows = v.split("\n").map((r) => r.split("|").map((x) => x.trim()));
          const w = Math.max(...rows.map((r) => r.length));
          b.rows = rows.map((r) => [...r, ...Array(w - r.length).fill("")]);
          t.replaceChildren();
          b.rows.forEach((row, k) => {
            const tr = el("tr");
            for (const cell of row) tr.append(yxInlineFill(el(k ? "td" : "th"), cell));
            t.append(tr);
          });
          mark();
        }, false, 3);
        ta.classList.add("yxv-inline-edit");
        ta.addEventListener("click", (e) => e.stopPropagation());
        wrap.append(ta);
      }
    } else if (b.type === "image") {
      const f = el("figure");
      f.append(el("img", null, { src: yxcMedia(b.image_id), alt: b.caption || "配图", loading: "lazy" }));
      f.append(editable("figcaption", b.caption || "", (v) => (b.caption = v), "", true));
      wrap.append(f);
    } else if (b.type === "divider") wrap.append(el("hr"));
    if (st.sel === i && !ro) {
      const bar = el("div", null, { class: "yxv-blkbar", role: "group", "aria-label": "这一块" });
      const act = (t, label, fn, cls) => {
        const x = el("button", t, { type: "button", title: label, "aria-label": label, class: cls || "" });
        x.addEventListener("click", (e) => {
          e.stopPropagation();
          yxcHistCommit(st);
          fn();
          mark();
          yxcHistCommit(st);
          rerender();
        });
        bar.append(x);
      };
      const mv = (d) => {
        const j = i + d;
        if (j < 0 || j >= doc.blocks.length || (j === 0 && head)) return;
        [doc.blocks[i], doc.blocks[j]] = [doc.blocks[j], doc.blocks[i]];
        st.sel = j;
      };
      act("↑", "上移", () => mv(-1));
      act("↓", "下移", () => mv(1));
      act("⧉", "复制一份", () => (doc.blocks.splice(i + 1, 0, yxClone(b)), (st.sel = i + 1)));
      act("✕", "删除", () => {
        doc.blocks.splice(i, 1);
        st.sel = null;
        notice("已删除，可以按“撤销”恢复");
      }, "is-del");
      wrap.append(bar);
    }
    art.append(wrap);
    // 资料里找不到依据的句子：段落下方提示
    const txt = yxcText([b]);
    const holes = txt.match(/【待填[：:][^】\n]{1,200}】/gu) || [];
    const fl = st.flags.filter((f) => f.quote && txt.includes(f.quote));
    if (holes.length || fl.length) {
      const w = el("div", null, { class: "yxv-flagnote" });
      for (const h of holes) w.append(el("span", h.replace(/^【待填[：:]|】$/g, ""), { class: "yxv-flag is-warn", title: "待填写" }));
      for (const f of fl) {
        const [t, tone] = YXC_FLAG[f.kind] || [f.kind, "is-warn"];
        const chip = el("span", t + "：" + f.quote.slice(0, 30), { class: "yxv-flag " + tone, title: f.text });
        w.append(chip);
      }
      if (fl.length) {
        const x = el("button", "知道了", { type: "button" });
        x.addEventListener("click", (e) => {
          e.stopPropagation();
          st.flags = st.flags.filter((f) => !fl.includes(f));
          rerender();
        });
        w.append(x);
      }
      art.append(w);
    }
    const miss = st.unsupported.filter((q) => q && txt.includes(q));
    if (miss.length) {
      const w = el("div", null, { class: "yxv-miss" });
      const t = el("div");
      t.append(el("strong", miss.length + " 处在资料里找不到依据"), el("span", "：" + miss.map((q) => "“" + q + "”").join("、") + "。请补进机构档案，或改掉这几句。"));
      const x = el("button", "知道了", { type: "button" });
      x.addEventListener("click", (e) => {
        e.stopPropagation();
        st.unsupported = st.unsupported.filter((y) => !miss.includes(y));
        rerender();
      });
      w.append(t, x);
      art.append(w);
    }
  });
  if (doc.type === "article") {
    const foot = el("div", null, { class: "yxv-art-foot" });
    const ft = AV.footer;
    if (ft.address !== false && st.profile?.address) {
      const p = el("div", null, { class: "yxv-foot-addr" });
      p.append(el("p", "地址：" + st.profile.address));
      if (st.profile.class_hours) p.append(el("p", "上课时间：" + st.profile.class_hours));
      foot.append(p);
    }
    if (ft.qr !== false && st.brandInfo?.qr_image_id) {
      const q = el("figure", null, { class: "yxv-foot-qr" });
      q.append(el("img", null, { src: yxcMedia(st.brandInfo.qr_image_id), alt: "咨询二维码" }), el("figcaption", "扫码咨询"));
      foot.append(q);
    }
    if (!foot.childElementCount) foot.append(el("small", "文末没有附加内容"));
    art.append(foot);
  }
  stage.append(art);
  mid.append(stage);
}
// ---------- 右侧：内容助手 ----------
function yxcPanel(right, st, mark, rerender) {
  const V = globalThis.ChannelV2,
    doc = st.doc;
  const head = el("div", null, { class: "yxv-ai-head" });
  const logo = el("span", "✦", { class: "yxv-ai-logo", "aria-hidden": "true" });
  const t = el("div");
  t.append(el("strong", "内容助手"), el("small", "艺界星途 AI", { class: "v-muted" }));
  const tier = el("div", null, { class: "yxv-tier", role: "group", "aria-label": "AI 模式" });
  for (const [k, n] of [[false, "快速"], [true, "深度"]]) {
    const b = el("button", n, { type: "button", "aria-pressed": String(!!st.aiDeep === k) });
    b.addEventListener("click", () => ((st.aiDeep = k), rerender()));
    tier.append(b);
  }
  head.append(logo, t, el("span", null, { class: "v-spacer" }), tier);
  right.append(head);
  const tabs = el("div", null, { class: "yxv-seg yxv-seg-full yxv-ai-tabs", role: "tablist" });
  for (const [k, n] of [["draft", "起草"], ["rewrite", "改写"], ["check", "资料核对"], ["images", "配图"]]) {
    const b = el("button", n, { type: "button", role: "tab", "aria-selected": String(st.aiTab === k), "aria-pressed": String(st.aiTab === k) });
    b.addEventListener("click", () => ((st.aiTab = k), rerender()));
    tabs.append(b);
  }
  right.append(tabs);
  const body = el("div", null, { class: "yxv-ai-body" });
  right.append(body);
  if (st.aiTab === "draft") yxcDraftTab(body, st, mark, rerender);
  else if (st.aiTab === "rewrite") yxcRewriteTab(body, st, mark, rerender);
  else if (st.aiTab === "check") yxcCheckTab(body, st, mark, rerender);
  else yxcImageTab(body, st, mark, rerender);
  // 底部：一句话调整、生成下一节、撤销
  const foot = el("div", null, { class: "yxv-ai-foot" });
  const selB = st.sel != null ? doc.blocks[st.sel] : null,
    selText = selB && ["paragraph", "heading", "quote", "list", "table"].includes(selB.type);
  const ask = el("input", null, { type: "text", placeholder: selText ? "只改选中的这段，比如：更口语一点，加一句报名方式" : doc.type === "article" ? "一句话调整，比如：加一节老师介绍" : "一句话调整，比如：语气活泼一点，提到小班", "aria-label": "一句话调整", maxlength: "300" });
  const adj = el("div", null, { class: "yxv-row" });
  adj.append(
    ask,
    yxAiButton("发送", async () => {
      const v = ask.value.trim();
      if (!v) return notice("先写一句要怎么调整");
      // 选中了一段文字：只改这一段（v0.4.1 规则）；没选中才是整篇动作。
      if (selText) st.aiTab = "rewrite";
      if (selText) return yxcRun(st, "rewrite", { block_index: st.sel, mode: "custom", text: yxcText([selB], true), instruction: v }, "按要求改 · 第 " + (st.sel + 1) + " 段", rerender, true);
      const last = st.results[0] && !["fact-check", "images"].includes(st.results[0].action) ? st.results[0] : { action: doc.type === "article" ? "outline" : "versions", extra: {}, label: doc.type === "article" ? "大纲" : "3 个版本" };
      await yxcRun(st, last.action, { ...last.extra, instruction: v }, last.label + " · 按要求调整", rerender, true);
    }),
  );
  foot.append(adj);
  const row = el("div", null, { class: "yxv-row" });
  const rest = doc.type === "article" ? (st.outline || []).filter((s) => !yxcSectionDone(doc, s.title)) : [];
  if (rest.length) {
    row.append(yxAiButton("生成下一节", () => yxcRun(st, "section", { section_key: rest[0].key }, "「" + rest[0].title + "」", rerender), "primary"));
    if (rest.length > 1)
      row.append(
        yxAiButton("剩余 " + rest.length + " 节一起生成", async () => {
          for (const s of rest) await yxcRun(st, "section", { section_key: s.key }, "「" + s.title + "」", rerender);
        }),
      );
  }
  foot.append(row);
  right.append(foot);
}
// 语气四档 + 参考素材（用户粘贴的网页文字、链接、往期稿件；服务端不抓取链接）。
function yxcToneBox(body, st, rerender) {
  body.append(el("small", "语气", { class: "yxv-label" }));
  const g = el("div", null, { class: "yxv-chips", role: "radiogroup", "aria-label": "语气" });
  for (const [k, t] of YXC_TONES) {
    const b = el("button", t, { type: "button", role: "radio", "aria-checked": String(st.tone === k), "aria-pressed": String(st.tone === k) });
    b.addEventListener("click", () => ((st.tone = k), rerender()));
    g.append(b);
  }
  body.append(g);
  const l = el("label", null, { class: "yxv-refs" });
  const ta = el("textarea", null, { rows: "3", maxlength: "8000", placeholder: "可粘贴热点新闻、网页文字、往期爆款文案或链接，AI 会参考它的信息和写法（不会自动打开链接）" });
  ta.value = st.refs;
  const n = el("small", st.refs.length ? st.refs.length + " / 8000" : "", { class: "v-muted" });
  ta.addEventListener("input", () => ((st.refs = ta.value), (n.textContent = ta.value.length ? ta.value.length + " / 8000" : "")));
  l.append(el("small", "参考素材（可选）", { class: "yxv-label" }), ta, n);
  body.append(l);
}
function yxcHoles(doc) {
  return [...new Set((doc.title + "\n" + yxcText(doc.blocks)).match(/【待填[：:][^】\n]{1,200}】/gu) || [])];
}
function yxcLiveFlags(st) {
  const text = st.doc.title + "\n" + yxcText(st.doc.blocks);
  return st.flags.filter((f) => f.quote && text.includes(f.quote));
}
function yxcSourceBox(body, st, mark) {
  const doc = st.doc,
    src = doc.sources;
  body.append(el("small", "参考资料 · 价格、日期、老师等具体事实只从勾选的资料里取", { class: "yxv-label" }));
  const grid = el("div", null, { class: "yxv-sources" });
  const add = (label, on, set) => {
    const l = el("label", null, { class: "yxv-src" });
    const c = el("input", null, { type: "checkbox" });
    c.checked = on;
    c.addEventListener("change", () => (set(c.checked), mark()));
    l.append(c, el("span", label));
    grid.append(l);
  };
  add("机构档案", src.profile, (v) => (src.profile = v));
  const scene = st.scenes.find((x) => x.id === doc.scene);
  const suggest = new Set(scene?.course_ids || []);
  const courses = [...st.courses].sort((a, b) => suggest.has(b.id) - suggest.has(a.id)).slice(0, 4);
  for (const x of courses) add("报价课程 · " + x.name, src.course_ids.includes(x.id), (v) => (src.course_ids = v ? [...src.course_ids, x.id] : src.course_ids.filter((y) => y !== x.id)));
  for (const tg of st.tags.slice(0, 4)) add("图库 · " + tg, src.gallery_tags.includes(tg), (v) => (src.gallery_tags = v ? [...src.gallery_tags, tg] : src.gallery_tags.filter((y) => y !== tg)));
  add("价目表（默认不写）", src.prices, (v) => (src.prices = v));
  body.append(grid);
}
function yxcDraftTab(body, st, mark, rerender) {
  const doc = st.doc;
  // 类型
  body.append(el("small", "写什么", { class: "yxv-label" }));
  const types = el("div", null, { class: "yxv-chips" });
  for (const [k, t] of YXC_TYPES) {
    const b = el("button", t, { type: "button", "aria-pressed": String(doc.type === k) });
    b.addEventListener("click", () => {
      if (doc.type === k) return;
      doc.type = k;
      st.results = [];
      mark();
      rerender();
    });
    types.append(b);
  }
  body.append(types);
  // 场景
  const seen = new Set();
  const scenes = st.scenes.filter((x) => (!x.subject || x.subject === doc.subject) && (x.id === doc.scene || !seen.has(x.name.split(" / ")[0])) && seen.add(x.name.split(" / ")[0]));
  if (scenes.length) {
    body.append(el("small", "内容场景 · 必有小节来自学科模版", { class: "yxv-label" }));
    const sc = el("div", null, { class: "yxv-chips" });
    for (const x of scenes) {
      const b = el("button", x.name.split(" / ")[0], { type: "button", "aria-pressed": String(doc.scene === x.id) });
      b.addEventListener("click", () => ((doc.scene = doc.scene === x.id ? null : x.id), mark(), rerender()));
      sc.append(b);
    }
    body.append(sc);
  }
  // 重点 + 长度
  const row = el("div", null, { class: "yxv-brief" });
  const l1 = el("label");
  const brief = el("input", null, { type: "text", value: doc.brief || "", maxlength: "500", placeholder: "如：1 月 20 日开营，6 人小班，结营汇报演出" });
  brief.addEventListener("input", () => ((doc.brief = brief.value), mark()));
  l1.append(el("small", "这篇想讲的重点（一句话）", { class: "yxv-label" }), brief);
  const l2 = el("label");
  const len = el("input", null, { type: "number", min: "50", step: "50", value: String(st.len) });
  len.addEventListener("input", () => (st.len = Number(len.value) || 0));
  l2.append(el("small", "长度（字）", { class: "yxv-label" }), len);
  row.append(l1, l2);
  body.append(row);
  yxcToneBox(body, st, rerender);
  yxcSourceBox(body, st, mark);
  const lenNote = () => (st.len ? { instruction: "全文约 " + st.len + " 字" } : {});
  if (doc.type === "article") {
    const card = el("div", null, { class: "yxv-outline" });
    const oh = el("div", null, { class: "yxv-sec-h" });
    const req = (st.outline || []).filter((s) => s.required).length;
    oh.append(el("strong", st.outline ? "大纲 · " + st.outline.length + " 节" : "大纲"), el("small", st.outline ? "必有 " + req + " 节 · 可选 " + (st.outline.length - req) + " 节" : "先生成大纲，再逐节写", { class: "v-muted" }), el("span", null, { class: "v-spacer" }), yxAiButton(st.outline ? "重新生成大纲" : "生成大纲", () => yxcRun(st, "outline", lenNote(), "大纲", rerender, !!st.outline)));
    card.append(oh);
    (st.outline || []).forEach((s, i) => {
      const r = el("div", null, { class: "yxv-out-row" });
      const done = yxcSectionDone(doc, s.title);
      const name = el("span");
      name.append(el("span", String(i + 1), { class: "v-muted" }), " " + s.title + " ", el("span", s.required ? "必有" : "可选", { class: "yxv-tag " + (s.required ? "is-ai" : "") }));
      r.append(name, done ? el("span", "已写", { class: "yx-dot is-ok" }) : yxAiButton("生成", () => yxcRun(st, "section", { section_key: s.key }, "「" + s.title + "」", rerender)));
      card.append(r);
      if (/优惠|价格|费用/.test(s.title) && !doc.sources.prices) card.append(el("small", "价目表没勾选，这一节不会写金额", { class: "yxv-note-warn" }));
    });
    body.append(card);
  } else body.append(yxAiButton("生成 3 个版本", () => yxcRun(st, "versions", lenNote(), "3 个版本", rerender), "primary"));
  yxcResults(body, st, mark, rerender, ["outline", "section", "versions"]);
}
function yxcRewriteTab(body, st, mark, rerender) {
  const doc = st.doc,
    i = st.sel,
    b = i != null ? doc.blocks[i] : null;
  if (!b || !["paragraph", "heading", "quote", "list", "table"].includes(b.type)) {
    body.append(el("p", "先在中间点选一段文字，再选怎么改。", { class: "v-muted" }));
  } else {
    body.append(el("small", "选中的这段", { class: "yxv-label" }), el("p", yxcText([b]).slice(0, 120), { class: "yxv-quote" }));
    const g = el("div", null, { class: "yxv-chips" });
    for (const [m, t] of YXC_REWRITE) g.append(yxAiButton(t, () => yxcRun(st, "rewrite", { block_index: i, mode: m, text: yxcText([b], true) }, t + " · 第 " + (i + 1) + " 段", rerender)));
    body.append(g);
  }
  yxcResults(body, st, mark, rerender, ["rewrite"]);
}
function yxcCheckTab(body, st, mark, rerender) {
  body.append(el("p", "对照机构档案、勾选的课程和价目表，标出价格、日期、成绩等需要确认的地方。只是提醒，不影响保存和复制，也不能代替人工审稿。", { class: "v-muted" }));
  body.append(yxAiButton("开始核对", () => yxcRun(st, "fact-check", {}, "资料核对", rerender, true), "primary"));
  const banned = yxcBanned(st.doc);
  if (banned.length) body.append(el("p", "广告法用词：" + banned.join("、") + "。请改成具体、可核实的说法。", { class: "yxv-note-warn" }));
  yxcResults(body, st, mark, rerender, ["fact-check"]);
}
function yxcImageTab(body, st, mark, rerender) {
  if (!st.doc.sources.gallery_tags.length) body.append(el("p", "先在“起草”里勾选图库标签，AI 只从这些图里选。", { class: "v-muted" }));
  else body.append(yxAiButton("推荐配图", () => yxcRun(st, "images", {}, "配图", rerender, true), "primary"));
  yxcResults(body, st, mark, rerender, ["images"]);
}
function yxcFlagList(flags) {
  const w = el("div", null, { class: "yxv-flagnote", role: "note", "aria-label": "发布前提醒" });
  const seen = new Set();
  for (const f of flags) {
    const [t, tone] = YXC_FLAG[f.kind] || [f.kind, "is-warn"];
    const key = f.kind + f.quote;
    if (seen.has(key)) continue;
    seen.add(key);
    w.append(el("span", t + "：" + String(f.quote).slice(0, 30), { class: "yxv-flag " + tone, title: f.text }));
  }
  return w;
}
// AI 建议卡片（设计稿 v3：文字 + 依据 + 填入 / 换个说法 / 不要）
function yxcResults(body, st, mark, rerender, actions) {
  const doc = st.doc;
  for (const entry of st.results.filter((r) => actions.includes(r.action))) {
    const { res, action, extra, label } = entry;
    const box = el("div", null, { class: "yxv-result" });
    const h = el("div", null, { class: "yxv-sec-h" });
    h.append(el("strong", label));
    box.append(h);
    const w = yxAiWarnings(res.warnings);
    if (w) box.append(w);
    if (!res.suggestions.length) box.append(el("p", "这次没有可用的建议。换个说法或多勾选一些资料再试。", { class: "v-muted" }));
    const drop = () => ((st.results = st.results.filter((r) => r !== entry)), rerender());
    const again = () => yxcRun(st, action, extra, label, rerender, true).catch((e) => notice(e.message));
    const acts = (fill, fillText = "填入") => {
      const r = el("div", null, { class: "yxv-row" });
      r.append(button(fillText, fill, "primary"), yxAiButton("换个说法", again), button("不要", drop));
      r.firstChild.classList.add("yxai-btn");
      return r;
    };
    // 招生内容是创意写作：不再展示“参考/依据”这类内部信息（v0.4.1 界面原则）。
    const basisLine = () => el("span");
    const basisLineOld = (sg) => {
      const ok = (sg.basis || []).filter((b) => b.type !== "unsupported" && (b.quote || b.text));
      const miss = (sg.basis || []).filter((b) => b.type === "unsupported").length;
      const p = el("p", null, { class: "yxv-basis" });
      if (!ok.length && !miss) return el("span");
      p.append("参考：" + ok.map((b) => b.quote || b.text).slice(0, 3).join("；"));
      if (miss) p.append(el("span", " · " + miss + " 处在资料里找不到依据", { class: "yxv-miss-n" }));
      return p;
    };
    for (const sg of res.suggestions) {
      const p = sg.payload;
      const card = el("div", null, { class: "yxv-sug" });
      if (sg.kind === "content.versions") {
        for (const [k, t] of [["short", "短"], ["medium", "中"], ["long", "长"]]) {
          const v = p.versions?.[k];
          if (!v) continue;
          const c = el("div", null, { class: "yxv-ver" });
          c.append(el("strong", t + " · " + v.replace(/\s/g, "").length + " 字"), el("p", v, { class: "yxc-pre" }), acts(() => yxcAdopt(st, sg, () => ((doc.blocks = [...(doc.blocks[0]?.type === "image" ? [doc.blocks[0]] : []), ...yxcParas(v)]), (st.sel = null)), mark, rerender, entry), "用这个版本"));
          card.append(c);
        }
        card.append(basisLine(sg));
      } else if (sg.kind === "content.outline") {
        const ol = el("ol", null, { class: "yxc-outline" });
        for (const s of p.sections || []) ol.append(el("li", s.title + (s.required ? "" : "（可选）")));
        card.append(ol, basisLine(sg));
        card.append(
          acts(() =>
            yxcAdopt(st, sg, () => {
              st.outline = p.sections;
              for (const s of p.sections || []) if (!doc.blocks.some((b) => b.type === "heading" && b.text === s.title)) doc.blocks.push({ type: "heading", text: s.title, level: 2 });
            }, mark, rerender, entry), "插入小标题"),
        );
      } else if (sg.kind === "content.section" || sg.kind === "content.rewrite") {
        for (const bl of p.blocks || []) card.append(el("p", yxcText([bl]), { class: "yxc-pre" }));
        card.append(basisLine(sg));
        if (sg.kind === "content.section") {
          const sec = (st.outline || []).find((s) => s.key === p.section_key);
          card.append(acts(() => yxcAdopt(st, sg, () => yxcInsertSection(doc, sec?.title || p.section_key, p.blocks), mark, rerender, entry)));
        } else {
          const i = sg.target.block_index;
          card.append(acts(() => yxcAdopt(st, sg, () => doc.blocks.splice(i, 1, ...p.blocks), mark, rerender, entry)));
        }
      } else if (sg.kind === "content.fact_check") {
        const ul = el("ul", null, { class: "yxc-facts" });
        for (const it of p.items || []) {
          const [t, tone] = YXC_FACT[it.result] || [it.result, ""];
          const li = el("li");
          li.append(el("span", t, { class: "yx-dot " + tone }), el("span", "“" + it.quote + "”"));
          if (it.expected) li.append(el("small", "资料里是：" + it.expected, { class: "v-muted" }));
          if (Number.isInteger(it.block_index)) li.append(globalThis.ChannelV2.link("定位", () => ((st.sel = it.block_index), rerender())));
          ul.append(li);
        }
        if (!p.items?.length) card.append(el("p", "没有发现需要核对的事实。", { class: "v-muted" }));
        card.append(ul);
      } else if (sg.kind === "content.images") {
        for (const it of p.items || []) {
          const sec = (st.outline || []).find((s) => s.key === it.section_key);
          const row = el("div", null, { class: "yxc-imgs" });
          for (const id of it.image_ids) row.append(el("img", null, { src: yxcMedia(id), alt: it.reason || "推荐配图", loading: "lazy" }));
          card.append(el("strong", sec?.title || "配图"), row);
          if (it.reason) card.append(el("small", it.reason, { class: "v-muted" }));
          card.append(
            acts(() =>
              yxcAdopt(st, sg, () => {
                const imgs = it.image_ids.map((id) => ({ type: "image", image_id: id, caption: "" }));
                if (sec) yxcInsertSection(doc, sec.title, imgs);
                else doc.blocks.push(...imgs);
              }, mark, rerender, entry), "插入"),
          );
        }
      }
      if (sg.flags?.length) card.append(yxcFlagList(sg.flags));
      const sw = yxAiWarnings(sg.warnings);
      if (sw) card.append(sw);
      box.append(card);
    }
    body.append(box);
  }
}

// ---------- 通用小工具 ----------
function yxcTypeName(t) {
  return (YXC_TYPES.find((x) => x[0] === t) || [t, t])[1];
}

function yxcMedia(id) {
  return base + "api/gallery/" + encodeURIComponent(id) + "/file";
}
// 复制用的纯文本。

// raw=true 保留行内格式标记（发给 AI 改写）；默认给纯文字（检查、计数、复制兜底）。
function yxcText(blocks, raw) {
  const T = raw ? (x) => String(x ?? "") : yxInlinePlain;
  return blocks
    .map((b) => {
      if (b.type === "list") return b.items.map((x, i) => (b.ordered ? i + 1 + ". " : "• ") + T(x)).join("\n");
      if (b.type === "table") return b.rows.map((r) => r.map(T).join(" | ")).join("\n");
      if (b.type === "quote") return "「" + T(b.text) + "」";
      if (b.type === "divider") return "———";
      if (b.type === "image") return "";
      return T(b.text || "");
    })
    .filter(Boolean)
    .join("\n\n");
}

function yxcCount(blocks) {
  return yxcText(blocks).replace(/\s/g, "").length;
}
// 保存前去掉 AI 临时字段（basis），只留冻结的块字段。

function yxcClean(blocks) {
  const keep = { heading: ["text", "level"], paragraph: ["text"], list: ["items", "ordered"], table: ["rows"], quote: ["text"], image: ["image_id", "caption"], divider: [] };
  return blocks.map((b) => Object.fromEntries([["type", b.type], ...(keep[b.type] || []).map((k) => [k, b[k]])]));
}

function yxcParas(text) {
  return String(text || "")
    .split(/\n\s*\n/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => ({ type: "paragraph", text: t }));
}

async function yxcLoadRefs(st) {
  const sub = st.doc.subject;
  const [scenes, courses, gallery] = await Promise.all([
    api("content/scenes" + (sub ? "?subject=" + sub : "")).catch(() => ({ items: [] })),
    api("settings/courses?limit=200" + (sub ? "&subject=" + sub : "")).catch(() => ({ items: [] })),
    api("gallery?limit=200").catch(() => ({ items: [] })),
    api("settings/profile").catch(() => null),
    api("settings/brand").catch(() => null),
  ]).then((r) => ((st.profile = r[3]), (st.brandInfo = r[4]), r));
  st.scenes = scenes.items || [];
  st.courses = (courses.items || []).filter((x) => x.active);
  st.gallery = gallery.items || [];
  st.tags = [...new Set(st.gallery.flatMap((g) => g.tags || []))];
}

async function yxcSave(st) {
  const d = st.doc;
  // 标题不能为空：没填时用“类型 · 场景”。
  if (!String(d.title || "").trim()) d.title = yxcTypeName(d.type) + (st.scenes.find((x) => x.id === d.scene) ? " · " + st.scenes.find((x) => x.id === d.scene).name : "") + " · " + new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" }).slice(5);
  const body = { text_format: "inline_v1", type: d.type, subject: d.subject, scene: d.scene, title: d.title, brief: d.brief, sources: d.sources, blocks: yxcClean(d.blocks), applied_suggestion_ids: d.applied_suggestion_ids || [], ...(d.style ? { style: d.style } : {}), ...(d.type === "article" && d.article !== undefined ? { article: d.article } : {}) };
  try {
    st.doc = d.id ? await api("content/" + encodeURIComponent(d.id), "PUT", { ...body, version: d.version }) : await api("content", "POST", body);
    st.dirty = false;
    if (st.hist) st.hist.cur = yxcSnap(st);
    notice("已保存", "success");
  } catch (e) {
    if (e.code !== "version_conflict") throw e;
    if (await UI.confirm({ title: "内容已被别人修改", consequence: "要载入最新内容吗？你这次的修改会丢失。" })) {
      st.doc = e.details?.latest || (await api("content/" + encodeURIComponent(d.id)));
      st.dirty = false;
    }
    throw Error("没有保存");
  }
}

async function yxcStatus(st, status, rerender) {
  if (st.dirty) await yxcSave(st);
  st.doc = await api("content/" + encodeURIComponent(st.doc.id) + "/status", "POST", { version: st.doc.version, status });
  rerender();
}

async function yxcDelete(st, shell, close) {
  if (!(await UI.confirm({ title: "删除这篇内容？", consequence: "删除后在列表里看不到，修改记录仍保留。" }))) return;
  await api("content/" + encodeURIComponent(st.doc.id), "DELETE", { version: st.doc.version });
  st.dirty = false;
  await close();
}

async function yxcCopyText(text, html) {
  try {
    if (html && globalThis.ClipboardItem) await navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }), "text/plain": new Blob([text], { type: "text/plain" }) })]);
    else await navigator.clipboard.writeText(text);
  } catch {
    const t = el("textarea", null, { class: "yxc-offscreen", "aria-hidden": "true" });
    t.value = text;
    document.body.append(t);
    t.select();
    document.execCommand("copy");
    t.remove();
  }
  notice("已复制，可以粘贴到公众号、朋友圈或微信群", "success");
}

async function yxcCopy(st, rerender) {
  if (!st.doc.blocks.length) return notice("正文还是空的");
  let text = yxcText(st.doc.blocks);
  const isArt = st.doc.type === "article";
  const ft = isArt ? yxcArticleView(st).footer : {};
  if (isArt && ft.address !== false && st.profile?.address) text += "\n\n地址：" + st.profile.address + (st.profile.class_hours ? "\n上课时间：" + st.profile.class_hours : "");
  await yxcCopyText(text, isArt ? yxcWxHtml(st, ft) : null);
  // 二维码是图片，不能随文字复制：提醒在公众号里插入。
  if (isArt && ft.qr !== false && st.brandInfo?.qr_image_id) notice("已复制正文和地址。咨询二维码请在公众号编辑器里插入图片（可在“机构设置 › 品牌与图库”下载）。", "success");
  // 记一下“已复制”，方便在列表里看哪些发过。
  if (st.doc.id && !st.dirty && (st.doc.status === "draft" || st.doc.status === "ready") && enabled("content", "write")) {
    st.doc = await api("content/" + encodeURIComponent(st.doc.id) + "/status", "POST", { version: st.doc.version, status: "copied" }).catch(() => st.doc);
    rerender();
  }
}

function yxcArea(value, label, on, ro, rows = 3) {
  const t = el("textarea", null, { rows: String(rows), "aria-label": label });
  t.value = value;
  t.disabled = ro;
  const fit = () => {
    t.style.setProperty("height", "auto");
    t.style.setProperty("height", t.scrollHeight + 2 + "px");
  };
  t.addEventListener("input", () => (on(t.value), fit()));
  requestAnimationFrame(fit);
  return t;
}

function yxcPickImage(st, done) {
  if (!st.gallery.length) return notice("图库里还没有图片，先到“机构设置 → 图库”上传");
  const view = UI.drawer({ title: "选一张图库图片" });
  const grid = el("div", null, { class: "yxs-gallery" });
  for (const g of st.gallery) {
    const b = el("button", null, { type: "button", class: "yxc-pick" });
    b.append(el("img", null, { src: g.url, alt: (g.tags || []).join("、") || "图库图片", loading: "lazy" }));
    b.addEventListener("click", () => {
      view.close?.();
      done(g.id);
    });
    grid.append(b);
  }
  view.body.append(grid);
}

function yxcInsertSection(doc, title, blocks) {
  // AI 写一节时常把小标题也带上；大纲已经插过小标题，开头重复的去掉。
  const norm = (x) => String(x || "").replace(/[\s\p{P}\p{S}0-9一二三四五六七八九十、]/gu, "");
  const t = norm(title);
  blocks = [...blocks];
  while (blocks[0]?.type === "heading" && t && (norm(blocks[0].text) === t || norm(blocks[0].text).includes(t) || t.includes(norm(blocks[0].text)))) blocks.shift();
  const at = doc.blocks.findIndex((b) => b.type === "heading" && b.text.trim() === String(title).trim());
  if (at < 0) return doc.blocks.push({ type: "heading", text: title, level: 2 }, ...blocks);
  let end = at + 1;
  while (end < doc.blocks.length && doc.blocks[end].type !== "heading") end++;
  doc.blocks.splice(end, 0, ...blocks);
}

// ---------- 导出长图（v0.4.1）----------
// 以前用浏览器打印，被方案打印的样式整页隐藏，导出的是空白。现在直接把文章块画到 canvas，下载 PNG。
// 文件名按类型：公众号文章-标题 / 朋友圈长图-标题 / 小红书-标题 …
const YXC_EXPORT_NAME = { article: "公众号文章", moments: "朋友圈长图", xhs: "小红书", poster_text: "海报文字", group_notice: "家长群通知", event_invite: "活动邀请" };
async function yxcLongImage(st) {
  const doc = st.doc,
    AV = doc.type === "article" ? yxcArticleView(st) : null;
  const W = 1080, P = 80, IW = W - P * 2;
  const css = getComputedStyle(document.documentElement);
  const primary = css.getPropertyValue("--theme").trim() || "#16a394";
  const ink = "#231c30", sub = "#6b6478", line = "#ece7f2";
  const SANS = '"PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif', SERIF = '"Noto Serif SC","Songti SC",serif';
  const media = (id) => base + "api/gallery/" + encodeURIComponent(id) + "/file";
  const load = (src) =>
    new Promise((ok) => {
      const im = new Image();
      im.onload = () => ok(im);
      im.onerror = () => ok(null);
      im.src = src;
    });
  const cv = document.createElement("canvas"),
    g = cv.getContext("2d");
  const wrap = (text, font, width) => {
    g.font = font;
    const out = [];
    for (const para of String(text || "").split("\n")) {
      let cur = "";
      for (const ch of para) {
        if (g.measureText(cur + ch).width > width && cur) {
          out.push(cur);
          cur = ch;
        } else cur += ch;
      }
      out.push(cur);
    }
    return out;
  };
  // 先排版（记录绘制指令和高度），再一次性画。
  const ops = [];
  let y = P;
  // 行内格式：按字符排版，每段带自己的字重/斜体/颜色/高亮底
  const runFont = (font, m) => (m === "b" || m === "em" ? font.replace(/^(italic )?(\d+ )?/, (x, it) => (it || "") + "700 ") : m === "i" ? "italic " + font.replace(/^italic /, "") : font);
  const text = (t, font, color, size, lh, x = P, width = IW) => {
    const toks = yxInlineParse(t);
    let line = [],
      w = 0;
    const out = () => {
      let cx = x;
      for (const r of line) {
        g.font = r.f;
        const rw = g.measureText(r.t).width;
        if (r.m === "hl") ops.push({ k: "r", x: cx, y: y + size * 0.55, w: rw, h: size * 0.5, c: "rgba(246,165,74,.42)" });
        ops.push({ k: "t", t: r.t, font: r.f, color: r.m === "em" ? primary : color, x: cx, y: y + size });
        cx += rw;
      }
      y += size * lh;
      line = [];
      w = 0;
    };
    for (const tk of toks) {
      if (tk.t === "\n" && !tk.m) {
        out();
        continue;
      }
      const f = runFont(font, tk.m);
      g.font = f;
      for (const ch of tk.t) {
        const cw = g.measureText(ch).width;
        if (w + cw > width && w > 0) out();
        const last = line[line.length - 1];
        if (last && last.f === f && last.m === tk.m) last.t += ch;
        else line.push({ t: ch, f, m: tk.m });
        w += cw;
      }
    }
    out();
  };
  const imgs = {};
  const want = [];
  if (AV?.headerId) want.push(AV.headerId);
  for (const b of doc.blocks) if (b.type === "image" && b.image_id) want.push(b.image_id);
  const qrId = doc.type === "article" && AV.footer.qr !== false ? st.brandInfo?.qr_image_id : null;
  if (qrId) want.push(qrId);
  await Promise.all([...new Set(want)].map(async (id) => (imgs[id] = await load(media(id)))));
  const headImg = AV?.headerId ? imgs[AV.headerId] : null;
  if (headImg) {
    const h = Math.round((W * headImg.height) / headImg.width);
    ops.push({ k: "i", im: headImg, x: 0, y: 0, w: W, h: Math.min(h, 720), cover: true });
    y = Math.min(h, 720) + 56;
  }
  text(AV ? AV.column : (YXC_EN[doc.type] || "") + " · " + new Date().getFullYear(), "italic 26px " + SERIF, primary, 26, 1.6);
  y += 8;
  text(yxInlineEsc(doc.title || "标题"), "700 52px " + SERIF, ink, 52, 1.4);
  y += 6;
  text(AV ? AV.author + " · " + AV.date : brand?.display_name || "", "24px " + SANS, sub, 24, 1.6);
  y += 16;
  ops.push({ k: "r", x: P, y, w: 64, h: 6, c: primary });
  y += 50;
  const body = "30px " + SANS;
  doc.blocks.forEach((b, i) => {
    if (i === 0 && AV?.legacyHead) return;
    if (b.type === "heading") {
      y += 24;
      const top = y;
      text(b.text, "700 " + (b.level === 3 ? 32 : 38) + "px " + SANS, ink, b.level === 3 ? 32 : 38, 1.5, P + 22, IW - 22);
      ops.push({ k: "r", x: P, y: top + 6, w: 8, h: y - top - 14, c: primary });
      y += 14;
    } else if (b.type === "paragraph") {
      text(b.text, body, ink, 30, 1.8);
      y += 26;
    } else if (b.type === "quote") {
      const top = y;
      y += 26;
      const at = ops.length;
      text(b.text, "30px " + SERIF, ink, 30, 1.8, P + 36, IW - 64);
      y += 18;
      ops.splice(at, 0, { k: "r", x: P, y: top, w: IW, h: y - top, c: "#f6f3fa" }, { k: "r", x: P, y: top, w: 6, h: y - top, c: primary });
      y += 30;
    } else if (b.type === "list") {
      (b.items || []).forEach((it, n) => {
        ops.push({ k: "t", t: b.ordered ? n + 1 + "." : "•", font: "700 30px " + SANS, color: primary, x: P + 4, y: y + 30 });
        text(it, body, ink, 30, 1.8, P + 46, IW - 46);
        y += 8;
      });
      y += 20;
    } else if (b.type === "table") {
      const rows = b.rows || [],
        cols = Math.max(1, ...rows.map((r) => r.length)),
        cw = IW / cols;
      rows.forEach((r, ri) => {
        const font = (ri === 0 ? "700 " : "") + "26px " + SANS;
        const cells = Array.from({ length: cols }, (_, c) => wrap(r[c] || "", font, cw - 28));
        const h = Math.max(...cells.map((x) => x.length)) * 26 * 1.6 + 28;
        ops.push({ k: "r", x: P, y, w: IW, h, c: ri === 0 ? "#f3f0f7" : "#fff" }, { k: "r", x: P, y: y + h - 2, w: IW, h: 2, c: line });
        cells.forEach((ls, c) => ls.forEach((ln, li) => ops.push({ k: "t", t: ln, font, color: ink, x: P + c * cw + 14, y: y + 14 + 26 + li * 26 * 1.6 })));
        y += h;
      });
      y += 34;
    } else if (b.type === "image") {
      const im = imgs[b.image_id];
      if (im) {
        const h = Math.round((IW * im.height) / im.width);
        ops.push({ k: "i", im, x: P, y, w: IW, h });
        y += h + 14;
      }
      if (b.caption) text(b.caption, "24px " + SANS, sub, 24, 1.6);
      y += 26;
    } else if (b.type === "divider") {
      y += 14;
      ops.push({ k: "r", x: P + IW / 2 - 60, y, w: 120, h: 3, c: line });
      y += 40;
    }
  });
  // 文末：地址 / 上课时间 / 二维码（公众号文章按“文末附上”的勾选）
  const addr = doc.type === "article" && AV.footer.address !== false ? st.profile?.address : null;
  if (addr || imgs[qrId]) {
    y += 20;
    ops.push({ k: "r", x: P, y, w: IW, h: 2, c: line });
    y += 40;
    if (imgs[qrId]) {
      ops.push({ k: "i", im: imgs[qrId], x: P + IW / 2 - 110, y, w: 220, h: 220 });
      y += 236;
      text("扫码咨询", "24px " + SANS, sub, 24, 1.6, P + IW / 2 - 48, 200);
    }
    if (addr) text("地址：" + addr + (st.profile?.class_hours ? "\n上课时间：" + st.profile.class_hours : ""), "26px " + SANS, sub, 26, 1.7);
  }
  y += 30;
  text(brand?.display_name || "", "600 24px " + SANS, sub, 24, 1.6);
  y += P - 20;
  const scale = y > 32000 ? 32000 / y : 1;
  cv.width = W * scale;
  cv.height = Math.ceil(y * scale);
  g.scale(scale, scale);
  g.fillStyle = "#fff";
  g.fillRect(0, 0, W, y);
  for (const o of ops) {
    if (o.k === "r") {
      g.fillStyle = o.c;
      g.fillRect(o.x, o.y, o.w, o.h);
    } else if (o.k === "i") {
      try {
        if (o.cover) {
          const r = Math.min(o.im.width / o.w, o.im.height / o.h),
            sw = o.w * r,
            sh = o.h * r;
          g.drawImage(o.im, (o.im.width - sw) / 2, (o.im.height - sh) / 2, sw, sh, o.x, o.y, o.w, o.h);
        } else g.drawImage(o.im, o.x, o.y, o.w, o.h);
      } catch {}
    } else {
      g.font = o.font;
      g.fillStyle = o.color;
      g.fillText(o.t, o.x, o.y);
    }
  }
  const blob = await new Promise((ok) => cv.toBlob(ok, "image/png"));
  if (!blob) return notice("长图生成失败，请稍后再试");
  const url = URL.createObjectURL(blob);
  const a = el("a", null, { href: url, download: yxExportName(YXC_EXPORT_NAME[doc.type] || "招生内容", doc.title) + ".png" });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ---------- 行内格式 inline_v1（v0.5 §10）----------
// 存储：**加粗** *斜体* ==高亮== [[品牌色强调]]；\* \= \[ \] \\ 转义。同段成对、不嵌套、不跨行。
// 显示：解析成 <b>/<i>/<mark>/<span class="yx-em">，只用 DOM 节点和 textContent，不拼 HTML 进页面。
const YXI_TAG = { b: "b", i: "i", hl: "mark", em: "span" };
function yxInlineParse(s) {
  s = String(s ?? "");
  const out = [];
  const marks = [["**", "**", "b"], ["==", "==", "hl"], ["[[", "]]", "em"], ["*", "*", "i"]];
  for (const line of s.split("\n")) {
    if (out.length) out.push({ t: "\n", m: null });
    let i = 0,
      buf = "",
      ok = true;
    const seg = [];
    const flush = () => buf && (seg.push({ t: buf, m: null }), (buf = ""));
    while (i < line.length) {
      const c = line[i];
      if (c === "\\" && "*=[]\\".includes(line[i + 1] ?? "~")) {
        buf += line[i + 1];
        i += 2;
        continue;
      }
      const mk = marks.find(([o]) => line.startsWith(o, i));
      if (!mk) {
        buf += c;
        i++;
        continue;
      }
      // 找配对的结束标记（中间不能再出现开始标记，不嵌套）
      let j = i + mk[0].length,
        inner = "",
        closed = false;
      while (j < line.length) {
        if (line[j] === "\\" && "*=[]\\".includes(line[j + 1] ?? "~")) {
          inner += line[j + 1];
          j += 2;
          continue;
        }
        if (line.startsWith(mk[1], j) && !(mk[2] === "i" && line.startsWith("**", j))) {
          closed = true;
          break;
        }
        if (marks.some(([o]) => line.startsWith(o, j))) break;
        inner += line[j];
        j++;
      }
      if (!closed || !inner.trim()) {
        ok = false;
        break;
      }
      flush();
      seg.push({ t: inner, m: mk[2] });
      i = j + mk[1].length;
    }
    if (!ok) {
      // 整段降为纯文字（与后端规则一致）
      out.push({ t: line.replace(/\\([*=[\]\\])/g, "\u0000$1").replace(/\*\*|\*|==|\[\[|\]\]/g, "").replace(/\u0000/g, ""), m: null });
      continue;
    }
    flush();
    out.push(...seg);
  }
  return out;
}
function yxInlinePlain(s) {
  return yxInlineParse(s)
    .map((x) => x.t)
    .join("");
}
function yxInlineEsc(t) {
  return String(t).replace(/([*=[\]\\])/g, "\\$1");
}
function yxInlineFill(node, s) {
  node.replaceChildren();
  for (const x of yxInlineParse(s)) {
    if (x.t === "\n" && !x.m) node.append(document.createElement("br"));
    else if (!x.m) node.append(x.t);
    else {
      const e = document.createElement(YXI_TAG[x.m]);
      if (x.m === "em") e.className = "yx-em";
      e.textContent = x.t;
      node.append(e);
    }
  }
  return node;
}
// 可编辑区 DOM → 存储文字。只认识 b/strong、i/em、mark、.yx-em，其余一律取纯文字。
function yxInlineSerialize(root) {
  let out = "";
  const kind = (n) => (/^(B|STRONG)$/.test(n.tagName) ? "b" : /^(I|EM)$/.test(n.tagName) ? "i" : n.tagName === "MARK" ? "hl" : n.classList?.contains("yx-em") ? "em" : null);
  const wrap = { b: ["**", "**"], i: ["*", "*"], hl: ["==", "=="], em: ["[[", "]]"] };
  const plain = (n) => (n.nodeType === 3 ? n.data : n.nodeName === "BR" ? "\n" : [...n.childNodes].map(plain).join(""));
  const walk = (n, inMark) => {
    for (const c of n.childNodes) {
      if (c.nodeType === 3) out += yxInlineEsc(c.data);
      else if (c.nodeName === "BR") out += "\n";
      else if (c.nodeType === 1) {
        const k = inMark ? null : kind(c);
        const block = /^(DIV|P)$/.test(c.nodeName);
        if (block && out && !out.endsWith("\n")) out += "\n";
        if (k) {
          const t = plain(c).replace(/\n/g, "");
          if (t.trim()) out += wrap[k][0] + yxInlineEsc(t) + wrap[k][1];
          else out += yxInlineEsc(t);
        } else walk(c, inMark);
      }
    }
  };
  walk(root, false);
  return out.replace(/ /g, " ").replace(/\n$/, "");
}
// 把选中的文字包成某种格式（同一段内）。
function yxInlineApply(kind) {
  const sel = getSelection();
  if (!sel.rangeCount || sel.isCollapsed) return notice("先选中要设置的文字");
  const r = sel.getRangeAt(0);
  const host = (r.commonAncestorContainer.nodeType === 1 ? r.commonAncestorContainer : r.commonAncestorContainer.parentElement)?.closest("[contenteditable]");
  if (!host) return notice("先选中正文里的文字");
  if (/^H[1-6]$/.test(host.tagName)) return notice("小标题不加格式");
  const text = r.toString().replace(/\n/g, "");
  if (!text) return;
  r.deleteContents();
  let node;
  if (kind === "clear") node = document.createTextNode(text);
  else {
    node = document.createElement(YXI_TAG[kind]);
    if (kind === "em") node.className = "yx-em";
    node.textContent = text;
  }
  r.insertNode(node);
  // 去掉被拆出来的空格式壳，避免嵌套
  for (const e of host.querySelectorAll("b,strong,i,em,mark,span.yx-em")) {
    if (!e.textContent) e.remove();
    else if (e !== node && e.contains(node)) {
      // 嵌套：把外层拆开，保持“不嵌套”
      const frag = document.createDocumentFragment();
      const before = document.createRange();
      before.setStartBefore(e.firstChild);
      before.setEndBefore(node);
      const after = document.createRange();
      after.setStartAfter(node);
      after.setEndAfter(e.lastChild);
      const mk = (rg) => {
        const t = rg.toString();
        if (!t) return null;
        const x = e.cloneNode(false);
        x.textContent = t;
        return x;
      };
      const a = mk(before),
        z = mk(after);
      if (a) frag.append(a);
      frag.append(node);
      if (z) frag.append(z);
      e.replaceWith(frag);
    }
  }
  sel.removeAllRanges();
  const nr = document.createRange();
  nr.selectNodeContents(node);
  sel.addRange(nr);
  host.dispatchEvent(new Event("input", { bubbles: true }));
}

// ---------- 撤销 / 重做（v0.5 §9）：整篇快照，打字停 1 秒算一步，最多 50 步 ----------
function yxcSnap(st) {
  const d = st.doc;
  return JSON.stringify({ title: d.title, blocks: d.blocks, applied: d.applied_suggestion_ids || [], article: d.article ?? null, style: d.style ?? null });
}
function yxcHistInit(st) {
  st.hist = { past: [], future: [], cur: yxcSnap(st), timer: 0 };
}
function yxcHistCommit(st) {
  const h = st.hist;
  if (!h) return;
  clearTimeout(h.timer);
  h.timer = 0;
  const now = yxcSnap(st);
  if (now === h.cur) return;
  h.past.push(h.cur);
  if (h.past.length > 50) h.past.shift();
  h.cur = now;
  h.future = [];
}
function yxcHistSoon(st, onDone) {
  const h = st.hist;
  if (!h) return;
  clearTimeout(h.timer);
  h.timer = setTimeout(() => (yxcHistCommit(st), onDone?.()), 1000);
}
function yxcHistGo(st, back, mark, rerender) {
  yxcHistCommit(st);
  const h = st.hist;
  const from = back ? h.past : h.future,
    to = back ? h.future : h.past;
  if (!from.length) return notice(back ? "没有可以撤销的修改了" : "没有可以重做的修改了");
  to.push(h.cur);
  h.cur = from.pop();
  const s = JSON.parse(h.cur);
  Object.assign(st.doc, { title: s.title, blocks: s.blocks, applied_suggestion_ids: s.applied });
  if (s.article !== null) st.doc.article = s.article;
  if (s.style !== null) st.doc.style = s.style;
  if (st.sel != null && st.sel >= st.doc.blocks.length) st.sel = null;
  mark(true);
  rerender();
}

function yxcHistButtons(st) {
  const h = st.hist;
  for (const b of document.querySelectorAll(".yxv-editor .yxv-hist")) b.disabled = b.dataset.h === "undo" ? !(h?.past.length || (h && yxcSnap(st) !== h.cur)) : !h?.future.length;
}

// 复制到公众号：用白名单行内样式拼 HTML 字符串（用户文字全部转义），只写进剪贴板，不插入本页 DOM。
function yxcWxHtml(st, ft) {
  const P = getComputedStyle(document.documentElement).getPropertyValue("--theme").trim() || "#16a394";
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const tag = (n, css, inner) => "<" + n + (css ? " " + "style" + '="' + css + '"' : "") + ">" + inner + "</" + n + ">";
  const inl = (t) =>
    yxInlineParse(t)
      .map((x) => (x.t === "\n" && !x.m ? "<br>" : x.m === "b" ? tag("strong", "", esc(x.t)) : x.m === "i" ? tag("em", "", esc(x.t)) : x.m === "hl" ? tag("span", "background:linear-gradient(transparent 58%,rgba(246,165,74,.42) 0)", esc(x.t)) : x.m === "em" ? tag("span", "color:" + P + ";font-weight:600", esc(x.t)) : esc(x.t)))
      .join("");
  const PS = "margin:0 0 1.2em;font-size:16px;line-height:1.9;color:#2b2535;letter-spacing:.5px";
  const NOTE = "margin:0 0 1.2em;text-align:center;font-size:13px;color:#8a8398";
  const parts = [];
  for (const b of st.doc.blocks) {
    if (b.type === "heading") parts.push(tag("h2", "margin:1.8em 0 .8em;padding-left:10px;border-left:4px solid " + P + ";font-size:" + (b.level === 3 ? 17 : 19) + "px;font-weight:700;color:#231c30;line-height:1.5", inl(b.text)));
    else if (b.type === "paragraph") parts.push(tag("p", PS, inl(b.text)));
    else if (b.type === "quote") parts.push(tag("blockquote", "margin:0 0 1.2em;padding:12px 16px;background:#f6f3fa;border-left:3px solid " + P + ";font-size:15px;line-height:1.85;color:#3a3348", inl(b.text)));
    else if (b.type === "list") parts.push(tag(b.ordered ? "ol" : "ul", "margin:0 0 1.2em;padding-left:1.4em;font-size:16px;line-height:1.9;color:#2b2535", b.items.map((x) => tag("li", "", inl(x))).join("")));
    else if (b.type === "table") parts.push(tag("table", "width:100%;border-collapse:collapse;margin:0 0 1.2em;font-size:14px;line-height:1.7", b.rows.map((r, k) => tag("tr", "", r.map((c) => tag(k ? "td" : "th", "border:1px solid #e5e0ec;padding:6px 8px;text-align:left;vertical-align:top" + (k ? "" : ";background:#f3f0f7;font-weight:700"), inl(c))).join(""))).join("")));
    else if (b.type === "divider") parts.push(tag("p", "text-align:center;margin:1.6em 0;color:#c9c1d6", "— — —"));
    else if (b.type === "image") parts.push(tag("p", NOTE, "【在此插入图片】" + (b.caption ? inl(b.caption) : "")));
  }
  if (ft.address !== false && st.profile?.address) parts.push(tag("p", PS + ";font-size:14px;color:#6b6478", "地址：" + esc(st.profile.address) + (st.profile.class_hours ? "<br>上课时间：" + esc(st.profile.class_hours) : "")));
  return "<section>" + parts.join("") + "</section>";
}
