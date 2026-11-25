// 艺界星途 · AI 公共部分与课程方案 AI 助手（Claude，接口 v0.3.6 §3.2、§4.3.4）
// 原则：AI 只给建议；人点“采用”后才写进页面，再由人点“保存”走普通保存接口。

var yxAiUsageCache = null;
var yxAiKeys = {}; // 同一请求体在得到明确结果前复用幂等键：网络断了重点一次不会重复计次。
const YXAI_BASIS = {
  rule: ["机构规则", "info"],
  consult: ["咨询原话", "ok"],
  feedback: ["课后反馈", "ok"],
  profile: ["机构档案", "ok"],
  ai_judgement: ["AI 判断", "muted"],
  unsupported: ["需核对", "warn"],
};
const YXAI_ERR = {
  configuration_missing: "AI 还没开通：平台管理员需要先配置模型和服务密钥。",
  ai_timeout: "AI 写得比较久没完成，本次不计次数。可以把长度调短、只选中一段来改，或切到“深度”再试。",
  ai_unavailable: "AI 暂时没能完成，本次不计次数。请稍后再试一次。",
  network: "网络中断了。AI 可能还在处理，稍后再点一次同一个按钮会取回结果，不会重复计次。",
};

function yxUuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 15) | 64;
  b[8] = (b[8] & 63) | 128;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
}
function yxSleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
// 调用一个 AI 接口。fresh=true 表示“重新生成”，换新的幂等键。
async function yxAi(route, body, fresh) {
  const sig = route + "|" + JSON.stringify(body);
  if (fresh || !yxAiKeys[sig]) yxAiKeys[sig] = yxUuid();
  const key = yxAiKeys[sig];
  let path = "ai/" + route;
  if (typeof yxScopedPath === "function") path = yxScopedPath(path);
  for (let i = 0; ; i++) {
    let res;
    try {
      res = await fetch(base + "api/" + path, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify(body),
        credentials: "same-origin",
      });
    } catch {
      if (i < 2) {
        await yxSleep(2000);
        continue;
      }
      const e = Error(YXAI_ERR.network);
      e.code = "network";
      throw e;
    }
    let data = {};
    try {
      data = await res.json();
    } catch {}
    if (res.ok) {
      delete yxAiKeys[sig];
      if (data.usage) yxAiUsageCache = null;
      return data;
    }
    const code = data.message ? data.error : data.code;
    // 同一个请求还在处理：等一会儿用同一个键取结果。
    if (res.status === 409 && code === "in_progress" && i < 60) {
      await yxSleep(2500);
      continue;
    }
    if (res.status === 401) location.assign(base + "login");
    if (res.status === 403 && code === "tenant_expired" && typeof yxTenantPaused === "function") yxTenantPaused(data.message);
    if (code !== "rate_limited") delete yxAiKeys[sig];
    const e = Error(YXAI_ERR[code] || data.message || "AI 请求失败");
    e.code = code;
    e.status = res.status;
    e.details = data.details;
    throw e;
  }
}
async function yxAiUsage() {
  if (!yxAiUsageCache) yxAiUsageCache = apiRequest("ai/usage").catch(() => null);
  return yxAiUsageCache;
}
// “今日 AI 3 / 80”，深度模式用过才显示。
function yxAiUsageChip() {
  const chip = el("span", "今日 AI …", { class: "yxai-usage" });
  yxAiUsage().then((u) => {
    if (!u) return chip.remove();
    chip.textContent = "今日 AI " + u.fast.used + " / " + u.fast.limit + (u.deep.used ? " · 深度 " + u.deep.used + " / " + u.deep.limit : "");
    if (u.fast.used >= u.fast.limit) chip.classList.add("is-full");
  });
  return chip;
}
// 按钮：点了显示“AI 生成中…”，结束恢复。
function yxAiButton(text, run, kind = "") {
  // UI.button 本身会在执行期间禁用按钮、防止连点，这里只换文字和显示错误。
  const b = button(text, async () => {
    const face = b.querySelector(".ui-button-face > span:last-child") || b;
    const old = face.textContent;
    face.textContent = "AI 生成中…";
    try {
      await run();
    } catch (e) {
      notice(e.message);
    } finally {
      face.textContent = old;
    }
  }, kind);
  b.classList.add("yxai-btn");
  return b;
}
// 依据标签；没有依据的句子单独列出，提醒人工核对。
function yxAiBasis(basis, only) {
  const V = globalThis.ChannelV2;
  const box = el("div", null, { class: "yxai-basis" });
  const list = only ? only.map((i) => basis?.[i]).filter(Boolean) : basis || [];
  const tags = el("div", null, { class: "yxai-tags" });
  const miss = [];
  for (const b of list) {
    if (b.type === "unsupported") {
      miss.push(b.text);
      continue;
    }
    const [label, tone] = YXAI_BASIS[b.type] || [b.type, "muted"];
    const t = V.chip(label, tone);
    const detail = b.quote || b.text || b.ref || "";
    if (detail) t.setAttribute("title", detail);
    tags.append(t);
  }
  if (tags.childElementCount) box.append(tags);
  if (miss.length) {
    // 句子多时折叠，只显示条数，点开再看。
    const w = el("details", null, { class: "yxai-miss" });
    if (miss.length <= 3) w.setAttribute("open", "");
    w.append(el("summary", miss.length + " 处在资料里找不到依据，请人工核对或删改"));
    const ul = el("ul");
    for (const m of miss) ul.append(el("li", m));
    w.append(ul);
    box.append(w);
  }
  return box;
}
// AI 返回的 warnings 多是内部校验细节（path、格式、引用核验）。界面只给用户有用的提醒，其余合成一句。
const YXAI_WARN_KEEP = [
  [/超过预算/, "有的配法超出了预算上限，没有列出"],
  [/选课规则/, "有的配法不符合本机构的选课规则，没有列出"],
  [/未定价|报价范围/, "有的课程不在价目表里或还没定价，没有列出"],
  [/与其他学员比较/, "去掉了拿学员互相比较的说法"],
  [/没有符合|未找到符合/, "这次没有合适的建议，可以补充资料或换个说法再试"],
];
function yxAiWarnings(list) {
  if (!list?.length) return null;
  const out = new Set();
  let dropped = 0;
  for (const w of list) {
    const k = YXAI_WARN_KEEP.find(([re]) => re.test(w));
    if (k) out.add(k[1]);
    else if (/^已丢弃/.test(w)) dropped++;
  }
  if (dropped) out.add("有 " + dropped + " 条建议没能用上，可以再试一次或换个说法");
  if (!out.size) return null;
  const ul = el("ul", null, { class: "yxai-warn" });
  for (const w of out) ul.append(el("li", w));
  return ul;
}
function yxClone(v) {
  return JSON.parse(JSON.stringify(v));
}

// ---------- 课程方案：AI 助手（侧栏） ----------
const YXP_AI_PAGES = [["cover", "封面"], ["assessment", "评估"], ["path", "学习路径"], ["courses", "课程安排"], ["fees", "费用"], ["teachers", "老师介绍"], ["about", "关于机构"]];
const YXP_PATH_NAMES = {
  title: "方案标题",
  "modules.cover.eyebrow": "封面眉题",
  "modules.cover.subtitle": "封面副标题",
  "modules.assessment.text": "现状评估",
  "modules.assessment.strengths": "优势",
  "modules.assessment.gaps": "需要加强",
  "modules.assessment.goals": "目标",
  "modules.assessment.source_note": "评估依据",
  "modules.fees.note": "费用说明",
};
const YXP_PATH_FIELDS = { name: "名称", goals: "目标", frequency_text: "频率说明", note: "备注", includes: "包含项" };
// 解析 v0.3.6 的文字路径：modules.path.stages[key=stk_1].goals
function yxpPathRef(doc, path) {
  const parts = path.split(".");
  let o = doc;
  for (const p of parts.slice(0, -1)) {
    const m = /^(\w+)\[(\w+)=([^\]]+)\]$/.exec(p);
    o = m ? (o?.[m[1]] || []).find((x) => String(x[m[2]]) === m[3]) : o?.[p];
    if (!o || typeof o !== "object") return null;
  }
  return { obj: o, key: parts[parts.length - 1] };
}
function yxpPathLabel(st, path) {
  if (YXP_PATH_NAMES[path]) return YXP_PATH_NAMES[path];
  const r = yxpPathRef(st.doc, path),
    f = YXP_PATH_FIELDS[r?.key] || r?.key || "";
  if (/stages\[/.test(path)) return "阶段「" + (r?.obj?.name || "") + "」" + f;
  if (/lines\[/.test(path)) {
    const c = st.courses.find((x) => x.id === r?.obj?.course_id);
    return "课程「" + (r?.obj?.snapshot?.name || c?.name || "") + "」" + f;
  }
  return path;
}
function yxpShow(v) {
  return Array.isArray(v) ? v.join("、") : v == null ? "" : String(v);
}
function yxpAiSet(doc, path, value) {
  const r = yxpPathRef(doc, path);
  if (!r) return false;
  r.obj[r.key] = Array.isArray(r.obj[r.key]) && !Array.isArray(value) ? String(value).split(/\n|；|;/).map((x) => x.trim()).filter(Boolean) : value;
  return true;
}
// 侧栏 AI 盒子。st.ai 保存最近一次结果，重绘后还在。
function yxpAiBox(side, st, locked, mark, rerender) {
  const doc = st.doc;
  // 设计稿 v3：头部“方案助手”+ 快速/深度；三个页签；底部常用说法、一句话调整、撤销。
  const head = el("div", null, { class: "yxv-ai-head" });
  const t = el("div");
  t.append(el("strong", "方案助手"), el("small", "艺界星途 AI", { class: "v-muted" }));
  head.append(el("span", "✦", { class: "yxv-ai-logo", "aria-hidden": "true" }), t, el("span", null, { class: "v-spacer" }));
  side.append(head);
  if (locked || !enabled("ai", "use")) {
    side.append(el("p", locked ? "方案已签约或归档，不能再用 AI 修改。" : "你的账号没有使用 AI 的权限。", { class: "v-muted v-pad" }));
    const body = el("div", null, { class: "yxv-ai-body" });
    yxpTotals(body, st);
    side.append(body);
    return;
  }
  const tier = el("div", null, { class: "yxv-tier", role: "group", "aria-label": "AI 模式" });
  for (const [k, n] of [[false, "快速"], [true, "深度"]]) {
    const b = el("button", n, { type: "button", "aria-pressed": String(!!st.aiDeep === k) });
    b.addEventListener("click", () => ((st.aiDeep = k), rerender()));
    tier.append(b);
  }
  head.append(tier);
  const run = async (route, body, label, fresh) => {
    if (st.dirty) return notice("先保存，AI 读取的是保存后的方案");
    const req = { plan_id: doc.id, ...body, ...(st.aiDeep ? { tier: "deep" } : {}) };
    const r = await yxAi(route, req, fresh);
    st.ai = { route, body, label, res: r };
    rerender();
  };
  const tabs = el("div", null, { class: "yxv-seg yxv-seg-full yxv-ai-tabs", role: "tablist" });
  const cur = st.aiTab || "courses";
  for (const [k, n] of [["consult", "整理咨询记录"], ["courses", "阶段与课程"], ["polish", "润色文字"]]) {
    const b = el("button", n, { type: "button", role: "tab", "aria-selected": String(cur === k), "aria-pressed": String(cur === k) });
    b.addEventListener("click", () => ((st.aiTab = k), rerender()));
    tabs.append(b);
  }
  side.append(tabs);
  const box = el("div", null, { class: "yxv-ai-body" });
  side.append(box);
  if (cur === "consult") {
    box.append(el("p", "读学员备注和跟进记录里的咨询内容，整理成现状评估和目标；每条建议附家长原话。", { class: "yxv-scope" }));
    box.append(yxAiButton("整理咨询记录", () => run("plan/fill-from-consult", {}, "整理咨询记录"), "primary"));
  } else if (cur === "polish") {
    box.append(el("p", "只润色评估、目标、阶段说明等文字，不改课程、课时和金额。", { class: "yxv-scope" }));
    box.append(yxAiButton("润色文字", () => run("plan/polish", {}, "润色文字"), "primary"));
  } else {
    const scope = el("p", null, { class: "yxv-scope" });
    scope.append("只在机构设置的范围内生成：", el("b", YXS_SUBJECT?.[doc.subject] || doc.subject || ""), " · 报价课程 " + st.courses.filter((c) => c.active).length + " 门 · 金额由程序按价目表计算。");
    box.append(scope);
    yxpTotals(box, st);
    const stages = doc.modules.path.stages;
    if (stages.length) {
      const row = el("div", null, { class: "yxv-row" });
      const pick = el("select", null, { "aria-label": "给哪个阶段配课" });
      pick.append(el("option", "全部阶段", { value: "" }));
      for (const s of stages) pick.append(el("option", s.name, { value: s.key }));
      row.append(pick, yxAiButton("推荐配法", () => run("plan/stage-courses", pick.value ? { stage_key: pick.value } : {}, "推荐配法"), "primary"));
      box.append(row, el("p", "给 1 个推荐配法和最多 2 个同预算备选；备选只给顾问参考，不进方案。", { class: "v-muted yxai-note" }));
    } else box.append(el("p", "先在左边“学习路径”排好阶段，才能推荐配法。", { class: "v-muted yxai-note" }));
  }
  if (st.ai) box.append(yxpAiResult(st, mark, rerender, run));
  // 底部：常用说法 + 一句话调整 + 撤销
  const foot = el("div", null, { class: "yxv-ai-foot" });
  const ask = el("input", null, { type: "text", placeholder: "一句话调整，比如：第 3 段加视唱练耳", "aria-label": "一句话调整", maxlength: "300" });
  const page = el("select", null, { "aria-label": "调整哪一页", class: "yxv-page-pick" });
  for (const [k, tt] of YXP_AI_PAGES) page.append(el("option", tt, { value: k }));
  page.value = st.aiPage || "courses";
  page.addEventListener("change", () => (st.aiPage = page.value));
  const quick = el("div", null, { class: "yxv-chips" });
  for (const [pg, tt] of [["path", "考级推迟一个月"], ["courses", "不要集训营"], ["courses", "每周多加一节课"], ["courses", "预算控制在 1 万以内"]]) {
    const q = el("button", tt, { type: "button" });
    q.addEventListener("click", () => {
      ask.value = tt;
      page.value = pg;
      st.aiPage = pg;
      ask.focus();
    });
    quick.append(q);
  }
  const adj = el("div", null, { class: "yxv-row" });
  adj.append(
    page,
    ask,
    yxAiButton("发送", async () => {
      const v = ask.value.trim();
      if (!v) return notice("先写一句要怎么调整");
      await run("plan/adjust", { page: page.value, instruction: v }, "一句话调整");
    }),
  );
  const row2 = el("div", null, { class: "yxv-row" });
  const undo = button("↶ 撤销", () => {
    st.doc = st.undo.pop();
    st.applied = (st.applied || []).slice(0, -1);
    mark();
    rerender();
  });
  undo.disabled = !st.undo?.length;
  row2.append(el("span", null, { class: "v-spacer" }), undo);
  foot.append(quick, adj, row2);
  side.append(foot);
}
// 合计卡：阶段周数条 + 合计 / 上限（金额全部来自后端计算）
function yxpTotals(box, st) {
  const c = st.doc.computed || {},
    t = c.total || {};
  const stages = c.stages || [];
  if (stages.length) {
    const barEl = el("div", null, { class: "yxp-weeks" });
    const sum = stages.reduce((a, x) => a + (Number(x.weeks_display) || 1), 0);
    stages.forEach((x, i) => {
      const seg = el("span", "①②③④⑤⑥⑦⑧⑨"[i] + " " + (x.weeks_display || "?") + " 周");
      seg.style.setProperty("flex", String((Number(x.weeks_display) || 1) / sum));
      seg.classList.add("is-" + Math.min(i, 3));
      barEl.append(seg);
    });
    box.append(barEl);
  }
  const card = el("div", null, { class: "yxp-sum-card" });
  const names = Object.fromEntries((st.doc.modules.path.stages || []).map((s) => [s.key, s.name]));
  for (const [i, x] of stages.entries()) {
    const r = el("div", null, { class: "yxp-sum-row" });
    r.append(el("span", "①②③④⑤⑥⑦⑧⑨"[i] + " " + (names[x.key] || "")), el("span", x.units + " 课时", { class: "v-muted" }), el("strong", yxpMoney(x.amount)));
    card.append(r);
  }
  const tot = el("div", null, { class: "yxp-sum-total" });
  tot.append(el("span", "合计"), el("b", yxpMoney(t.amount), { class: "yx-num" }));
  if (c.budget?.cap != null) {
    tot.append(el("span", "/ " + yxpMoney(c.budget.cap), { class: "v-muted" }), el("span", null, { class: "v-spacer" }), el("span", c.budget.over ? "超出上限 " + yxpMoney(-c.budget.remaining) : "不超上限 · 余 " + yxpMoney(c.budget.remaining), { class: "yx-dot " + (c.budget.over ? "is-bad" : "is-ok") }));
  }
  card.append(tot);
  if (c.installments?.length) {
    const ins = el("p", "分期：" + c.installments.map((x) => x.label + " " + yxpMoney(x.amount)).join("；"), { class: "v-muted" });
    card.append(ins);
  }
  if (c.optional_fees?.length) card.append(el("p", "可选费用（不计入总价）：" + c.optional_fees.map((x) => x.label + (x.price_text ? " " + x.price_text : "")).join("；"), { class: "v-muted" }));
  card.append(el("small", st.dirty ? "金额保存后更新" : "金额由程序按价目表计算", { class: "v-muted" }));
  box.append(card);
}
function yxpAiResult(st, mark, rerender, run) {
  const { res, label, route, body } = st.ai;
  const out = el("div", null, { class: "yxai-result" });
  const top = el("div", null, { class: "yxai-head" });
  top.append(
    el("strong", label + " · " + (res.suggestions.length ? res.suggestions.length + " 条建议" : "没有可用建议")),
    globalThis.ChannelV2.link("重新生成", () => run(route, body, label, true).catch((e) => notice(e.message))),
    globalThis.ChannelV2.link("收起", () => ((st.ai = null), rerender())),
  );
  out.append(top);
  const w = yxAiWarnings(res.warnings);
  if (w) out.append(w);
  for (const sg of res.suggestions) out.append(sg.kind === "plan.stage_courses" ? yxpAiCourses(st, sg, mark, rerender) : yxpAiFields(st, sg, mark, rerender));
  return out;
}
function yxpAdopt(st, sg, apply, mark, rerender) {
  (st.undo ||= []).push(yxClone(st.doc));
  apply();
  (st.applied ||= []).push(sg.id);
  st.ai = null;
  mark();
  rerender();
  notice("已采用，确认无误后点“保存”", "success");
}
function yxpAiFields(st, sg, mark, rerender) {
  const card = el("div", null, { class: "yxai-card" });
  const picks = [];
  for (const f of sg.payload.fields || []) {
    const row = el("label", null, { class: "yxai-field" });
    const c = el("input", null, { type: "checkbox", checked: "" });
    const cur = yxpPathRef(st.doc, f.path);
    const txt = el("span", null, { class: "yxai-field-main" });
    txt.append(el("b", yxpPathLabel(st, f.path)));
    const old = cur ? yxpShow(cur.obj[cur.key]) : "";
    if (old) txt.append(el("del", old));
    txt.append(el("span", yxpShow(f.value), { class: "yxai-new" }));
    if (f.quote) txt.append(el("small", "咨询原话：“" + f.quote + "”", { class: "v-muted" }));
    row.append(c, txt);
    card.append(row);
    picks.push([c, f]);
  }
  card.append(yxAiBasis(sg.basis));
  const w = yxAiWarnings(sg.warnings);
  if (w) card.append(w);
  card.append(
    button("采用选中的修改", () => {
      const chosen = picks.filter(([c]) => c.checked).map(([, f]) => f);
      if (!chosen.length) return notice("至少勾选一条");
      yxpAdopt(st, sg, () => chosen.forEach((f) => yxpAiSet(st.doc, f.path, f.value)), mark, rerender);
    }, "primary"),
  );
  return card;
}
function yxpAiCourses(st, sg, mark, rerender) {
  const V = globalThis.ChannelV2,
    p = sg.payload,
    c = p.computed || {};
  const card = el("div", null, { class: "yxai-card" + (p.variant === "recommended" ? " is-rec" : "") });
  const head = el("div", null, { class: "yxai-head" });
  head.append(V.chip(p.variant === "recommended" ? "推荐" : "备选", p.variant === "recommended" ? "ok" : "muted"), el("strong", yxpMoney(c.total?.amount)), el("span", (c.total?.units || 0) + " 课时", { class: "v-muted" }));
  card.append(head);
  if (c.budget?.cap != null) card.append(el("small", c.budget.over ? "超出预算" : "预算内，剩余 " + yxpMoney(c.budget.remaining), { class: "v-muted" }));
  const old = st.doc.modules.courses.lines;
  for (const s of st.doc.modules.path.stages) {
    const ls = p.lines.filter((l) => l.stage_key === s.key);
    if (!ls.length) continue;
    card.append(el("small", s.name, { class: "yxai-stage" }));
    const ul = el("ul", null, { class: "yxai-lines" });
    for (const l of ls) {
      const crs = st.courses.find((x) => x.id === l.course_id);
      const was = old.find((o) => o.line_id === l.line_id);
      const [k, unit] = YXP_QTY[was?.snapshot?.pricing?.mode || crs?.pricing?.mode || "per_unit"] || ["units", "课时"];
      const li = el("li");
      li.append(el("span", (was?.snapshot?.name || crs?.name || l.course_id) + " × " + (l.qty?.[k] ?? Object.values(l.qty || {})[0] ?? "") + " " + unit));
      if (!was) li.append(V.chip("新加", "info"));
      else if (JSON.stringify(was.qty) !== JSON.stringify(l.qty)) li.append(V.chip("改数量", "info"));
      ul.append(li);
    }
    card.append(ul);
  }
  card.append(yxAiBasis(sg.basis));
  const w = yxAiWarnings(sg.warnings);
  if (w) card.append(w);
  card.append(
    button("采用这个配法", () =>
      yxpAdopt(st, sg, () => {
        // 旧行保留原快照（按 line_id 合并），新行带 tmp_ 临时 ID，保存时换正式 ID。
        st.doc.modules.courses.lines = p.lines.map((l) => ({ ...(old.find((o) => o.line_id === l.line_id) || {}), ...l }));
        st.doc.computed = c;
        st.priceRev = p.price_list_rev;
      }, mark, rerender),
      p.variant === "recommended" ? "primary" : "",
    ),
  );
  return card;
}
