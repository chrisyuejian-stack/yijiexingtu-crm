import { platformCommand } from "./tenant-lifecycle.js";
import { repo } from "./repo.js";
import {
  fail,
  now,
  randomId,
  string,
  integer,
  version,
  object,
  sha,
} from "./core.js";
import { can } from "./permissions.js";
import { moneyIn } from "./numbers.js";
import { decrypt } from "./crypto.js";
export const PROMO_LABELS = {
  types: { message: "消息", material: "物料", course: "课程与讲座" },
  applications: {
    applied: "已申请",
    following: "跟进中",
    confirmed: "已确认",
    opened: "已开班",
    failed: "未成班",
    withdrawn: "已撤回",
  },
  courses: {
    recruiting: "招募中",
    opened: "已开班",
    running: "进行中",
    ended: "已结束",
    failed: "未成班",
  },
};
const need = (user, policy, action = "read") => {
  if (!can(user, policy, "promo", action)) fail(403, "无此权限");
};
const stamp = (user, data) => ({
  created_at: now(),
  created_by: user.id,
  updated_at: now(),
  updated_by: user.id,
  version: 1,
  deleted_at: null,
  ...data,
});
const change = (table, data, old = null) => ({
  table,
  data,
  before: old,
  ...(old ? { mode: "update", expected: old.version } : {}),
});
const edit = (old, patch) => ({
  ...old,
  ...patch,
  version: old.version + 1,
  updated_at: now(),
});
function epoch(v, label) {
  return integer(v, label, 0, 9000000000000);
}
function offset(url) {
  return integer(
    Number(url.searchParams.get("offset") || 0),
    "分页",
    0,
    1000000,
  );
}
function time(v) {
  string(v, "课程时间", 32);
  if (
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d(?:\+08:00)?$/.test(v) ||
    !Number.isFinite(Date.parse(v.slice(0, 16) + "+08:00"))
  )
    fail(400, "课程时间不正确");
  return v.slice(0, 16) + "+08:00";
}
function safeUrl(v) {
  if (!v) return "";
  string(v, "会议链接", 1000);
  let u;
  try {
    u = new URL(v);
  } catch {
    fail(400, "会议链接不正确");
  }
  if (
    u.protocol !== "https:" ||
    !(
      u.hostname === "meeting.tencent.com" ||
      u.hostname.endsWith(".meeting.tencent.com")
    ) ||
    u.username ||
    u.password
  )
    fail(400, "请使用腾讯会议HTTPS链接");
  return u.href;
}
function wholeYuan(value) {
  if (typeof value === "number" && !Number.isInteger(value))
    fail(400, "请填写整数元");
  return moneyIn(value);
}
function courseFormat(value) {
  if (value !== "course" && value !== "lecture") fail(400, "课程形式不正确");
  return value;
}
function flag(value) {
  if (![0, 1, false, true].includes(value)) fail(400, "免费状态不正确");
  return Number(value);
}
function dueAmount(app, course) {
  return !course?.is_free &&
    app.confirmed_size > 0 &&
    ["confirmed", "opened"].includes(app.status) &&
    app.seat_price != null
    ? (app.confirmed_size * app.seat_price) / 100
    : null;
}
async function longImage(r, id) {
  if (!id) fail(400, "请上传课程详情长图");
  const key = await imageRef(r, id);
  if ((await r.promoImage(key)).width !== 750)
    fail(400, "课程详情长图宽度须为750像素");
  return key;
}
function priceDTO(row, user, policy) {
  if (!row) return row;
  const out = { ...row };
  if (out.course_status === "opened" && out.first_start) {
    if (Number(out.last_end) <= now()) out.course_status = "ended";
    else if (Date.parse(out.first_start) <= now())
      out.course_status = "running";
  }
  delete out.consultant_note;
  delete out.paid_by;
  for (const k of ["seat_price", "suggested_price"]) {
    if (can(user, policy, "tuition", "read")) {
      if (out[k] != null) out[k] /= 100;
    } else delete out[k];
  }
  return out;
}
async function visible(r, id) {
  const rows = await r.promoVisible(id);
  if (!rows[0]) fail(404, "不存在");
  return rows[0];
}
async function imageRef(r, id, tenantId = null) {
  if (id == null || id === "") return null;
  const row = await r.promoImage(id);
  if (!row || row.ready !== 1 || row.tenant_id !== (tenantId || "platform"))
    fail(400, "图片不存在或不属于当前范围");
  return id;
}
function slots(value, width, height) {
  object(value);
  const out = {};
  for (const key of ["logo", "qr", "text"]) {
    const v = object(value[key]);
    const x = integer(v.x, "横坐标", 0, width),
      y = integer(v.y, "纵坐标", 0, height),
      w = integer(v.width, "宽度", 1, width),
      h = integer(v.height, "高度", 1, height);
    if (x + w > width || y + h > height) fail(400, "占位框超出图片");
    out[key] = { x, y, width: w, height: h };
    if (key === "text") {
      out[key].font_size = integer(v.font_size || 28, "字号", 10, 160);
      out[key].color = /^#[\da-f]{6}$/i.test(v.color) ? v.color : "#222222";
      out[key].align = ["left", "center", "right"].includes(v.align)
        ? v.align
        : "left";
    }
  }
  return JSON.stringify(out);
}
async function detail(r, c, user, policy) {
  const [posters, sessions, apps, brand, contacts] = await Promise.all([
    r.promoList("posters", c.id),
    c.course_id ? r.promoList("sessions", c.course_id) : [],
    c.course_id ? r.promoList("applications", c.course_id) : [],
    r.brand(),
    r.promoContacts(),
  ]);
  const assets = await r.promoGet("tenant_promo_assets", "brand");
  return {
    campaign: priceDTO(c, user, policy),
    posters: posters.map((p) => ({ ...p, slots: JSON.parse(p.slots) })),
    sessions,
    materials: [
      ...posters.map((p) => ({
        kind: "poster",
        id: p.id,
        image_key: p.image_key,
      })),
      ...(c.detail_image_key
        ? [{ kind: "long_image", image_key: c.detail_image_key }]
        : []),
    ],
    application: apps[0]
      ? {
          ...priceDTO(apps[0], user, policy),
          ...(c.is_free || can(user, policy, "tuition", "read")
            ? { amount_due: dueAmount(apps[0], c) }
            : {}),
        }
      : null,
    assets,
    brand: {
      display_name: brand.display_name,
      logo: brand.logo,
      consultant_qr: brand.consultant_qr,
    },
    contacts,
  };
}
function imageInfo(data) {
  const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(data);
  if (!m) fail(400, "仅支持PNG、JPEG、WebP");
  let b;
  try {
    b = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
  } catch {
    fail(400, "图片格式错误");
  }
  if (b.length < 24 || b.length > 2097152) fail(400, "图片须小于2MB");
  let width = 0,
    height = 0;
  const dv = new DataView(b.buffer);
  if (
    m[1] === "png" &&
    [137, 80, 78, 71, 13, 10, 26, 10].every((x, i) => b[i] === x) &&
    String.fromCharCode(...b.slice(12, 16)) === "IHDR"
  ) {
    width = dv.getUint32(16);
    height = dv.getUint32(20);
  } else if (
    m[1] === "jpeg" &&
    b[0] === 255 &&
    b[1] === 216 &&
    b.at(-2) === 255 &&
    b.at(-1) === 217
  ) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 255) break;
      const marker = b[i + 1],
        len = dv.getUint16(i + 2);
      if ([192, 193, 194].includes(marker)) {
        height = dv.getUint16(i + 5);
        width = dv.getUint16(i + 7);
        break;
      }
      if (len < 2) break;
      i += len + 2;
    }
  } else if (
    m[1] === "webp" &&
    String.fromCharCode(...b.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...b.slice(8, 12)) === "WEBP"
  ) {
    const fmt = String.fromCharCode(...b.slice(12, 16));
    if (fmt === "VP8X") {
      width = 1 + b[24] + (b[25] << 8) + (b[26] << 16);
      height = 1 + b[27] + (b[28] << 8) + (b[29] << 16);
    } else if (
      fmt === "VP8 " &&
      b.length >= 30 &&
      b[23] === 157 &&
      b[24] === 1 &&
      b[25] === 42
    ) {
      width = dv.getUint16(26, true) & 16383;
      height = dv.getUint16(28, true) & 16383;
    } else if (fmt === "VP8L" && b.length >= 25 && b[20] === 47) {
      const bits = dv.getUint32(21, true);
      width = (bits & 16383) + 1;
      height = ((bits >>> 14) & 16383) + 1;
    } else fail(400, "WebP图片头无效");
  }
  if (!width || !height || width * height > 64000000)
    fail(400, "图片尺寸无效或像素过大");
  return { mime: "image/" + m[1], width, height, bytes: b.length };
}
async function imageApi(req, env, r, user, tenantId, path, body) {
  const match = /\/images(?:\/(img_[a-f0-9]{24}))?(?:\/(part|complete))?$/.exec(
    path,
  );
  if (!match) fail(404, "不存在");
  const id = match[1],
    op = match[2];
  if (!env.CHANNEL_MEDIA) fail(503, "推广图片存储未配置");
  if (!id && req.method === "POST") {
    const d = await body(req),
      row = {
        id: randomId("img"),
        tenant_id: tenantId || "platform",
        owner_id: user.id,
        kind: tenantId ? "brand" : string(d.kind || "content", "图片用途", 20),
        mime: null,
        width: null,
        height: null,
        parts: 0,
        part_keys: "[]",
        bytes: 0,
        ready: 0,
        version: 1,
        created_at: now(),
      };
    await r.promoCommit([change("promo_images", row)], user, "创建图片上传");
    return { id: row.id };
  }
  const row = await r.promoImage(id);
  if (!row) fail(404, "不存在");
  const prefix = "promo/" + (row.tenant_id || "platform") + "/" + id;
  if (req.method === "GET" && !op) {
    if (row.ready !== 1) fail(404, "不存在");
    if (tenantId && row.tenant_id !== tenantId) {
      if (row.tenant_id !== "platform") fail(404, "不存在");
      if (!(await r.promoImageVisible(id))) fail(404, "不存在");
    }
    const data = await env.CHANNEL_MEDIA.get(prefix + "/image");
    if (!data) fail(404, "不存在");
    const raw = (await data.text()).split(",")[1];
    const decoded = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
    env.__cacheControl = "private, max-age=86400, immutable";
    return new Response(
      decoded,
      {
        headers: {
          "Content-Type": row.mime,
          Vary: tenantId ? "Cookie" : "Cookie, Cf-Access-Jwt-Assertion",
        },
      },
    );
  }
  if (
    req.method !== "POST" ||
    row.owner_id !== user.id ||
    row.tenant_id !== (tenantId || "platform") ||
    row.ready
  )
    fail(404, "不存在");
  if (now() - row.created_at >= 86400000)
    fail(409, "上传任务已过期，请重新上传");
  const d = await body(req);
  if (op === "part") {
    const index = integer(d.index, "分片", 0, 5);
    string(d.data, "图片分片", 500000, 1);
    if (
      !/^[A-Za-z0-9+/=:;,\w-]+$/.test(d.data) ||
      index !== row.parts ||
      row.bytes + d.data.length > 2800000
    )
      fail(400, "图片分片顺序或大小不正确");
    const chunkKey =
      prefix +
      "/part/" +
      index +
      "/" +
      randomId("chunk") +
      "/" +
      encodeURIComponent(await sha(d.data));
    await env.CHANNEL_MEDIA.put(chunkKey, d.data);
    try {
      await r.promoCommit(
        [
          change(
            "promo_images",
            {
              ...row,
              parts: row.parts + 1,
              part_keys: JSON.stringify([
                ...JSON.parse(row.part_keys),
                chunkKey,
              ]),
              version: row.version + 1,
              bytes: row.bytes + d.data.length,
            },
            row,
          ),
        ],
        user,
        "暂存推广图片",
      );
    } catch (error) {
      await env.CHANNEL_MEDIA.delete(chunkKey);
      throw error;
    }
    return { parts: row.parts + 1 };
  }
  if (op === "complete") {
    let data = "";
    for (let i = 0; i < row.parts; i++) {
      const part = await env.CHANNEL_MEDIA.get(JSON.parse(row.part_keys)[i]);
      if (!part) fail(409, "分片缺失，请重新上传");
      data += await part.text();
    }
    const info = imageInfo(data);
    if (!tenantId && row.kind === "poster" && info.width !== 1080)
      fail(400, "海报底图宽度须为1080");
    await env.CHANNEL_MEDIA.put(prefix + "/image", data);
    try {
      await r.promoCommit(
        [
          change(
            "promo_images",
            { ...row, ...info, ready: 1, version: row.version + 1 },
            row,
          ),
        ],
        user,
        "完成推广图片",
      );
    } catch (error) {
      const current = await r.promoImage(id);
      if (!current || current.ready === -1)
        await env.CHANNEL_MEDIA.delete(prefix + "/image");
      throw error;
    }
    for (let i = 0; i < row.parts; i++)
      await env.CHANNEL_MEDIA.delete(JSON.parse(row.part_keys)[i]);
    return { id, ...info };
  }
  fail(404, "不存在");
}
export async function promoTenant(req, env, t, user, policy, path, url, body) {
  need(
    user,
    policy,
    req.method === "GET" || /\/(read|event)$/.test(path) ? "read" : "update",
  );
  const r = repo(env, t.id);
  r.promoReader(user.id);
  if (path.startsWith("/api/promo/images"))
    return imageApi(req, env, r, user, t.id, path, body);
  if (path === "/api/promo/recommend" && req.method === "GET") {
    const choice = await r.promoRecommendation(user.id);
    if (!choice) return { item: null };
    const [row] = await r.promoVisible(choice.id);
    return {
      item: row
        ? { ...priceDTO(row, user, policy), reason: choice.reason }
        : null,
    };
  }
  if (path === "/api/promo" && req.method === "GET") {
    const type = url.searchParams.get("type");
    if (type && !Object.hasOwn(PROMO_LABELS.types, type))
      fail(400, "类型不正确");
    const rows = await r.promoVisible(null, offset(url), type),
      previews = await r.promoPreviewTemplates(rows.map((x) => x.id)),
      brand = await r.brand(),
      assets = await r.promoGet("tenant_promo_assets", "brand");
    return {
      items: rows.map((row) => ({
        ...priceDTO(row, user, policy),
        preview:
          previews
            .filter((x) => x.campaign_id === row.id)
            .map((x) => ({ ...x, slots: JSON.parse(x.slots) }))[0] || null,
      })),
      assets,
      brand: {
        display_name: brand.display_name,
        logo: brand.logo,
        consultant_qr: brand.consultant_qr,
      },
      labels: PROMO_LABELS,
      unread_count: await r.promoUnread(user.id),
      next_offset: rows.length === 200 ? offset(url) + 200 : null,
    };
  }
  if (path === "/api/promo/assets") {
    if (req.method === "GET")
      return { assets: await r.promoGet("tenant_promo_assets", "brand") };
    if (req.method !== "PUT") fail(404, "不存在");
    const d = await body(req),
      old = await r.promoGet("tenant_promo_assets", "brand");
    const row = {
      tenant_id: t.id,
      id: "brand",
      logo_key:
        d.logo_key === undefined
          ? (old?.logo_key ?? null)
          : await imageRef(r, d.logo_key, t.id),
      qr_key:
        d.qr_key === undefined
          ? (old?.qr_key ?? null)
          : await imageRef(r, d.qr_key, t.id),
      qr_caption: string(
        d.qr_caption === undefined ? (old?.qr_caption ?? "") : d.qr_caption,
        "二维码旁文字",
        24,
        0,
      ),
      updated_by: user.id,
      updated_at: now(),
      version: (old?.version || 0) + 1,
    };
    if ([...row.qr_caption].length > 12) fail(400, "二维码旁文字最多12个字");
    if (old && version(d.version) !== old.version) fail(409, "品牌已变化");
    await r.promoCommit(
      [change("tenant_promo_assets", row, old)],
      user,
      "更新推广专用品牌",
    );
    return { ok: true };
  }
  const m =
    /^\/api\/promo\/(camp_[a-f0-9]{24})(?:\/(read|dismiss|application|withdraw|roster|posters\/(poster_[a-f0-9]{24})\/event))?$/.exec(
      path,
    );
  if (!m) fail(404, "不存在");
  const c = await visible(r, m[1]),
    action = m[2];
  if (req.method === "GET" && !action) return detail(r, c, user, policy);
  if (action === "roster" && req.method === "GET" && c.course_id)
    return { items: await r.promoList("rosters", c.course_id) };
  const d = await body(req);
  if (action === "dismiss" && req.method === "POST") {
    await r.dismissPromo(c.id, user.id);
    return { ok: true };
  }
  if (action === "read" && req.method === "POST") {
    await r.promoMarkRead(c.id, user);
    return { ok: true };
  }
  if (action?.startsWith("posters/") && req.method === "POST") {
    const p = await r.promoGet("poster_templates", m[3]);
    if (!p || p.campaign_id !== c.id) fail(404, "不存在");
    if (!["view", "download", "save"].includes(d.action))
      fail(400, "操作不正确");
    await r.promoCommit(
      [
        change("poster_outputs", {
          tenant_id: t.id,
          id: randomId("out"),
          template_id: p.id,
          user_id: user.id,
          action: d.action,
          at: now(),
        }),
      ],
      user,
      "海报" + d.action,
    );
    return { ok: true };
  }
  if (!c.course_id) fail(404, "不存在");
  const old = (await r.promoList("applications", c.course_id))[0],
    course = await r.promoGet("partner_courses", c.course_id);
  if (action === "application" && ["POST", "PUT"].includes(req.method)) {
    if (d.unsure !== undefined && typeof d.unsure !== "boolean")
      fail(400, "请选择预计人数或还不清楚");
    if (course.status !== "recruiting" || now() > course.apply_deadline)
      fail(409, "申请已截止");
    if (old && !["applied", "following", "withdrawn"].includes(old.status))
      fail(409, "已确认的申请请联系平台处理");
    const contacts = await r.promoContacts(),
      contact = d.contact_user_id || user.id;
    if (!contacts.some((x) => x.id === contact))
      fail(400, "联系人必须是本机构在职主管或教务");
    if (old && version(d.version) !== old.version) fail(409, "申请已变化");
    const row = {
      tenant_id: t.id,
      id: old?.id || randomId("app"),
      course_id: c.course_id,
      est_size:
        d.unsure === true ? null : integer(d.est_size, "预计人数", 1, 200),
      unsure: d.unsure === true ? 1 : 0,
      contact_user_id: contact,
      note: string(d.note || "", "备注", 2000, 0),
      status: "applied",
      confirmed_size: 0,
      seat_price: null,
      consultant: "",
      consultant_note: "",
      created_at: old?.created_at || now(),
      updated_at: now(),
      version: (old?.version || 0) + 1,
    };
    await r.promoCommit(
      [change("course_applications", row, old)],
      user,
      "申请合作课程",
    );
    return { ok: true };
  }
  if (action === "withdraw" && req.method === "POST") {
    if (!old) fail(404, "不存在");
    const generated = await r.promoList("generated", course.id);
    if (
      generated.some((x) => Date.parse(x.start_at) <= now()) ||
      !["applied", "following"].includes(old.status)
    )
      fail(409, "请联系平台处理");
    if (version(d.version) !== old.version) fail(409, "申请已变化");
    await r.promoCommit(
      [change("course_applications", edit(old, { status: "withdrawn" }), old)],
      user,
      "撤回合作课程申请",
    );
    return { ok: true };
  }
  if (action === "roster" && req.method === "GET")
    return { items: await r.promoList("rosters", course.id) };
  if (action === "roster" && req.method === "PUT") {
    if (!old || old.status !== "opened") fail(409, "开班后才可登记名单");
    if (version(d.version) !== old.version) fail(409, "申请已变化");
    if (
      !Array.isArray(d.student_ids) ||
      d.student_ids.length > old.confirmed_size ||
      new Set(d.student_ids).size !== d.student_ids.length
    )
      fail(400, "名单不能重复或超过确认席位");
    const students = await r.promoStudents(d.student_ids);
    if (
      d.student_ids.some(
        (id) => !students.some((s) => s.id === id && s.status === "active"),
      )
    )
      fail(400, "学员不存在或不属于本机构");
    const rosters = await r.promoList("rosters", course.id),
      generated = await r.promoList("generated", course.id);
    const changes = [
      change("course_applications", edit(old, {}), old),
      ...rosters.map((data) => ({
        table: "partner_rosters",
        data,
        mode: "delete",
      })),
      ...d.student_ids.map((student_id) =>
        change("partner_rosters", {
          tenant_id: t.id,
          id: randomId("roster"),
          course_id: course.id,
          student_id,
          created_at: now(),
        }),
      ),
    ];
    const allParts = await r.promoParts(course.id);
    for (const l of generated.filter(
      (x) => Date.parse(x.start_at) > now() && !x.deleted_at,
    )) {
      const parts = allParts.filter((p) => p.lesson_id === l.id);
      for (const p of parts)
        changes.push({ table: "lesson_participants", data: p, mode: "delete" });
      for (const student_id of d.student_ids)
        changes.push(
          change(
            "lesson_participants",
            stamp(user, {
              tenant_id: t.id,
              id: randomId("part"),
              lesson_id: l.id,
              student_id,
              attendance: "planned",
              deducted: 0,
              package_id: null,
              makeup_for: null,
            }),
          ),
        );
    }
    await r.promoCommit(changes, user, "更新合作课程名单", [t.id]);
    return { ok: true };
  }
  fail(404, "不存在");
}
async function adminDetail(r, id) {
  const c = await r.promoGet("campaigns", id);
  if (!c) fail(404, "不存在");
  const pcs = await r.promoCourse(id),
    pc = pcs[0] || null;
  return {
    campaign: c,
    course: pc,
    sessions: pc ? await r.promoList("sessions", pc.id) : [],
    posters: (await r.promoList("posters", id)).map((p) => ({
      ...p,
      slots: JSON.parse(p.slots),
    })),
    targets: await r.promoList("targets", id),
    applications: pc ? await r.promoList("applications", pc.id) : [],
    stats: (await r.promoList("stats", id))[0],
  };
}
function adminMoney(data) {
  if (!data) return data;
  return {
    ...data,
    seat_price: data.seat_price == null ? null : data.seat_price / 100,
    suggested_price:
      data.suggested_price == null ? null : data.suggested_price / 100,
  };
}
export async function promoConsole(req, env, url, admin, body) {
  const path = url.pathname;
  if (!path.startsWith("/api/promo")) return;
  const r = repo(env, null),
    actor = { id: admin.id, name: admin.username || "系统维护" };
  if (path.startsWith("/api/promo/images"))
    return imageApi(req, env, r, actor, null, path, body);
  if (path === "/api/promo" && req.method === "GET")
    return {
      items: await r.promoList("campaigns", offset(url)),
      summary: await r.promoOverview(),
      labels: PROMO_LABELS,
    };
  if (path === "/api/promo" && req.method === "POST") {
    const d = await body(req);
    if (!Object.hasOwn(PROMO_LABELS.types, d.type)) fail(400, "内容类型不正确");
    const c = {
      id: randomId("camp"),
      type: d.type,
      title: string(d.title, "标题", 120),
      summary: string(d.summary || "", "摘要", 300, 0),
      body: string(d.body || "", "正文", 10000, 0),
      cover: await imageRef(r, d.cover),
      audience: ["all", "type", "selected"].includes(d.audience)
        ? d.audience
        : "all",
      audience_type:
        d.audience === "type" ? string(d.audience_type, "机构类型", 30) : null,
      publish_at: epoch(d.publish_at ?? now(), "发布时间"),
      expire_at: d.expire_at == null ? null : epoch(d.expire_at, "截止时间"),
      status: d.status === "published" ? "published" : "draft",
      version: 1,
      created_at: now(),
      updated_at: now(),
    };
    if (c.expire_at != null && c.expire_at <= c.publish_at)
      fail(400, "显示截止时间须晚于发布时间");
    const changes = [change("campaigns", c)];
    if (c.audience === "selected") {
      if (
        !Array.isArray(d.tenant_ids) ||
        !d.tenant_ids.length ||
        d.tenant_ids.length > 200 ||
        new Set(d.tenant_ids).size !== d.tenant_ids.length
      )
        fail(400, "请选择1至200个机构");
      const ts = await r.promoTenants(d.tenant_ids);
      if (ts.length !== d.tenant_ids.length) fail(400, "机构不存在");
      for (const tenant_id of d.tenant_ids)
        changes.push(
          change("campaign_targets", {
            tenant_id,
            id: randomId("target"),
            campaign_id: c.id,
          }),
        );
    }
    if (c.type === "course") {
      const free = flag(d.is_free ?? 0);
      const pc = {
        id: randomId("partner"),
        campaign_id: c.id,
        lecturer: string(d.lecturer, "讲师", 100),
        detail_image_key: await longImage(r, d.detail_image_key),
        format: courseFormat(d.format ?? "course"),
        is_free: free,
        seat_price: free
          ? d.seat_price == null
            ? null
            : wholeYuan(d.seat_price)
          : wholeYuan(d.seat_price),
        suggested_price: free
          ? d.suggested_price == null
            ? null
            : wholeYuan(d.suggested_price)
          : wholeYuan(d.suggested_price),
        min_size: integer(d.min_size, "最低开班人数", 1, 2000000),
        apply_deadline: epoch(d.apply_deadline, "申请截止日"),
        status: "recruiting",
        reason: "",
        version: 1,
      };
      if (
        !Array.isArray(d.sessions) ||
        !d.sessions.length ||
        d.sessions.length > 200
      )
        fail(400, "须有1至200个课次");
      changes.push(change("partner_courses", pc));
      for (const item of d.sessions) {
        const start = time(item.start_at),
          duration = integer(item.duration, "时长", 30, 60);
        if (![30, 45, 60].includes(duration)) fail(400, "只支持30/45/60分钟");
        if (Date.parse(start) <= pc.apply_deadline)
          fail(400, "课程须在申请截止后开始");
        changes.push(
          change("partner_sessions", {
            id: randomId("session"),
            course_id: pc.id,
            start_at: start,
            duration,
            meeting_no: string(item.meeting_no || "", "会议号", 100, 0),
            meeting_url: safeUrl(item.meeting_url),
            cancelled: 0,
            version: 1,
          }),
        );
      }
    }
    await r.promoCommit(changes, actor, "发布合作内容：" + c.title);
    return { id: c.id };
  }
  const m =
    /^\/api\/promo\/(camp_[a-f0-9]{24})(?:\/(posters|state|open|fail|followups|applications\/(app_[a-f0-9]{24})(?:\/(paid))?|sessions\/(session_[a-f0-9]{24})))?$/.exec(
      path,
    );
  if (!m) fail(404, "不存在");
  if (!m[2] && req.method === "DELETE") {
    const d = await body(req), v = version(d.version);
    const reason = string(d.reason, "原因", 1000);
    const op = await platformCommand(actor, d.operation_id, "delete_campaign", [m[1], v, reason]);
    return r.deleteCampaign(m[1], v, op, actor, reason);
  }
  const data = await adminDetail(r, m[1]);

  if (req.method === "GET" && !m[2])
    return {
      ...data,
      course: adminMoney(data.course),
      applications: await Promise.all(
        data.applications
          .slice(offset(url), offset(url) + 200)
          .map(async ({ contact_phone_enc, ...a }) => ({
            ...adminMoney(a),
            amount_due: dueAmount(a, data.course),
            contact_phone: contact_phone_enc
              ? await decrypt(env, contact_phone_enc, a.tenant_id + ":phone")
              : null,
          })),
      ),
      next_offset:
        data.applications.length > offset(url) + 200 ? offset(url) + 200 : null,
      application_summary: {
        ...(await r.promoAudienceStats(m[1])),
        institutions: data.applications.filter((a) => a.status !== "withdrawn")
          .length,
        estimated: data.applications
          .filter((a) => a.status !== "withdrawn")
          .reduce((n, a) => n + (a.est_size || 0), 0),
        unsure: data.applications.filter(
          (a) => a.status !== "withdrawn" && a.unsure,
        ).length,
        confirmed: data.applications
          .filter((a) => ["confirmed", "opened"].includes(a.status))
          .reduce((n, a) => n + a.confirmed_size, 0),
      },
    };
  if (m[2] === "followups" && req.method === "GET") {
    if (!data.course) fail(404, "不存在");
    const tenant = url.searchParams.get("tenant_id");
    if (tenant && !/^ten_[a-f0-9]{24}$/.test(tenant))
      fail(400, "机构编号不正确");
    const rows = await r.promoFollowups(m[1], tenant, offset(url));
    return {
      items: rows.slice(0, 200),
      next_offset: rows.length > 200 ? offset(url) + 200 : null,
    };
  }
  const d = await body(req),
    c = data.campaign,
    pc = data.course;
  if (!m[2] && req.method === "PATCH") {
    if (version(d.version) !== c.version) fail(409, "内容已变化");
    const patch = {};
    for (const [key, max] of [
      ["title", 120],
      ["summary", 300],
      ["body", 10000],
    ])
      if (d[key] !== undefined)
        patch[key] = string(d[key], key, max, key === "title" ? 1 : 0);
    if (d.cover !== undefined) patch.cover = await imageRef(r, d.cover);
    const changes = [change("campaigns", edit(c, patch), c)];
    if (pc) {
      if (version(d.course_version) !== pc.version) fail(409, "课程已变化");
      const free = flag(d.is_free ?? pc.is_free);
      if (
        free !== pc.is_free &&
        data.applications.some((a) =>
          ["confirmed", "opened"].includes(a.status),
        )
      )
        fail(409, "已有确认席位，不可修改免费状态");
      const price = (key) =>
        d[key] === undefined
          ? pc[key]
          : free && d[key] === null
            ? null
            : wholeYuan(d[key]);
      const course = edit(pc, {
        detail_image_key: await longImage(
          r,
          d.detail_image_key === undefined
            ? pc.detail_image_key
            : d.detail_image_key,
        ),
        format: courseFormat(d.format ?? pc.format),
        is_free: free,
        seat_price: price("seat_price"),
        suggested_price: price("suggested_price"),
        lecturer:
          d.lecturer === undefined
            ? pc.lecturer
            : string(d.lecturer, "讲师", 100),
      });
      if (
        !free &&
        (course.seat_price == null || course.suggested_price == null)
      )
        fail(400, "请填写整数元");
      changes.push(change("partner_courses", course, pc));
    }
    await r.promoCommit(changes, actor, "编辑合作内容");
    return { ok: true };
  }
  if (m[2] === "state" && req.method === "PUT") {
    if (version(d.version) !== c.version) fail(409, "内容已变化");
    if (d.status === "published" && pc) await longImage(r, pc.detail_image_key);
    if (!["draft", "published", "archived"].includes(d.status))
      fail(400, "状态不正确");
    await r.promoCommit(
      [change("campaigns", edit(c, { status: d.status }), c)],
      actor,
      "修改合作内容显示状态",
    );
    return { ok: true };
  }
  if (m[2] === "posters" && req.method === "POST") {
    const image = await imageRef(r, d.image_key),
      meta = await r.promoImage(image);
    if (meta.width !== 1080 || !["image/png", "image/jpeg"].includes(meta.mime))
      fail(400, "底图须宽1080的PNG/JPEG");
    const old = d.id ? await r.promoGet("poster_templates", d.id) : null;
    if (d.id && (!old || old.campaign_id !== c.id)) fail(404, "不存在");
    if (old && version(d.version) !== old.version) fail(409, "海报已变化");
    const row = {
      id: old?.id || randomId("poster"),
      campaign_id: c.id,
      image_key: image,
      width: meta.width,
      height: meta.height,
      slots: slots(d.slots, meta.width, meta.height),
      version: (old?.version || 0) + 1,
    };
    await r.promoCommit(
      [
        change("poster_templates", row, old),
        change("campaigns", edit(c, {}), c),
      ],
      actor,
      "发布合作海报",
    );
    return { id: row.id };
  }
  if (!pc) fail(404, "不存在");
  if (m[2] === "followups" && req.method === "POST")
    return r.addPromoFollowup(
      c.id,
      string(d.tenant_id, "机构", 28),
      actor.id,
      string(d.text, "跟进记录", 500),
    );
  if (m[2]?.startsWith("applications/") && req.method === "PUT") {
    const old = data.applications.find((x) => x.id === m[3]);
    if (!old) fail(404, "不存在");
    delete old.contact_phone_enc;
    if (version(d.version) !== old.version) fail(409, "申请已变化");
    if (m[4] === "paid") {
      if (typeof d.paid !== "boolean") fail(400, "收款状态不正确");
      if (dueAmount(old, pc) === null) fail(409, "仅可标记已确认的收费申请");
      const paid_at = d.paid ? now() : null;
      await r.promoCommit(
        [
          change(
            "course_applications",
            edit(old, {
              paid: Number(d.paid),
              paid_by: d.paid ? actor.id : null,
              paid_at,
              updated_at: now(),
            }),
            old,
          ),
        ],
        actor,
        d.paid ? "标记合作课已收款" : "撤销合作课收款标记",
      );
      return { ok: true, paid: Number(d.paid), paid_at };
    }
    if (
      !["following", "confirmed", "failed"].includes(d.status) ||
      old.status === "withdrawn"
    )
      fail(400, "申请状态不正确");
    if (pc.status !== "recruiting" && d.status !== "failed")
      fail(409, "已开班申请只可通过平台取消处理");
    const patch = {
      status: d.status,
      confirmed_size:
        d.status === "confirmed"
          ? integer(d.confirmed_size, "确认人数", 1, 200)
          : old.confirmed_size,
      seat_price: pc.is_free
        ? null
        : d.seat_price == null
          ? pc.seat_price
          : wholeYuan(d.seat_price),
      consultant: string(d.consultant || "", "顾问", 100, 0),
      consultant_note: string(d.consultant_note || "", "跟进记录", 3000, 0),
    };
    const changes = [
      change("partner_courses", edit(pc, {}), pc),
      change("course_applications", edit(old, patch), old),
    ];
    let guards = [];
    if (d.status === "failed") {
      const generated = await repo(env, old.tenant_id).promoList(
        "generated",
        pc.id,
      );
      for (const l of generated.filter(
        (x) => Date.parse(x.start_at) > now() && !x.deleted_at,
      ))
        changes.push(change("lessons", edit(l, { deleted_at: now() }), l));
      guards = [old.tenant_id];
    }
    await r.promoCommit(
      changes,
      actor,
      d.status === "confirmed" ? "确认合作课席位" : "跟进机构合作申请",
      guards,
    );
    return { ok: true };
  }
  if (m[2] === "open" && req.method === "POST") {
    if (pc.status !== "recruiting") fail(409, "课程不在招募中");
    if (version(d.version) !== pc.version) fail(409, "课程已变化");
    if (
      !data.sessions.length ||
      data.sessions.some((x) => Date.parse(x.start_at) <= now())
    )
      fail(409, "存在已开始的课次，请先调整未来开课时间");
    return r.promoPlatformWrite("open", c, pc, actor);
  }
  if (m[2] === "fail" && req.method === "POST") {
    if (version(d.version) !== pc.version) fail(409, "课程已变化");
    return r.promoPlatformWrite(
      "fail",
      c,
      pc,
      actor,
      null,
      null,
      string(d.reason, "原因", 2000, 5),
    );
  }
  if (m[2]?.startsWith("sessions/") && req.method === "PUT") {
    const old = data.sessions.find((x) => x.id === m[5]);
    if (!old) fail(404, "不存在");
    if (version(d.version) !== old.version || Date.parse(old.start_at) <= now())
      fail(409, "课次已开始或已变化，不可改写历史");
    const start = time(d.start_at);
    if (Date.parse(start) <= now()) fail(400, "请设置未来时间");
    const duration = integer(d.duration, "时长", 30, 60);
    if (![30, 45, 60].includes(duration)) fail(400, "只支持30/45/60分钟");
    return r.promoPlatformWrite("session", c, pc, actor, old, {
      start_at: start,
      duration,
      meeting_no: string(d.meeting_no || "", "会议号", 100, 0),
      meeting_url: safeUrl(d.meeting_url),
    });
  }
  fail(404, "不存在");
}
