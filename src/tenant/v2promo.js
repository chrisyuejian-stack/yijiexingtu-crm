// 推广中心改版（机构端）：首页、课程介绍（长图为主）、已开班详情、海报与品牌素材。
// 只读既有推广接口；申请、名单、撤回、上传沿用原表单与原写入路径。
// 后端字段 is_free、format、amount_due、paid、qr_caption 已到位（迁移 0013）；旧数据缺字段时按“有就显示、没有就不显示”处理。
(() => {
  "use strict";
  const n = el,
    F = UI.fmt,
    V = () => globalThis.ChannelV2,
    P = () => globalThis.ChannelV2People;
  const chip = (text, tone) => V().chip(text, tone);
  const link = (text, fn) => V().link(text, fn);
  const DAY = 86400000;
  const WEEK = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const bj = (ms) => new Date(Number(ms) + 8 * 3600000).toISOString();
  const dayOf = (v) => (typeof v === "number" ? bj(v).slice(0, 10) : String(v).slice(0, 10));
  const hm = (v) => (typeof v === "number" ? bj(v).slice(11, 16) : String(v).slice(11, 16));
  const wd = (d) => WEEK[new Date(d + "T12:00:00Z").getUTCDay()];
  const mdw = (v) => dayOf(v).slice(5) + " " + wd(dayOf(v));
  const endOf = (start, minutes) => {
    const [h, m] = hm(start).split(":").map(Number),
      t = h * 60 + m + Number(minutes || 0);
    return String(Math.floor(t / 60)).padStart(2, "0") + ":" + String(t % 60).padStart(2, "0");
  };
  const isFree = (row) => row.is_free === 1 || row.is_free === true || (row.seat_price === 0 && !row.suggested_price);
  const kindLabel = (row) => (row.format === "lecture" ? "讲座" : row.session_count > 1 ? "线上长期课" : "线上课");
  const daysLeft = (deadline) => Math.ceil((Number(deadline) - Date.now()) / DAY);
  const deadlineText = (row) => {
    const left = daysLeft(row.apply_deadline);
    return "申请截止 " + mdw(row.apply_deadline) + (left > 0 ? "，还剩 " + left + " 天" : left === 0 ? "，今天截止" : "，已截止");
  };
  const STRIPES = ["v-pr-s1", "v-pr-s2", "v-pr-s3", "v-pr-s4"];
  const appLabel = (status) => me.labels.promo?.applications?.[status] || "";
  const courseLabel = (status) => me.labels.promo?.courses?.[status] || "";
  const urls = new Set();
  const keep = (u) => (urls.add(u), u);
  const clearUrls = () => {
    for (const u of urls) URL.revokeObjectURL(u);
    urls.clear();
  };
  async function copy(text, done = "已复制，可直接粘贴到家长群") {
    try {
      await navigator.clipboard.writeText(text);
      notice(done, "success");
    } catch {
      notice("当前浏览器不允许自动复制，请长按下方文字手动复制");
    }
  }

  // 图片走全局长期缓存：整个使用过程中同一张图只下载、解码一次（Logo、二维码会被每张海报复用）。
  const load = (id, fallback) => promoCachedImage(id, fallback);
  // 合成好的海报也缓存：底图、Logo、二维码、机构名、二维码旁文字都没变时直接复用，不再重画。
  // 最多 24 张；换了 Logo 或二维码时“钥匙”变了，自然重新合成。
  const composed = new Map();
  const composeKey = (p, ctx) =>
    [
      p.id,
      p.image_key,
      p.width,
      p.height,
      JSON.stringify(p.slots),
      ctx.assets?.logo_key || "",
      ctx.assets?.qr_key || "",
      ctx.assets?.qr_caption || "",
      ctx.brand.display_name,
      (ctx.brand.logo || "").length + ":" + (ctx.brand.logo || "").slice(-24),
      (ctx.brand.consultant_qr || "").length + ":" + (ctx.brand.consultant_qr || "").slice(-24),
    ].join("|");
  function compose(p, ctx) {
    const key = composeKey(p, ctx);
    if (composed.has(key)) return promoCacheTouch(composed, key);
    const pending = drawPoster(p, ctx).catch((e) => {
      composed.delete(key);
      throw e;
    });
    return promoCachePut(composed, 24, key, pending, (x) => x?.url && URL.revokeObjectURL(x.url));
  }
  // ---------- 海报合成：底图 + 机构 Logo + 二维码 + 机构名与二维码旁文字 ----------
  async function drawPoster(p, ctx) {
    const canvas = document.createElement("canvas");
    canvas.width = p.width;
    canvas.height = p.height;
    const g = canvas.getContext("2d");
    const [bg, logo, qr] = await Promise.all([
      load(p.image_key),
      load(ctx.assets?.logo_key, ctx.brand.logo).catch(() => null),
      load(ctx.assets?.qr_key, ctx.brand.consultant_qr).catch(() => null),
    ]);
    g.drawImage(bg, 0, 0, p.width, p.height);
    const s = p.slots;
    if (logo) promoContain(g, logo, s.logo);
    else {
      g.fillStyle = "#2B4C7E";
      g.fillRect(s.logo.x, s.logo.y, s.logo.width, s.logo.height);
      g.fillStyle = "#fff";
      g.font = "bold " + Math.floor(s.logo.height * 0.55) + "px sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(Array.from(ctx.brand.display_name)[0] || "教", s.logo.x + s.logo.width / 2, s.logo.y + s.logo.height / 2);
    }
    if (qr) promoContain(g, qr, s.qr);
    else {
      // 缺二维码：红色虚线占位，提醒机构上传
      g.strokeStyle = "#B42318";
      g.lineWidth = 4;
      g.setLineDash([14, 10]);
      g.strokeRect(s.qr.x + 2, s.qr.y + 2, s.qr.width - 4, s.qr.height - 4);
      g.setLineDash([]);
      g.fillStyle = "#B42318";
      g.font = Math.floor(s.qr.width / 7) + "px sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText("缺二维码", s.qr.x + s.qr.width / 2, s.qr.y + s.qr.height / 2);
    }
    const t = s.text;
    g.textAlign = t.align;
    g.textBaseline = "alphabetic";
    g.fillStyle = t.color;
    const x = t.x + (t.align === "center" ? t.width / 2 : t.align === "right" ? t.width : 0);
    g.font = "bold " + t.font_size + "px sans-serif";
    g.fillText(ctx.brand.display_name, x, t.y + t.font_size, t.width);
    g.font = Math.round(t.font_size * 0.8) + "px sans-serif";
    g.fillStyle = "#666666";
    g.fillText(ctx.assets?.qr_caption || "扫码咨询 · 艺界星途国际艺术合作课程", x, t.y + t.font_size * 2.1, t.width);
    const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
    return { blob, url: URL.createObjectURL(blob) };
  }
  // 课程详情短期复用：1 分钟内、且期间没有任何保存操作时，再次打开同一课程不重取。
  // 鼠标移到或手指按到卡片上时就提前去取（只读请求），点下去时多半已经到了。
  const details = new Map();
  function detail(id) {
    const hit = details.get(id);
    if (hit && hit.seq === apiWriteSeq && Date.now() - hit.at < 60000) return hit.p;
    const p = api("promo/" + id).catch((e) => {
      details.delete(id);
      throw e;
    });
    details.set(id, { at: Date.now(), seq: apiWriteSeq, p });
    return p;
  }
  let listMemo = null;
  function promoList() {
    if (listMemo && listMemo.seq === apiWriteSeq && Date.now() - listMemo.at < 60000) return listMemo.p;
    const p = api("promo?offset=0").catch((e) => {
      listMemo = null;
      throw e;
    });
    listMemo = { at: Date.now(), seq: apiWriteSeq, p };
    return p;
  }
  function prefetchOn(node, id) {
    const go = () => void detail(id).catch(() => {});
    node.addEventListener("pointerenter", go, { once: true });
    node.addEventListener("touchstart", go, { once: true, passive: true });
    node.addEventListener("focusin", go, { once: true });
  }
  // 打开详情时数据还没回来：超过 120 毫秒才换成占位骨架（很快就到的话不闪）。
  function waitSkeleton(c, title) {
    const timer = setTimeout(() => {
      const crumb = n("div", null, { class: "v-pr-crumb" });
      crumb.append(link("推广中心", () => home(c)), n("span", "›", { class: "v-muted" }), n("h2", title || "正在打开…"));
      const sk = n("div", null, { class: "v-pr-intro v-pr-skel", "aria-busy": "true" });
      sk.append(n("div", null, { class: "v-skel v-skel-long" }), n("div", null, { class: "v-skel v-skel-side" }));
      c.replaceChildren(crumb, sk);
    }, 120);
    return () => clearTimeout(timer);
  }
  const event = (campaignId, posterId, action) => api("promo/" + campaignId + "/posters/" + posterId + "/event", "POST", { action }).catch(() => {});
  // 下载文件名用英文和数字：有的浏览器会把中文文件名改成“download”。
  let saved = 0;
  function save(url, name) {
    const kind = /长图/.test(name) ? "course-intro" : "poster",
      day = todayBJ().replaceAll("-", "");
    const a = n("a", null, { href: url, download: kind + "-" + ++saved + "-" + day + ".png" });
    document.body.append(a);
    a.click();
    a.remove();
  }
  async function share(item, title) {
    const file = new File([item.blob], "poster-" + todayBJ().replaceAll("-", "") + ".png", { type: "image/png" });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title });
        return true;
      } catch (e) {
        if (e?.name === "AbortError") return false;
      }
    }
    notice("这个浏览器不能直接分享图片。请点“下载”，或在手机上长按图片保存后发送；微信里打开时只能长按保存。");
    return false;
  }

  // ---------- 首页 ----------
  const hState = { type: "" };
  async function home(c, type) {
    if (pendingOpen) {
      const id = pendingOpen;
      pendingOpen = null;
      return promoDetailV(c, id);
    }
    if (type !== undefined) hState.type = type;
    clearUrls();
    const token = Symbol("promo");
    c._promoRender = token;
    const data = await promoList();
    const items = data.items;
    vHead?.actions(button("海报与品牌素材", () => brandPage(c)));
    c.replaceChildren();
    const ctx = { assets: data.assets, brand: data.brand };
    const hasQr = !!(data.assets?.qr_key || data.brand.consultant_qr),
      hasLogo = !!(data.assets?.logo_key || data.brand.logo);
    if (!hasQr) {
      const bar = n("div", null, { class: "v-pr-alert", role: "status" });
      const t = n("p");
      t.append(n("strong", "还没有上传招生二维码。"), "海报会自动放上机构 Logo 和二维码，缺二维码时海报上只显示机构名。");
      bar.append(UI.icon("warning"), t, chip(hasLogo ? "Logo 已上传" : "Logo 未上传", hasLogo ? "ok" : "warn"), chip("二维码未上传", "bad"), button("上传二维码", () => brandPage(c), "primary"));
      c.append(bar);
    }
    const counts = { course: 0, material: 0, message: 0 };
    for (const r of items) counts[r.type]++;
    const bar = n("div", null, { class: "v-fin-bar" });
    const chips = n("div", null, { class: "v-filter-chips", role: "group", "aria-label": "推广内容分类" });
    for (const [k, t] of [
      ["", "全部"],
      ["course", "合作课与讲座"],
      ["material", "招生物料"],
      ["message", "通知"],
    ]) {
      const b = n("button", t, { type: "button", class: "v-filter-chip" + (hState.type === k ? " is-on" : ""), "aria-pressed": String(hState.type === k) });
      if (k) b.append(n("span", String(counts[k]), { class: "v-chip-count" }));
      b.addEventListener("click", () => home(c, k));
      chips.append(b);
    }
    bar.append(chips, n("span", null, { class: "v-spacer" }), n("span", "艺界星途每月发布，新内容带“新”标记", { class: "v-muted v-fin-cut" }));
    c.append(bar);
    const show = (k) => !hState.type || hState.type === k;
    const jobs = [];
    // 合作课与讲座
    const courses = items.filter((r) => r.type === "course");
    if (show("course") && courses.length) {
      const sec = n("section", null, { class: "v-pr-sec" });
      sec.append(n("h2", "合作课与讲座"));
      const grid = n("div", null, { class: "v-pr-courses" });
      courses.forEach((r, i) => grid.append(courseCard(c, r, i, jobs)));
      sec.append(grid);
      c.append(sec);
    }
    // 招生物料（每张已合成本机构 Logo 和二维码）
    const posters = items.filter((r) => r.preview && r.type !== "message");
    if (show("material") && posters.length) {
      const sec = n("section", null, { class: "v-pr-sec" });
      const h = n("div", null, { class: "v-pr-sec-head" });
      const t = n("h2", "招生物料");
      t.append(n("small", "已自动放上本机构 Logo 和二维码"));
      h.append(t, link("管理品牌素材", () => brandPage(c)));
      sec.append(h);
      const grid = n("div", null, { class: "v-pr-posters" });
      for (const r of posters) {
        const card = n("article", null, { class: "v-pr-poster" });
        const frame = n("div", null, { class: "v-pr-poster-img is-loading" });
        const name = n("p", null, { class: "v-pr-poster-name" });
        name.append(r.title);
        if (!r.is_read) name.append(chip("新", "warn"));
        const ops = n("div", null, { class: "v-pr-poster-ops" });
        let item = null;
        const dl = button("下载", async () => {
          if (!item) return;
          save(item.url, r.title + ".png");
          await event(r.id, r.preview.id, "download");
        });
        const sh = button("分享", async () => item && (await share(item, r.title)) && event(r.id, r.preview.id, "save"));
        dl.disabled = sh.disabled = true;
        ops.append(dl, sh);
        card.append(frame, name, ops);
        frame.addEventListener("click", () => promoDetailV(c, r.id, r.title));
        prefetchOn(card, r.id);
        jobs.push(async () => {
          item = await compose(r.preview, ctx);
          if (c._promoRender !== token) return;
          frame.classList.remove("is-loading");
          frame.append(n("img", null, { src: item.url, alt: r.title + " · 已合成本机构 Logo 和二维码", loading: "lazy" }));
          dl.disabled = sh.disabled = false;
        });
        grid.append(card);
      }
      sec.append(grid);
      c.append(sec);
    }
    // 通知
    const msgs = items.filter((r) => r.type === "message");
    if (show("message") && msgs.length) {
      const sec = n("section", null, { class: "v-pr-sec" });
      sec.append(n("h2", "通知"));
      const list = n("div", null, { class: "v-panel v-pr-msgs" });
      for (const r of msgs) {
        const row = n("button", null, { type: "button", class: "v-pr-msg" + (r.is_read ? "" : " is-new") });
        row.append(n("i"), n("strong", r.title), n("span", r.summary || "", { class: "v-muted" }), n("small", dayOf(r.publish_at).slice(5), { class: "v-muted" }));
        row.addEventListener("click", () => promoDetailV(c, r.id, r.title));
        prefetchOn(row, r.id);
        list.append(row);
      }
      sec.append(list);
      c.append(sec);
    }
    if (!items.length) c.append(UI.empty({ text: "艺界星途发布的合作课、讲座、招生物料和通知会出现在这里。" }));
    // 逐个加载（最多 3 个并行），避免一次性解码太多大图
    const run = async () => {
      while (jobs.length && c._promoRender === token) {
        const job = jobs.shift();
        try {
          await job();
        } catch {}
      }
    };
    void Promise.all([run(), run(), run()]);
  }
  function courseCard(c, r, i, jobs) {
    const card = n("article", null, { class: "v-pr-course " + STRIPES[i % STRIPES.length] });
    const top = n("div", null, { class: "v-pr-tags" });
    if (isFree(r)) top.append(n("span", "免费", { class: "v-pr-free" }));
    top.append(chip(kindLabel(r), "info"));
    if (!r.is_read) top.append(chip("新", "warn"));
    const st = r.course_status === "recruiting" ? (r.application_status && r.application_status !== "withdrawn" ? [appLabel(r.application_status) || "已申请", "warn"] : ["招募中", "info"]) : [courseLabel(r.course_status) || "已开班", r.course_status === "failed" ? "muted" : "ok"];
    top.append(n("span", null, { class: "v-spacer" }), chip(st[0], st[1]));
    card.append(top, n("h3", r.title));
    const dl = n("dl", null, { class: "v-pr-dl" });
    const row = (k, v, cls) => {
      dl.append(n("dt", k));
      const dd = n("dd", null, cls ? { class: cls } : {});
      dd.append(v);
      dl.append(dd);
    };
    const when = r.first_start ? mdw(r.first_start) + " " + hm(r.first_start) + " · " + r.session_count + " 课次 · 线上" : r.session_count + " 课次 · 线上";
    const opened = ["opened", "running", "ended"].includes(r.course_status);
    const applied = !opened && r.application_status && r.application_status !== "withdrawn";
    const ops = n("div", null, { class: "v-pr-ops" });
    if (opened) {
      row("本机构", "已开班");
      const box = n("div", null, { class: "v-pr-meet" });
      card.append(dl, box);
      jobs.unshift(async () => {
        const d = await detail(r.id);
        const next = d.sessions.filter((s) => !s.cancelled && Date.parse(s.start_at) + s.duration * 60000 > Date.now()).sort((a, b) => a.start_at.localeCompare(b.start_at))[0];
        const idx = next ? d.sessions.filter((s) => !s.cancelled).sort((a, b) => a.start_at.localeCompare(b.start_at)).indexOf(next) + 1 : 0;
        dl.replaceChildren();
        const a = d.application;
        row("本机构", "确认 " + (a?.confirmed_size || 0) + " 席" + dueText(a, d.campaign));
        if (next) row("下次课", n("strong", mdw(next.start_at) + " " + hm(next.start_at)), "");
        if (next) dl.lastChild.append(" · 第 " + idx + " / " + d.sessions.length + " 课次");
        if (next?.meeting_no) {
          box.append(n("span", "腾讯会议 " + next.meeting_no), button("复制给学员", () => copy(classNotice(d.campaign, next, idx))));
        } else box.remove();
      });
      ops.append(button("查看课程安排", () => promoDetailV(c, r.id, r.title), "primary"));
    } else if (applied) {
      row("时间", when);
      row("主讲", r.lecturer);
      row("费用", isFree(r) ? "免费，可邀请本机构学员或家长参加" : seatText(r), isFree(r) ? "v-pr-green" : "");
      card.append(dl, steps(r.application_status));
      ops.append(button("修改人数", () => applyFor(c, r.id)), button("详情", () => promoDetailV(c, r.id, r.title)));
    } else {
      row("上课", when);
      row("主讲", r.lecturer);
      row("费用", isFree(r) ? "免费" : seatText(r), isFree(r) ? "v-pr-green" : "");
      card.append(dl);
      if (r.course_status === "recruiting") card.append(n("p", deadlineText(r), { class: "v-pr-deadline" + (daysLeft(r.apply_deadline) <= 3 ? " is-soon" : "") }));
      if (r.reason) card.append(n("p", r.reason, { class: "v-muted v-pr-reason" }));
      if (r.course_status === "recruiting") ops.append(button("申请名额", () => applyFor(c, r.id), "primary"));
      ops.append(button("详情", () => promoDetailV(c, r.id, r.title)));
    }
    card.append(ops);
    prefetchOn(card, r.id);
    return card;
  }
  const seatText = (r) => (r.seat_price === undefined ? "席位价请联系艺界星途顾问" : F.money(r.seat_price) + " / 席" + (r.suggested_price ? " · 建议收费 " + F.money(r.suggested_price) : ""));
  function dueText(a, row) {
    if (!a || isFree(row)) return "";
    if (a.amount_due !== undefined && a.amount_due !== null) return " · 应付 " + F.money(a.amount_due);
    const price = a.seat_price ?? row.seat_price;
    return price !== undefined && price !== null && a.confirmed_size ? " · 应付 " + F.money(a.confirmed_size * price) : "";
  }
  function steps(status) {
    const s = n("ol", null, { class: "v-pr-steps", "aria-label": "合作进度" });
    const at = { applied: 1, following: 1, confirmed: 2, opened: 3 }[status] || 0;
    ["已申请", "顾问确认席位", "开班"].forEach((t, i) => s.append(n("li", t, { class: i < at ? "is-done" : "" })));
    return s;
  }
  function classNotice(row, s, idx) {
    const d = dayOf(s.start_at);
    return [
      "【" + brand.display_name + "】" + row.title + " 第 " + idx + " 次课",
      "时间：" + Number(d.slice(5, 7)) + " 月 " + Number(d.slice(8)) + " 日（" + wd(d) + "）" + hm(s.start_at) + "–" + endOf(s.start_at, s.duration),
      s.meeting_no ? "腾讯会议号：" + s.meeting_no : "",
      s.meeting_url ? "入会链接：" + s.meeting_url : "",
      "请提前 5 分钟进入会议，使用学员真实姓名。",
    ]
      .filter(Boolean)
      .join("\n");
  }
  async function applyFor(c, id) {
    const data = await detail(id);
    return promoApplication(c, id, data);
  }

  // ---------- 详情（按类型分流） ----------
  async function promoDetailV(c, id, title) {
    clearUrls();
    const stop = waitSkeleton(c, title);
    let data;
    try {
      data = await detail(id);
    } finally {
      stop();
    }
    api("promo/" + id + "/read", "POST", {}).catch(() => {});
    const row = data.campaign;
    vHead?.actions();
    c.replaceChildren();
    const crumb = n("div", null, { class: "v-pr-crumb" });
    crumb.append(link("推广中心", () => home(c)), n("span", "›", { class: "v-muted" }), n("h2", row.title));
    const ctx = { assets: data.assets, brand: data.brand };
    if (row.type === "course") {
      const opened = ["opened", "running", "ended"].includes(row.course_status);
      crumb.append(chip(opened ? courseLabel(row.course_status) || "已开班" : row.course_status === "recruiting" ? (data.application && data.application.status !== "withdrawn" ? appLabel(data.application.status) : "招募中") : courseLabel(row.course_status), opened ? "ok" : "info"));
      c.append(crumb);
      return opened ? courseDetail(c, data, ctx) : courseIntro(c, data, ctx);
    }
    c.append(crumb);
    const grid = n("div", null, { class: "v-pr-intro" });
    const main = n("div", null, { class: "v-pr-longwrap" });
    if (data.posters.length) {
      const item = await compose(data.posters[0], ctx);
      main.append(n("img", null, { src: item.url, alt: row.title, class: "v-pr-long" }));
      const side = V().panel(row.type === "material" ? "招生物料" : "通知");
      side.append(n("p", row.body || row.summary || "", { class: "preserve-text v-pr-body" }));
      const ops = n("div", null, { class: "v-pr-side-ops" });
      ops.append(
        button("下载这张", async () => (save(item.url, row.title + ".png"), event(row.id, data.posters[0].id, "download")), "primary"),
        button("分享", async () => (await share(item, row.title)) && event(row.id, data.posters[0].id, "save")),
        button("海报与品牌素材", () => brandPage(c)),
      );
      side.append(ops);
      grid.append(main, side);
      void event(row.id, data.posters[0].id, "view");
    } else {
      const art = V().panel(dayOf(row.publish_at));
      art.append(n("p", row.body || row.summary || "", { class: "preserve-text v-pr-body" }));
      grid.append(art);
      grid.classList.add("is-single");
    }
    c.append(grid);
  }
  async function longImage(row) {
    if (!row.detail_image_key) return null;
    const img = await load(row.detail_image_key);
    return img?.src || null;
  }
  async function materials(data, ctx) {
    const out = [];
    for (const p of data.posters) out.push({ ...(await compose(p, ctx)), name: data.campaign.title + " · 海报 " + (out.length + 1) + ".png", poster: p });
    return out;
  }
  async function downloadAll(data, ctx) {
    const list = await materials(data, ctx);
    for (const m of list) {
      save(m.url, m.name);
      await event(data.campaign.id, m.poster.id, "download");
      await new Promise((r) => setTimeout(r, 400));
    }
    const src = await longImage(data.campaign);
    if (src) save(src, data.campaign.title + " · 课程介绍长图.png");
    notice("已开始下载 " + (list.length + (src ? 1 : 0)) + " 张图片", "success");
  }
  function materialsLabel(data) {
    return "下载招生物料（海报 " + data.posters.length + " 张" + (data.campaign.detail_image_key ? " · 长图 1 张" : "") + "）";
  }

  // 课程介绍：长图为页面主体
  async function courseIntro(c, data, ctx) {
    const row = data.campaign,
      a = data.application;
    const grid = n("div", null, { class: "v-pr-intro" });
    const main = n("div", null, { class: "v-pr-longwrap" });
    // 长图单独加载：失败时只在长图位置提示并可重试，不影响页面其他部分。
    const showLong = async () => {
      main.replaceChildren(n("div", "长图加载中…", { class: "v-pr-long is-empty" }));
      try {
        const src = await longImage(row);
        main.replaceChildren(src ? n("img", null, { src, alt: row.title + " · 课程介绍长图", class: "v-pr-long" }) : n("div", "艺界星途还没有上传这门课的详情长图。", { class: "v-pr-long is-empty" }));
      } catch {
        const box = n("div", "长图没有加载出来，可能是网络不稳定。", { class: "v-pr-long is-empty" });
        box.append(button("重新加载", showLong));
        main.replaceChildren(box);
      }
    };
    void showLong();
    const side = n("div", null, { class: "v-pr-side" });
    const info = n("section", null, { class: "v-panel v-pr-info" });
    const tags = n("div", null, { class: "v-pr-tags" });
    if (isFree(row)) tags.append(n("span", "免费", { class: "v-pr-free" }));
    tags.append(chip(kindLabel(row), "info"));
    info.append(tags, n("h3", row.title));
    const dl = n("dl", null, { class: "v-pr-dl" });
    const put = (k, v, cls) => {
      dl.append(n("dt", k));
      dl.append(n("dd", v, cls ? { class: cls } : {}));
    };
    if (isFree(row)) put("费用", "免费", "v-pr-green");
    else if (row.seat_price !== undefined) {
      put("席位价", F.money(row.seat_price) + " / 人");
      if (row.suggested_price) put("建议收费", F.money(row.suggested_price) + " / 人，机构自定");
    }
    put("主讲", row.lecturer);
    if (data.sessions.length) {
      const first = data.sessions[0];
      put("上课", wd(dayOf(first.start_at)) + " " + hm(first.start_at) + " · " + data.sessions.length + " 课次 · 每次 " + first.duration + " 分钟");
      put("开课", dayOf(first.start_at));
    }
    put("开班", "全国合计满 " + row.min_size + " 人开班");
    if (row.course_status === "recruiting") put("截止", deadlineText(row).replace("申请截止 ", ""), daysLeft(row.apply_deadline) <= 3 ? "v-pr-red" : "v-pr-red");
    info.append(dl);
    if (a && a.status !== "withdrawn") {
      info.append(steps(a.status), n("p", a.unsure ? "本机构预计人数还不确定" : "本机构预计 " + a.est_size + " 人", { class: "v-muted v-pr-note" }));
    }
    const ops = n("div", null, { class: "v-pr-side-ops is-col" });
    if (row.course_status === "recruiting") {
      if (!a || a.status === "withdrawn") ops.append(button("申请名额", () => promoApplication(c, row.id, data), "primary"));
      else if (["applied", "following"].includes(a.status)) {
        ops.append(button("修改申请", () => promoApplication(c, row.id, data), "primary"));
        ops.append(
          button("撤回申请", async () => {
            if (!(await UI.confirm({ title: "撤回本机构的申请？", consequence: "撤回后可在截止前重新申请。", danger: true }))) return;
            await api("promo/" + row.id + "/withdraw", "POST", { version: a.version });
            await promoDetailV(c, row.id);
          }),
        );
      }
    }
    if (data.posters.length || row.detail_image_key) ops.append(button(materialsLabel(data), () => downloadAll(data, ctx)));
    info.append(ops, n("p", "申请后由艺界星途顾问联系确认人数。人数不确定也可以先申请。", { class: "v-muted v-pr-note" }));
    if (row.reason) info.append(n("p", row.reason, { class: "preserve-text v-pr-note" }));
    const how = V().panel("怎么用这张长图招生");
    const ol = n("ol", null, { class: "v-pr-how" });
    for (const t of ["下载长图，发到家长群或朋友圈", "海报已带本机构二维码，家长扫码直接联系你", "统计好意向人数后，回来点“申请名额”"]) ol.append(n("li", t));
    how.append(ol);
    side.append(info, how);
    grid.append(main, side);
    c.append(grid);
    // 手机：底部固定栏
    if (row.course_status === "recruiting") {
      const bar = n("div", null, { class: "v-pr-mbar" });
      const t = n("div");
      t.append(n("strong", isFree(row) ? "免费" : row.seat_price !== undefined ? F.money(row.seat_price) + " / 席" : row.title), n("small", deadlineText(row)));
      bar.append(t, button("下载物料", () => downloadAll(data, ctx)), !a || a.status === "withdrawn" ? button("申请名额", () => promoApplication(c, row.id, data), "primary") : button("修改申请", () => promoApplication(c, row.id, data), "primary"));
      c.append(bar);
    }
  }

  // 已开班详情：课次表、复制上课通知、合作进度、应付艺界星途
  async function courseDetail(c, data, ctx) {
    const row = data.campaign,
      a = data.application;
    const top = c.querySelector(".v-pr-crumb");
    const actions = n("div", null, { class: "v-pr-crumb-ops" });
    actions.append(
      button("课程介绍长图", async () => {
        const d = UI.drawer({ title: row.title, subtitle: "课程介绍长图" });
        let src = null;
        try {
          src = await longImage(row);
        } catch {
          d.body.append(n("p", "长图没有加载出来，请关闭后再试一次。", { class: "v-muted" }));
          return;
        }
        d.body.append(src ? n("img", null, { src, alt: "课程介绍长图", class: "v-pr-long is-drawer" }) : n("p", "没有长图。", { class: "v-muted" }));
      }),
      button("下载招生物料", () => downloadAll(data, ctx), "primary"),
    );
    top.append(actions);
    const grid = n("div", null, { class: "v-pr-detail" });
    const left = n("div", null, { class: "v-pr-col" }),
      right = n("div", null, { class: "v-pr-col" });
    const sessions = [...data.sessions].sort((x, y) => x.start_at.localeCompare(y.start_at));
    const live = sessions.filter((s) => !s.cancelled);
    const intro = n("section", null, { class: "v-panel v-pr-introcard" });
    const l = n("div");
    l.append(n("small", "课程简介", { class: "v-muted" }), n("p", row.body || row.summary || "", { class: "preserve-text" }));
    const dl = n("dl", null, { class: "v-pr-dl" });
    for (const [k, v] of [
      ["主讲", row.lecturer],
      ["形式", "腾讯会议 · 每次 " + (live[0]?.duration || 45) + " 分钟"],
      ["课次", live.length + " 次" + (live.length ? " · " + dayOf(live[0].start_at).slice(5) + " 至 " + dayOf(live.at(-1).start_at).slice(5) : "")],
    ]) {
      dl.append(n("dt", k), n("dd", v));
    }
    intro.append(l, dl);
    left.append(intro);
    // 课程安排
    const sched = V().panel("课程安排");
    sched.querySelector("h2")?.append(n("small", "已自动排进本机构课表，类别为“合作课”，不扣课时、不计课酬"));
    const next = live.find((s) => Date.parse(s.start_at) + s.duration * 60000 > Date.now());
    const t = n("table", null, { class: "v-table" }),
      hr = n("tr");
    for (const [h, cls] of [["课次", ""], ["时间", ""], ["腾讯会议", ""], ["状态", ""], ["", "is-act"]]) hr.append(n("th", h, cls ? { class: cls } : {}));
    const thead = n("thead"),
      tbody = n("tbody");
    thead.append(hr);
    let k = 0;
    for (const s of sessions) {
      const idx = s.cancelled ? null : ++k;
      const past = Date.parse(s.start_at) + s.duration * 60000 <= Date.now();
      const tr = n("tr", null, { class: s === next ? "is-focus" : "" });
      const when = n("td");
      when.append(n("span", mdw(s.start_at) + " " + hm(s.start_at) + "–" + endOf(s.start_at, s.duration), { class: "v-num" }));
      tr.append(n("td", idx ? "第 " + idx + " 次" : "—"), when);
      const m = n("td");
      if (s.meeting_no && !past) {
        m.append(n("span", s.meeting_no, { class: "v-num" }));
        if (s.meeting_url) m.append(n("a", "入会链接", { href: s.meeting_url, target: "_blank", rel: "noopener noreferrer", class: "v-pr-meetlink" }));
      } else m.append(n("span", past ? "—" : "待艺界星途设置", { class: "v-muted" }));
      const st = n("td");
      st.append(s.cancelled ? chip("已取消", "muted") : past ? chip("已结束", "muted") : s === next ? chip("下一次", "info") : chip("待上课", "info"));
      const op = n("td", null, { class: "is-act" });
      if (!s.cancelled && !past) op.append(button("复制上课通知", () => copy(classNotice(row, s, idx)), s === next ? "primary" : ""));
      tr.append(m, st, op);
      tbody.append(tr);
    }
    t.append(thead, tbody);
    const wrap = n("div", null, { class: "v-pr-table" });
    wrap.append(t);
    sched.append(wrap);
    left.append(sched);
    if (next) {
      const pv = V().panel("上课通知预览");
      pv.querySelector("h2")?.append(n("small", "点“复制上课通知”后可直接粘贴到家长群"));
      pv.append(n("pre", classNotice(row, next, live.indexOf(next) + 1), { class: "preserve-text v-pr-noticepre" }));
      left.append(pv);
    }
    // 右栏：合作情况
    const coop = V().panel("本机构合作情况");
    const ol = n("ol", null, { class: "v-pr-progress" });
    for (const [label, done, at] of [
      ["已申请" + (a ? "，预计 " + (a.unsure ? "人数待定" : a.est_size + " 人") : ""), !!a, a?.created_at],
      ["顾问确认 " + (a?.confirmed_size || 0) + " 席", ["confirmed", "opened"].includes(a?.status), null],
      ["已开班", true, null],
    ]) {
      const li = n("li", null, { class: done ? "is-done" : "" });
      li.append(n("i"), n("span", label), n("small", at ? dayOf(at).slice(5) : "", { class: "v-muted" }));
      ol.append(li);
    }
    coop.append(ol);
    if (!isFree(row) && a) {
      const money = n("dl", null, { class: "v-pr-dl is-money" });
      const price = a.seat_price ?? row.seat_price;
      money.append(n("dt", "确认席位"), n("dd", (a.confirmed_size || 0) + " 席"));
      if (price !== undefined && price !== null) money.append(n("dt", "席位价"), n("dd", F.money(price) + " / 席"));
      const due = a.amount_due ?? (price !== undefined && price !== null ? a.confirmed_size * price : null);
      if (due !== null && due !== undefined) money.append(n("dt", "应付艺界星途", { class: "is-strong" }), n("dd", F.money(due), { class: "is-strong" }));
      if (a.paid !== undefined) {
        const dd = n("dd");
        dd.append(a.paid ? chip("艺界星途已确认收款", "ok") : chip("待付款", "warn"));
        money.append(n("dt", "付款状态"), dd);
      }
      coop.append(money, n("p", "付款在系统外完成，这里只显示金额和艺界星途的确认状态，不进入机构财务。", { class: "v-muted v-pr-note" }));
    } else if (isFree(row)) coop.append(n("p", "免费课程，不需要向艺界星途付费。", { class: "v-muted v-pr-note" }));
    right.append(coop);
    // 参加学员
    const roster = await api("promo/" + row.id + "/roster").catch(() => ({ items: [] }));
    const names = await choices("students").catch(() => []);
    const people = V().panel("参加学员 " + roster.items.length + " / " + (a?.confirmed_size || 0), a?.status === "opened" ? button("调整名单", () => promoRoster(c, row.id, data)) : null);
    for (const r of roster.items) {
      const s = names.find((x) => x.id === r.student_id);
      const line = n("div", null, { class: "v-pr-person" });
      line.append(n("span", s?.name || r.student_name || "学员"), n("small", s?.grade || "", { class: "v-muted" }));
      people.append(line);
    }
    if (!roster.items.length) people.append(n("p", "还没有登记学员。", { class: "v-muted v-pr-note" }));
    people.append(n("p", "名单不能超过确认席位。调整只影响还没上的课次。", { class: "v-muted v-pr-note" }));
    right.append(people);
    const who = V().panel("联系人");
    who.append(n("p", "本机构：" + (a?.contact_name || "未指定"), { class: "v-pr-note" }), n("p", "艺界星途顾问：" + (a?.consultant || "确认席位时由艺界星途指定"), { class: "v-pr-note" }));
    right.append(who);
    grid.append(left, right);
    c.append(grid);
  }

  // ---------- 海报与品牌素材 ----------
  async function brandPage(c) {
    clearUrls();
    const data = await api("promo?offset=0");
    const assetsResp = await api("promo/assets");
    const assets = assetsResp.assets;
    const ctx = { assets, brand: data.brand };
    vHead?.actions();
    c.replaceChildren();
    const crumb = n("div", null, { class: "v-pr-crumb" });
    crumb.append(link("推广中心", () => home(c)), n("span", "›", { class: "v-muted" }), n("h2", "海报与品牌素材"));
    c.append(crumb);
    const grid = n("div", null, { class: "v-pr-brand" });
    // 左：品牌素材
    const left = n("section", null, { class: "v-panel v-pr-assets" });
    left.append(n("h3", "本机构品牌素材"), n("p", "上传一次，艺界星途推送的所有海报都会自动放上。", { class: "v-muted v-pr-note" }));
    const hasLogo = !!(assets?.logo_key || data.brand.logo),
      hasQr = !!(assets?.qr_key || data.brand.consultant_qr);
    const saveAssets = async (patch) => {
      const fresh = (await api("promo/assets")).assets;
      await api("promo/assets", "PUT", { version: fresh?.version, logo_key: fresh?.logo_key || null, qr_key: fresh?.qr_key || null, ...patch });
      notice("已保存，海报已更新", "success");
      await brandPage(c);
    };
    const picker = (label, key, okText, hint) => {
      const box = n("div", null, { class: "v-pr-asset" });
      const head = n("div", null, { class: "v-pr-asset-head" });
      const has = key === "logo_key" ? hasLogo : hasQr;
      head.append(n("strong", label), chip(has ? "已上传" : "未上传", has ? "ok" : "bad"));
      const input = n("input", null, { type: "file", accept: "image/png,image/jpeg", class: "v-pr-file", "aria-label": "选择" + label });
      const drop = n("label", null, { class: "v-pr-drop" + (has ? " is-has" : " is-missing") });
      const progress = n("small", "", { class: "v-muted" });
      drop.append(UI.icon("upload"), n("span", has ? okText : "点击或拖入" + label + "图片"), n("small", hint, { class: "v-muted" }), progress, input);
      const go = async (file) => {
        try {
          const img = await promoUpload(file, progress);
          await saveAssets({ [key]: img.id });
        } catch (e) {
          notice(e.message);
        }
      };
      input.addEventListener("change", () => input.files[0] && go(input.files[0]));
      drop.addEventListener("dragover", (e) => (e.preventDefault(), drop.classList.add("is-over")));
      drop.addEventListener("dragleave", () => drop.classList.remove("is-over"));
      drop.addEventListener("drop", (e) => {
        e.preventDefault();
        drop.classList.remove("is-over");
        const f = e.dataTransfer.files[0];
        if (f) void go(f);
      });
      box.append(head, drop);
      if (has && assets?.[key])
        box.append(
          link("改用机构默认" + (key === "logo_key" ? " Logo" : "二维码"), () => saveAssets({ [key]: null })),
        );
      left.append(box);
    };
    picker("机构 Logo", "logo_key", "已上传，点这里更换", "PNG / JPG，不超过 2MB");
    picker("招生二维码", "qr_key", "已上传，点这里更换", "微信或企业微信二维码，正方形，PNG / JPG，不超过 2MB");
    // 二维码旁文字（P6）：最多 12 个字，所有海报共用；还没上传过素材也可以先填。
    {
      const f = UI.field({ label: "二维码旁的文字", value: assets?.qr_caption || "" });
      f.input.maxLength = 12;
      f.input.placeholder = "扫码咨询试听";
      left.append(f.element, n("small", "最多 12 个字，所有海报共用", { class: "v-muted" }), button("保存文字", () => {
          const text = f.input.value.trim();
          if ([...text].length > 12) return notice("二维码旁的文字最多 12 个字");
          return saveAssets({ qr_caption: text });
        }));
    }
    // 右：招生物料
    const right = n("section", null, { class: "v-pr-gallery" });
    const all = data.items.filter((r) => r.preview);
    const head = n("div", null, { class: "v-pr-sec-head" });
    head.append(n("h2", "招生物料 " + all.length + " 张"));
    const big = n("div", null, { class: "v-panel v-pr-big" });
    const thumbs = n("div", null, { class: "v-pr-thumbs" });
    const made = [];
    let current = 0;
    const showBig = (i) => {
      current = i;
      const m = made[i];
      for (const [j, t] of [...thumbs.children].entries()) t.classList.toggle("is-on", j === i);
      big.replaceChildren();
      if (!m) return big.append(n("p", "正在合成…", { class: "v-muted" }));
      const img = n("img", null, { src: m.url, alt: m.row.title, class: "v-pr-bigimg" });
      const ops = n("div", null, { class: "v-pr-side-ops" });
      ops.append(
        button("下载这张", async () => (save(m.url, m.row.title + ".png"), event(m.row.id, m.row.preview.id, "download"))),
        button("分享", async () => (await share(m, m.row.title)) && event(m.row.id, m.row.preview.id, "save")),
        button("已保存", async () => (await event(m.row.id, m.row.preview.id, "save"), notice("已记录保存", "success"))),
      );
      big.append(img, ops, n("p", "“分享”在手机浏览器中调起系统分享，可直接发到微信；在微信里打开时请长按图片保存。", { class: "v-muted v-pr-note" }));
    };
    head.append(
      button(
        "一键下载全部（" + all.length + " 张）",
        async () => {
          for (const m of made.filter(Boolean)) {
            save(m.url, m.row.title + ".png");
            await event(m.row.id, m.row.preview.id, "download");
            await new Promise((r) => setTimeout(r, 400));
          }
        },
        "primary",
      ),
    );
    all.forEach((r, i) => {
      const t = n("button", null, { type: "button", class: "v-pr-thumb" });
      t.append(n("span", null, { class: "v-pr-thumb-img is-loading" }), n("strong", r.title), n("small", r.is_read ? "" : "新", { class: "v-muted" }));
      t.addEventListener("click", () => showBig(i));
      thumbs.append(t);
    });
    right.append(head);
    const body = n("div", null, { class: "v-pr-gallery-body" });
    body.append(big, thumbs);
    right.append(body);
    grid.append(left, right);
    c.append(grid);
    if (!all.length) big.append(n("p", "艺界星途还没有推送招生物料。", { class: "v-muted" }));
    for (const [i, r] of all.entries()) {
      try {
        made[i] = { ...(await compose(r.preview, ctx)), row: r };
        const slot = thumbs.children[i]?.querySelector(".v-pr-thumb-img");
        slot?.classList.remove("is-loading");
        slot?.append(n("img", null, { src: made[i].url, alt: "" }));
        if (i === current) showBig(i);
      } catch {}
    }
  }

  // ---------- 挂到原入口 ----------
  // ---------- 日常页面里的推送（今天页推荐卡、铃铛分组、招生“新 N”） ----------
  let pendingOpen = null;
  // 从今天页或铃铛打开某条推广内容：切到“推广中心”再打开详情，左侧菜单高亮正确。
  function openPromo(id) {
    const content = document.querySelector(".v-content");
    if (globalThis.location?.hash?.slice(1) === "enrol-promo" && content) return promoDetailV(content, id);
    pendingOpen = id;
    globalThis.location.hash = "enrol-promo";
  }
  function thumb(key, cls) {
    const box = n("span", null, { class: "v-pr-thumb" + (cls ? " " + cls : ""), "aria-hidden": "true" });
    if (key)
      load(key)
        .then((img) => img && box.append(n("img", null, { src: img.src, alt: "" })))
        .catch(() => {});
    else box.append(UI.icon("bell")), box.classList.add("is-icon");
    return box;
  }
  const whenShort = (v) => {
    if (v === undefined || v === null || v === "") return "";
    const d = dayOf(v);
    return (d === todayBJ() ? "今天" : d.slice(5)) + " " + hm(v);
  };
  // 今天页右栏的小卡片：一次一条；先占位、拿到内容再显示，不拖慢今天页。
  function recommend() {
    const box = n("section", null, { class: "v-panel v-pr-rec", hidden: "", "aria-label": "艺界星途推荐" });
    (async () => {
      let item;
      try {
        const early = globalThis.__promoRec;
        globalThis.__promoRec = null;
        item = (await (early || api("promo/recommend")))?.item;
      } catch {
        return;
      }
      if (!item) return;
      const body = n("div", null, { class: "v-pr-rec-body" });
      const tags = n("p", null, { class: "v-pr-rec-tags" });
      tags.append(n("span", item.reason === "deadline" ? "艺界星途推荐 · 即将截止申请" : "艺界星途推荐"));
      if (item.type === "course" && isFree(item)) tags.append(n("span", "免费", { class: "v-pr-free" }));
      body.append(tags, n("h3", item.title));
      const meta = [];
      if (item.first_start) meta.push(mdw(item.first_start) + " " + hm(item.first_start));
      if (item.type === "course") meta.push(item.format === "lecture" ? "线上讲座" : "线上");
      if (item.type === "course" && item.course_status === "recruiting" && item.apply_deadline) meta.push(deadlineText(item));
      if (meta.length) body.append(n("p", meta.join(" · "), { class: "v-pr-rec-meta" + (item.reason === "deadline" ? " is-soon" : "") }));
      if (item.summary) body.append(n("p", item.summary, { class: "v-pr-rec-sum" }));
      const ops = n("div", null, { class: "v-pr-rec-ops" });
      ops.append(
        button("看详情", () => openPromo(item.id), "primary"),
        button("不再提示", async () => {
          await api("promo/" + item.id + "/dismiss", "POST", {});
          box.classList.add("is-leaving");
          setTimeout(() => box.remove(), 220);
          notice("这条内容不再在今天页提示，可在“招生 · 推广中心”里随时查看", "success");
        }),
      );
      body.append(ops);
      box.append(thumb(item.cover || item.detail_image_key, "v-pr-thumb--rec"), body);
      box.hidden = false;
    })();
    return box;
  }
  // 左侧“招生”旁的“新 N”：来自艺界星途的未读条数（铃铛接口已按权限裁剪，没有推广权限时为 0）。
  function navBadge(data) {
    const count = (data?.items || []).filter((x) => x.source === "fengqin" && !x.is_read).length;
    for (const item of document.querySelectorAll('.v-nav [data-group="enrol"], .v-tabbar [data-group="enrol"]')) {
      item.querySelector(".v-nav-new")?.remove();
      if (count) (item.querySelector(".ui-button-face") || item).append(n("span", "新 " + count, { class: "v-nav-new" }));
    }
  }
  // 铃铛：分组“来自艺界星途 / 系统”。
  const oldMessages = systemMessages;
  async function messages(c, banner = false, offset = 0) {
    const panel = c?.classList?.contains("c1-message-panel");
    if (banner || !(panel || inPage(c))) return oldMessages(c, banner, offset);
    const data = await api("system-messages?offset=" + offset);
    const badge = document.querySelector(".c1-unread-badge");
    if (badge) {
      badge.textContent = String(data.unread_count || 0);
      badge.hidden = !data.unread_count;
    }
    navBadge(data);
    const items = data.items || [];
    c.replaceChildren();
    if (panel) c.classList.add("v-msgs");
    const head = n("div", null, { class: "v-msgs-head" });
    head.append(n(panel ? "h2" : "h1", "通知"), n("span", null, { class: "v-spacer" }));
    const unread = items.filter((x) => !x.is_read);
    if (unread.length)
      head.append(
        link("全部标为已读", async () => {
          for (const x of unread) await api("system-messages/" + x.id + "/read", "POST", {});
          await messages(c, false, offset);
        }),
      );
    c.append(head);
    const read = async (x) => {
      if (!x.is_read) await api("system-messages/" + x.id + "/read", "POST", {}).catch(() => {});
    };
    const group = (title, rows, render) => {
      if (!rows.length) return;
      const g = n("section", null, { class: "v-msgs-group" });
      g.append(n("h3", title));
      for (const x of rows) g.append(render(x));
      c.append(g);
    };
    group(
      "来自艺界星途",
      items.filter((x) => x.source === "fengqin"),
      (x) => {
        const b = n("button", null, { type: "button", class: "v-msg v-msg--fq" + (x.is_read ? "" : " is-unread") });
        const t = n("span", null, { class: "v-msg-text" });
        t.append(n("strong", x.title), n("small", [x.content, whenShort(x.starts_at)].filter(Boolean).join(" · ")));
        b.append(thumb(x.thumbnail_key), t, n("span", null, { class: "v-msg-dot", "aria-label": x.is_read ? "" : "未读" }));
        b.addEventListener("click", async () => {
          await read(x);
          if (panel) c.hidePopover?.();
          openPromo(x.id);
        });
        return b;
      },
    );
    group(
      "系统",
      items.filter((x) => x.source !== "fengqin"),
      (x) => {
        const b = n("button", null, { type: "button", class: "v-msg" + (x.is_read ? "" : " is-unread") });
        const t = n("span", null, { class: "v-msg-text" });
        t.append(n("strong", x.title));
        if (x.content) t.append(n("small", x.content, { class: "preserve-text" }));
        b.append(t, n("span", whenShort(x.starts_at), { class: "v-msg-time" }), n("span", null, { class: "v-msg-dot", "aria-label": x.is_read ? "" : "未读" }));
        b.addEventListener("click", async () => {
          if (x.is_read) return;
          await read(x);
          await messages(c, false, offset);
        });
        return b;
      },
    );
    if (!items.length) c.append(n("p", "暂无通知", { class: "v-empty-line" }));
    if (!panel) {
      if (offset) c.append(button("上一页", () => messages(c, false, offset - 200)));
      if (items.length >= 200) c.append(button("下一页", () => messages(c, false, offset + 200)));
    }
  }
  systemMessages = messages;
  const inPage = (c) => !!c?.closest?.(".v-content");
  const oldCenter = promoCenter,
    oldDetail = promoDetail;
  promoCenter = (c, type, offset) => (inPage(c) ? home(c, type) : oldCenter(c, type, offset));
  promoDetail = (c, id) => (inPage(c) ? promoDetailV(c, id) : oldDetail(c, id));
  globalThis.ChannelV2Promo = { home, promoDetailV, brandPage, compose, classNotice, recommend, navBadge, openPromo };
})();
