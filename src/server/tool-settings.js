import {refreshGalleryStorage,requireGalleryCapacity,storageFull,storagePending} from './gallery-storage.js';
import {planDate} from './plan-math.js';
import { repo } from "./repo.js";

import { body, json, fail, randomId, now, version, HttpError, b64, unb64 } from "./core.js";

import { can } from "./permissions.js";

import { subjectPacks, stageRuleKeys } from "./subject-packs.js";

import { readWorkbook } from "./xlsx.js";

export const toolSettingsPath = p => /^\/api\/(?:settings\/(?:subjects|courses(?:\/[^/]+)?|stage-types|stage-rules|calendar|course-rules|report-classes|profile|brand|changes(?:\/[^/]+\/(?:approve|reject|revert))?)|gallery(?:\/[^/]+(?:\/file)?)?)$/.test(p);

const reply = (value, status = 200, headers = {}) => json(newDto(value), status, headers);

const iso = at => new Date(at + 8 * 36e5).toISOString().replace("Z", "+08:00");

export function newDto(value) {
  if (Array.isArray(value)) return value.map(newDto);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([k]) => k !== "tenant_id").map(([k, v]) => [ k, newDto(v) ]));
  return value;
}

function error(message, field = "body", code = "validation_failed", status = 422) {
  const e = new HttpError(status, message, code);
  e.details = {
    fields: [ {
      field: field,
      message: message
    } ]
  };
  throw e;
}

function str(v, key, max = 100, empty = false) {
  if (typeof v !== "string" || v.length > max || !empty && !v.trim()) error(key + "格式不正确", key);
  return v.trim();
}

function num(v, key, min, max) {
  if (!Number.isInteger(v) || v < min || v > max) error(key + "须为范围内整数", key);
  return v;
}

function bool(v, key, fallback = false) {
  if (v === undefined) return fallback;
  if (typeof v !== "boolean") error(key + "须为布尔值", key);
  return v;
}

function obj(v, key = "body") {
  if (!v || typeof v !== "object" || Array.isArray(v)) error(key + "须为对象", key);
  return v;
}

function arr(v, key, max = 200) {
  if (!Array.isArray(v) || v.length > max) error(key + "须为数组，且不超过" + max + "项", key);
  return v;
}

function strings(v, key, max = 100) {
  const a = arr(v, key, max).map(x => str(x, key, 100));
  if (new Set(a).size !== a.length) error(key + "不能重复", key);
  return a;
}

const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [ key, canonical(value[key]) ])) : value;
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

function allowed(user, policy, action = "read", kind = "settings") {
  if (!can(user, policy, kind, action, {
    settings_scope: "tools"
  })) fail(403, "没有此操作权限", "forbidden");
}

function snapshot(row, kind) {
  if (!row) return null;
  const doc = JSON.parse(row.doc_json);
  if (kind === "courses" && doc.pricing) doc.pricing = {
    ...doc.pricing,
    amount: row.price_cents / 100
  };
  return {
    ...doc,
    version: row.version,
    ...[ "courses", "stage_types", "report_classes" ].includes(kind) ? {
      id: row.id,
      source: row.source,
      active: !!row.active
    } : {}
  };
}

function emptyCollection(kind) {
  return {
    version: 1,
    ...kind === "stage_rules" ? {
      rules: {}
    } : kind === "calendar" ? {
      region: null,
      items: []
    } : kind === "course_rules" ? {
      items: []
    } : {
      introduction: "",
      features: [],
      address: "",
      class_hours: "",
      contact_phone: "",
      selling_points: [],
      teachers: []
    }
  };
}

async function current(r, kind, id = "main") {
  const row = await r.settingsGet(kind, id);
  return {
    row: row,
    doc: snapshot(row, kind) || emptyCollection(kind)
  };
}

function conflict(latest, code = "version_conflict") {
  const e = new HttpError(409, code === "change_stale" ? "设置已变化，请重新生成修改卡片" : "设置已被修改，请刷新后重试", code);
  e.details = {
    latest: newDto(latest)
  };
  throw e;
}

const raced = e => /CHECK constraint failed: expected=actual/.test(String(e?.message));

async function reference(r, kind, ids, field, refs, validationOnly = false) {
  if (!ids.length) return;
  const found = await r.settingsReferences(kind, ids);
  if (found.length !== new Set(ids).size) {
    if (validationOnly) error("引用必须属于本机构且已存在", field, "validation_failed");
    fail(404, "不存在", "not_found");
  }
  refs.push(...found.map(row => [ kind, row.id, row.version ]));
}

async function prepare(r, kind, input, id, allowRetired = false) {
  const d = obj(input), refs = [];
  let doc;
  if ([ "courses", "stage_types", "report_classes" ].includes(kind)) {
    if (!Object.hasOwn(subjectPacks, d.subject)) error("学科未开放", "subject");
    doc = {
      subject: d.subject,
      name: str(d.name, "name", 100),
      active: bool(d.active, "active", true)
    };
  }
  if (kind === "courses") {
    if (![ "one_to_one", "group", "small_class", "package", "camp" ].includes(d.form)) error("上课形式不正确", "form");
    if (d.minutes == null && !d.duration_text) error("请填写时长或时长说明", "minutes");
    const pricing = d.pricing === undefined ? null : d.pricing;
    if (pricing !== null) {
      obj(pricing, "pricing");
      if (![ "per_unit", "per_term", "per_semester", "per_month", "package" ].includes(pricing.mode)) error("计价方式不正确", "pricing.mode");
      if (typeof pricing.amount !== "number" || !Number.isFinite(pricing.amount) || pricing.amount < 0 || pricing.amount > 1e8 || Math.abs(pricing.amount * 100 - Math.round(pricing.amount * 100)) > 1e-7) error("金额最多两位小数", "pricing.amount");
      doc.pricing = {
        mode: pricing.mode,
        amount: Math.round(pricing.amount * 100) / 100
      };
      if (pricing.unit_label !== undefined) doc.pricing.unit_label = str(pricing.unit_label, "pricing.unit_label", 20);
      if (pricing.mode === "package") doc.pricing.units_per_package = num(pricing.units_per_package, "pricing.units_per_package", 1, 1e5);
    } else doc.pricing = null;
    Object.assign(doc, {
      group: str(d.group ?? "其他", "group", 50),
      form: d.form,
      minutes: d.minutes == null ? null : num(d.minutes, "minutes", 15, 480),
      duration_text: d.duration_text == null ? null : str(d.duration_text, "duration_text", 100),
      optional: bool(d.optional, "optional"),
      course_type_id: d.course_type_id ?? null
    });
    if (doc.course_type_id !== null) await reference(r, "course_types", [ str(doc.course_type_id, "course_type_id", 100) ], "course_type_id", refs);
  } else if (kind === "stage_types") {
    const range = obj(d.default_months, "default_months");
    const min = num(range.min, "default_months.min", 1, 120), max = num(range.max, "default_months.max", min, 120);
    if (![ "start", "normal", "on_node", "before_node", "after_node" ].includes(d.anchor)) error("阶段锚点不正确", "anchor");
    const node = d.anchor_node ?? null;
    if ([ "on_node", "before_node", "after_node" ].includes(d.anchor)) {
      const calendar = (await current(r, "calendar")).doc;
      if (!calendar.items.some(x => x.key === node)) error("锚点必须引用本机构节点", "anchor_node");
      // Guard the entire calendar so a concurrent deletion cannot leave a dangling anchor.
            refs.push([ "calendar", "main", calendar.version ]);
    }
    Object.assign(doc, {
      default_months: {
        min: min,
        max: max
      },
      anchor: d.anchor,
      anchor_node: node,
      offset_months: num(d.offset_months ?? 0, "offset_months", -120, 120),
      order: num(d.order ?? 0, "order", 0, 1e5)
    });
  } else if (kind === "stage_rules") {
    const rules = obj(d.rules, "rules");
    if (Object.keys(rules).length !== 5 || stageRuleKeys.some(k => typeof rules[k] !== "boolean") || Object.keys(rules).some(k => !stageRuleKeys.includes(k))) error("必须包含全部五个规则且不能有未知规则", "rules");
    doc = {
      rules: Object.fromEntries(stageRuleKeys.map(k => [ k, rules[k] ]))
    };
  } else if (kind === "calendar") {
    const items = arr(d.items, "items").map((x, i) => {
      obj(x, "items." + i);
      const months = arr(x.months, "items." + i + ".months", 12);
      if (!months.length) error("月份不能为空", "items." + i + ".months");
      const list = months.map(m => num(m, "months", 1, 12));
      if (new Set(list).size !== list.length) error("月份不能重复", "months");
      if(x.exact_date!==undefined && x.exact_date!==null) planDate(x.exact_date,"exact_date");
      return {
        ...(x.exact_date!==undefined ? {exact_date:x.exact_date} : {}),
        key: str(x.key, "key", 64),
        name: str(x.name, "name", 100),
        months: list,
        ...x.note !== undefined ? {
          note: str(x.note, "note", 500, true)
        } : {},
        ...x.next_year !== undefined ? {
          next_year: bool(x.next_year, "next_year")
        } : {}
      };
    });
    if (new Set(items.map(x => x.key)).size !== items.length) error("节点key不能重复", "items");
    doc = {
      region: d.region == null ? null : str(d.region, "region", 100, true),
      items: items
    };
    if ((await r.settingsMissingCalendarNodes(items.map(x => x.key))).length) error("节点仍被阶段引用，不能移除", "items");
  } else if (kind === "course_rules") {
    const items = arr(d.items, "items").map((x, i) => {
      obj(x, "items." + i);
      const min = x.units ? num(x.units.min, "units.min", 0, 1e5) : 0, max = x.units ? num(x.units.max, "units.max", min, 1e5) : 1e5;
      return {
        stage_type_id: str(x.stage_type_id, "stage_type_id", 100),
        required: strings(x.required ?? [], "required"),
        recommended: strings(x.recommended ?? [], "recommended"),
        exclusive: arr(x.exclusive ?? [], "exclusive").map(g => strings(g, "exclusive", 50)),
        units: {
          min: min,
          max: max
        }
      };
    });
    if (new Set(items.map(x => x.stage_type_id)).size !== items.length) error("每个阶段最多一条选课规则", "items");
    await reference(r, "stage_types", items.map(x => x.stage_type_id), "items.stage_type_id", refs, true);
    await reference(r, "courses", [ ...new Set(items.flatMap(x => [ ...x.required, ...x.recommended, ...x.exclusive.flat() ])) ], "items.courses", refs, true);
    doc = {
      items: items
    };
  } else if (kind === "report_classes") {
    const history = id ? await r.settingsDimensions(id) : [];
    const dimensions = arr(d.dimensions, "dimensions", 30).map((x, i) => {
      obj(x);
      const key = str(x.key, "dimensions.key", 64);
      if (!/^[a-z][a-z0-9_]*$/.test(key)) error("维度编号格式不正确", "dimensions.key");
      if (!allowRetired && history.some(h => h.dim_key === key && h.retired)) error("已删除的维度编号不能复用", "dimensions.key");
      return {
        key: key,
        name: str(x.name, "dimensions.name", 100),
        order: num(x.order ?? i + 1, "dimensions.order", 0, 1e5),
        feedback_tags: strings(x.feedback_tags ?? [], "feedback_tags", 30)
      };
    });
    if (!dimensions.length || new Set(dimensions.map(x => x.key)).size !== dimensions.length) error("维度不能为空或重复", "dimensions");
    const o = obj(d.options ?? {}, "options");
    Object.assign(doc, {
      dimensions: dimensions,
      options: Object.fromEntries([ "compare_previous", "mock_exam", "require_artwork", "renewal_suggestion" ].map(k => [ k, bool(o[k], k, k === "compare_previous") ]))
    });
    if(o.stats!==undefined){const keys=strings(o.stats,'options.stats',3);if(!keys.length||new Set(keys).size!==keys.length||keys.some(k=>!['lessons','attendance','repertoire_done','camp_days','mock_count','days_to_exam'].includes(k)&&!/^manual_[a-z0-9_]+$/.test(k)))error('统计配置不正确','options.stats');doc.options.stats=keys;}
  } else if (kind === "profile") {
    const teachers = arr(d.teachers ?? [], "teachers", 100).map(x => ({
      teacher_id: str(x.teacher_id, "teacher_id", 100),
      introduction: str(x.introduction, "teacher.introduction", 2e3, true)
    }));
    await reference(r, "teachers", teachers.map(x => x.teacher_id), "teachers", refs);
    doc = {
      introduction: str(d.introduction ?? "", "introduction", 5e3, true),
      features: strings(d.features ?? [], "features", 50),
      address: str(d.address ?? "", "address", 500, true),
      class_hours: str(d.class_hours ?? "", "class_hours", 500, true),
      contact_phone: str(d.contact_phone ?? "", "contact_phone", 100, true),
      selling_points: strings(d.selling_points ?? [], "selling_points", 50),
      teachers: teachers
    };
  }
  if (!doc) fail(404, "不存在", "not_found");
  if (d.applied_suggestion_ids !== undefined) doc.applied_suggestion_ids = strings(d.applied_suggestion_ids, "applied_suggestion_ids", 20);
  return {
    doc: doc,
    refs: refs
  };
}

async function save(r, kind, id, d, actor) {
  const old = await r.settingsGet(kind, id);
  const catalog = [ "courses", "stage_types", "report_classes" ].includes(kind);
  if (catalog && d.version !== undefined && !old) fail(404, "不存在", "not_found");
  if (old || !catalog) if (version(d.version) !== (old?.version || 1)) conflict(snapshot(old, kind) || emptyCollection(kind));
  const next = await prepare(r, kind, d, id);
  try {
    await r.settingsWrite(kind, id, next.doc, old, actor, next.refs);
  } catch (e) {
    if (raced(e)) conflict((await current(r, kind, id)).doc);
    if (/UNIQUE constraint failed/.test(String(e?.message))) error("同学科名称重复", "name", "duplicate", 409);
    throw e;
  }
  return (await current(r, kind, id)).doc;
}

function page(url) {
  return {
    offset: num(Number(url.searchParams.get("offset") || 0), "offset", 0, 1e6),
    limit: num(Number(url.searchParams.get("limit") || 50), "limit", 1, 200)
  };
}

function paged(rows, total, offset, limit) {
  return {
    items: rows,
    total: total,
    next_offset: offset + limit < total ? offset + limit : null
  };
}

function galleryDto(row, apiBase) {
  return {
    id: row.id,
    version: row.version,
    url: apiBase + "/gallery/" + row.id + "/file",
    width: row.width,
    height: row.height,
    tags: JSON.parse(row.tags_json),
    parent_consent_media: !!row.consent,
    hidden: !!row.hidden
  };
}

function brandDto(row, apiBase) {
  return {
    version: row.version,
    name: row.display_name,
    logo: row.logo,
    login_bg: row.login_bg,
    primary_color: row.theme_color,
    qr_image_id: row.qr_image_id ?? null,
    ...row.qr_image_id ? {
      qr_url: apiBase + "/gallery/" + row.qr_image_id + "/file"
    } : {}
  };
}

async function multipart(req, max = 3 * 1024 * 1024) {
  if (req.headers.get("origin") !== new URL(req.url).origin) fail(403, "请求来源不正确", "forbidden");
  if (!/^multipart\/form-data;/.test(req.headers.get("content-type") || "")) error("请使用multipart上传", "content-type");
  const reader = req.body?.getReader();
  let size = 0, chunks = [];
  if (reader) for (;;) {
    const {done: done, value: value} = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      error("上传文件过大", "file");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.length;
  }
  try {
    return await new Response(bytes, {
      headers: {
        "content-type": req.headers.get("content-type")
      }
    }).formData();
  } catch {
    error("上传表单不正确", "file");
  }
}

export function imageInfo(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width, height, mime;
  if (bytes.length >= 33 && [ 137, 80, 78, 71, 13, 10, 26, 10 ].every((x, i) => bytes[i] === x) && String.fromCharCode(...bytes.slice(12, 16)) === "IHDR") {
    width = v.getUint32(16);
    height = v.getUint32(20);
    mime = "image/png";
  } else if (bytes.length > 12 && bytes[0] === 255 && bytes[1] === 216 && bytes.at(-2) === 255 && bytes.at(-1) === 217) {
    let at = 2;
    while (at + 9 < bytes.length) {
      if (bytes[at++] !== 255) break;
      const marker = bytes[at++];
      if (marker === 216 || marker === 217) continue;
      const len = v.getUint16(at);
      if (len < 2 || at + len > bytes.length) break;
      if ([ 192, 193, 194 ].includes(marker)) {
        height = v.getUint16(at + 3);
        width = v.getUint16(at + 5);
        break;
      }
      at += len;
    }
    mime = "image/jpeg";
  } else if (bytes.length >= 30 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") {
    const kind = String.fromCharCode(...bytes.slice(12, 16));
    if (kind === "VP8X") {
      width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16);
      height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16);
    } else if (kind === "VP8 " && bytes.length >= 30 && bytes[23] === 157 && bytes[24] === 1 && bytes[25] === 42) {
      width = v.getUint16(26, true) & 16383;
      height = v.getUint16(28, true) & 16383;
    } else if (kind === "VP8L" && bytes[20] === 47) {
      width = 1 + bytes[21] + ((bytes[22] & 63) << 8);
      height = 1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 15) << 10);
    }
    mime = "image/webp";
  }
  if (!width || !height || width > 2e4 || height > 2e4 || width * height > 4e7) error("图片格式或宽高不正确，仅支持PNG/JPEG/WebP", "file");
  return {
    width: width,
    height: height,
    mime: mime
  };
}

function changeDto(row) {
  return {
    id: row.id,
    version: row.version,
    suggestion_id: row.suggestion_id,
    status: row.status,
    payload: JSON.parse(row.payload_json),
    created_by: row.created_by,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at)
  };
}

const entities = {
  course: "courses",
  price: "courses",
  stage_type: "stage_types",
  stage_rule: "stage_rules",
  calendar: "calendar",
  course_rule: "course_rules",
  report_class: "report_classes"
};

const mutableFields = {
  courses: [ "name", "group", "form", "minutes", "duration_text", "pricing", "optional", "course_type_id", "active" ],
  stage_types: [ "name", "default_months", "anchor", "anchor_node", "offset_months", "order", "active" ],
  stage_rules: stageRuleKeys,
  calendar: [ "name", "months", "note", "next_year", "exact_date" ],
  course_rules: [ "required", "recommended", "exclusive", "units" ],
  report_classes: [ "name", "dimensions", "options", "active" ]
};

async function changeTargets(r, payload, sourceVersions = {}) {
  const ops = arr(obj(payload).ops, "ops", 30);
  if (!ops.length) error("修改内容不能为空", "ops");
  const targets = new Map;
  for (const op of ops) {
    obj(op);
    const kind = entities[op.entity];
    if (!kind || op.op !== "update") error("不支持的修改实体或操作", "ops");
    if (!Object.hasOwn(op,"from") || !Object.hasOwn(op,"to")) error("修改项必须包含from与to", "ops");
    if (!mutableFields[kind].includes(op.field) || op.entity === "price" && op.field !== "pricing") error("不允许修改这个字段", "ops.field");
    const id = [ "stage_rules", "calendar", "course_rules" ].includes(kind) ? "main" : str(op.id, "ops.id", 100), key = kind + ":" + id;
    if (!targets.has(key)) {
      const old = await current(r, kind, id);
      if (!old.row && [ "courses", "stage_types", "report_classes" ].includes(kind)) fail(404, "不存在", "not_found");
      if (sourceVersions[key] !== undefined && sourceVersions[key] !== old.doc.version) conflict(old.doc, "change_stale");
      targets.set(key, {
        kind: kind,
        id: id,
        old: old.row,
        before: structuredClone(old.doc),
        doc: structuredClone(old.doc)
      });
    }
    const target = targets.get(key);
    let record = target.doc;
    if (kind === "calendar") record = target.doc.items.find(x => x.key === op.key);
    if (kind === "stage_rules") record = target.doc.rules;
    if (kind === "course_rules") record = target.doc.items.find(x => x.stage_type_id === op.key);
    if (!record || !Object.hasOwn(op, "from") || !same(record[op.field], op.from)) conflict(target.doc, "change_stale");
    record[op.field] = structuredClone(op.to);
  }
  return [ ...targets.values() ];
}

async function changesApi(req, r, path, user, policy, url) {
  const m = /^\/api\/settings\/changes(?:\/([^/]+)\/(approve|reject|revert))?$/.exec(path);
  if (!m) return undefined;
  if (!m[1] && req.method === "POST") {
    allowed(user, policy, "propose");
    const d = await body(req), suggestion = await r.settingsSuggestionGet(str(d.suggestion_id, "suggestion_id", 100), user);
    if (!suggestion) fail(404, "不存在", "not_found");
    const targets = await changeTargets(r, d.payload, JSON.parse(suggestion.doc_json).target_versions || {});
    // Validation here is structural; only approval requires the supervisor's write permissions.
        for (const t of targets) await prepare(r, t.kind, t.doc, t.id);
    const id = randomId("chg");
    await r.settingsChangeCreate(id, suggestion.id, d.payload, targets.map(t => ({
      kind: t.kind,
      id: t.id,
      version: t.old?.version || 1,
      doc: t.before
    })), user);
    return reply(changeDto(await r.settingsChange(id)), 201);
  }
  if (!user.roles.includes("supervisor")) fail(403, "只有主管可以处理修改卡片", "forbidden");
  allowed(user, policy, "write");
  if (!m[1] && req.method === "GET") {
    const {offset: offset, limit: limit} = page(url), p = await r.settingsChanges(url.searchParams.get("status"), offset, limit);
    return reply(paged(p.rows.map(changeDto), p.total, offset, limit));
  }
  if (!m[1] || req.method !== "POST") fail(404, "不存在", "not_found");
  const c = await r.settingsChange(m[1]);
  if (!c) fail(404, "不存在", "not_found");
  const action = m[2];
  await body(req);
  if (action === "revert" ? c.status !== "approved" : c.status !== "pending") fail(409, "当前状态不允许此操作", "invalid_state");
  let targets = [];
  if (action !== "reject") {
    const before = JSON.parse(c.before_json), after = JSON.parse(c.after_json || "[]");
    if (action === "approve") {
      targets = await changeTargets(r, JSON.parse(c.payload_json), Object.fromEntries(before.map(t => [ t.kind + ":" + t.id, t.version ])));
    } else for (const t of before) {
      const state = await current(r, t.kind, t.id), applied = after.find(a => a.kind === t.kind && a.id === t.id);
      if (state.doc.version !== applied?.version) conflict(state.doc, "change_stale");
      targets.push({
        kind: t.kind,
        id: t.id,
        old: state.row,
        doc: t.doc
      });
    }
    for (const t of targets) {
      allowed(user, policy, "write");
      if (t.kind === "courses" && !same(t.doc.pricing, snapshot(t.old, "courses")?.pricing ?? null)) allowed(user, policy, "write", "prices");
      const p = await prepare(r, t.kind, t.doc, t.id, action === "revert");
      t.doc = p.doc;
      t.refs = p.refs;
    }
  }
  try {
    await r.settingsChangeApply(c, targets, user, action === "approve" ? "approved" : action === "reject" ? "rejected" : "reverted");
  } catch (e) {
    if (raced(e)) conflict(changeDto(await r.settingsChange(c.id)), "change_stale");
    throw e;
  }
  return reply(changeDto(await r.settingsChange(c.id)));
}

async function importCourses(req, r, user) {
  const form = await multipart(req, 85e4);
  if (form.get("confirm") === "true") {
    const p = await r.settingsImportPreviewGet(str(form.get("preview_id"), "preview_id", 100), user);
    if (!p) fail(404, "不存在", "not_found");
    if (p.consumed) fail(409, "已经导入过这份预览", "duplicate");
    const rows = JSON.parse(p.rows_json);
    if (rows.some(x => x.errors?.length)) error("请修正全部错误后重新上传", "rows");
    try {
      await r.settingsImportCommit(p, rows.map(x => x.course), user);
    } catch (e) {
      if (raced(e)) conflict({
        price_list_rev: (await r.settingsGet("prices"))?.version || 1
      });
      if (/UNIQUE constraint failed/.test(String(e?.message))) error("课程名称重复，请重新预览", "rows", "duplicate", 409);
      throw e;
    }
    return reply({
      ok: true,
      imported: rows.length
    });
  }
  const file = form.get("file");
  if (!file || typeof file.arrayBuffer !== "function") error("请选择xlsx文件", "file");
  let input;
  try {
    input = await readWorkbook(new Uint8Array(await file.arrayBuffer()));
  } catch (e) {
    error(e.message, "file");
  }
  if (!input.length || input.length > 200) error("每次导入1–200行", "file");
  const existingNames = await r.settingsExistingCourseNames(input.map(x => x.values["课程名称"] || ""));
  const typeIds = [ ...new Set(input.map(x => x.values["排课课程ID"]).filter(Boolean)) ], types = typeIds.length ? await r.settingsReferences("course_types", typeIds) : [];
  const preparedRepo = {
    ...r,
    settingsReferences: async (kind, ids) => kind === "course_types" ? types.filter(x => ids.includes(x.id)) : r.settingsReferences(kind, ids)
  };
  const seen = new Set, rows = [];
  for (const x of input) {
    const v = x.values;
    const row = {
      row: x.index,
      errors: []
    };
    try {
      const course = {
        subject: v["学科"],
        group: v["课程组"] || "其他",
        name: v["课程名称"],
        form: v["形式"] || "one_to_one",
        minutes: v["时长分钟"] ? Number(v["时长分钟"]) : null,
        duration_text: v["时长说明"] || null,
        pricing: v["金额"] === "" || v["金额"] === undefined ? null : {
          mode: v["计价方式"] || "per_unit",
          amount: Number(v["金额"]),
          ...v["每包课时"] ? {
            units_per_package: Number(v["每包课时"])
          } : {}
        },
        course_type_id: v["排课课程ID"] || null,
        optional: v["可选费用"] === "是"
      };
      row.course = (await prepare(preparedRepo, "courses", course)).doc;
      const key = course.subject + ":" + course.name;
      if (seen.has(key) || existingNames.some(a => a.subject === course.subject && a.name === course.name)) error("课程名称重复", "课程名称");
      seen.add(key);
    } catch (e) {
      row.errors = [ {
        message: e.message,
        details: e.details || {}
      } ];
    }
    rows.push(row);
  }
  const id = randomId("imp"), rev = (await r.settingsGet("prices"))?.version || 1;
  await r.settingsImportPreview(id, rows, rev, user);
  return reply({
    preview_id: id,
    expires_in: 1200,
    rows: rows,
    can_commit: rows.every(x => !x.errors.length),
    price_list_rev: rev
  });
}

export async function toolSettingsApi(req, env, resolved, user, policy, url) {
  const path = resolved.relative;
  if (!toolSettingsPath(path)) return undefined;
  env.__identityContract = true;
  const planFile = /^\/api\/gallery\/[^/]+\/file$/.test(path) && req.method === "GET" && can(user,policy,"plans","read");
  if (!policy.modules.settings && !planFile) fail(404, "不存在", "not_found");
  const r = repo(env, resolved.tenant.id), apiBase = resolved.root ? "/api" : resolved.base.replace(/\/$/, "") + "/api";
  const c = await changesApi(req, r, path, user, policy, url);
  if (c !== undefined) return c;
  const gallery = /^\/api\/gallery(?:\/([^/]+)(\/file)?)?$/.exec(path);
  if (gallery) {
    if (planFile && !can(user,policy,"settings","read",{settings_scope:"tools"})) {
      const image = await r.planStaffMedia(gallery[1]);
      if (!image) fail(404,"不存在","not_found");
      const object = await env.CHANNEL_MEDIA.get(image.r2_key);
      if (!object) fail(404,"不存在","not_found");
      return new Response(unb64(await object.text()),{headers:{"Content-Type":image.mime,"Cache-Control":"private, max-age=60","X-Content-Type-Options":"nosniff"}});
    }
    allowed(user, policy, req.method === "GET" ? "read" : "write");
    if (!gallery[1] && req.method === "GET") {
      const {offset: offset, limit: limit} = page(url), data = await r.settingsGalleryList(url.searchParams.get("tag"), offset, limit);
      return reply({...paged(data.rows.map(x => galleryDto(x, apiBase)), data.total, offset, limit),storage:await refreshGalleryStorage(env,r)});
    }
    if (!gallery[1] && req.method === "POST") {
      const form = await multipart(req), file = form.get("file");
      if (!file || typeof file.arrayBuffer !== "function" || file.size > 2 * 1024 * 1024) error("图片最大2MB", "file");
      const bytes = new Uint8Array(await file.arrayBuffer()), info = imageInfo(bytes), tags = form.get("tags") ? (() => {
        try {
          return strings(JSON.parse(form.get("tags")), "tags", 30);
        } catch {
          error("标签须为JSON数组", "tags");
        }
      })() : [];
      const id = randomId("img"), key = "promo/" + resolved.tenant.id + "/gallery/" + id;
      if (!env.CHANNEL_MEDIA) fail(503, "图库存储未配置", "configuration_missing");
      const encoded=b64(bytes);
      await requireGalleryCapacity(env,r,encoded.length);
      await env.CHANNEL_MEDIA.put(key, encoded, {
        httpMetadata: {
          contentType: "text/plain"
        }
      });
      try {
        await r.settingsGalleryCreate({
          id: id,
          r2_key: key,
          bytes: encoded.length,
          ...info,
          tags: tags,
          consent: tags.includes("家长已同意展示")
        }, user);
      } catch (e) {
        const saved=await r.settingsGallery(id);
        if(saved?.r2_key===key)return reply(galleryDto(saved,apiBase),201);
        await env.CHANNEL_MEDIA.delete(key);
        if(raced(e)){const storage=await r.galleryStorage();if(storage.pending)storagePending(storage);if(storage.used+encoded.length>storage.limit)storageFull(storage);}
        throw e;
      }
      return reply(galleryDto(await r.settingsGallery(id), apiBase), 201);
    }
    const row = await r.settingsGallery(gallery[1], req.method === "DELETE");
    if (!row) fail(404, "不存在", "not_found");
    if (row.deleted_at && req.method === "DELETE") {
      await body(req);
      await env.CHANNEL_MEDIA.delete(row.r2_key);
      await r.galleryReleaseBytes(row.id);
      return reply({
        ok: true,
        hidden: false
      });
    }
    if (gallery[2] && req.method === "GET") {
      const image = await env.CHANNEL_MEDIA.get(row.r2_key);
      if (!image) fail(404, "不存在", "not_found");
      return new Response(unb64(await image.text()), {
        headers: {
          "Content-Type": row.mime,
          "Cache-Control": "private, max-age=60",
          "X-Content-Type-Options": "nosniff"
        }
      });
    }
    if (req.method === "PATCH" || req.method === "DELETE") {
      const d = await body(req);
      if (version(d.version) !== row.version) conflict(galleryDto(row, apiBase));
      const tags = d.tags === undefined ? JSON.parse(row.tags_json) : strings(d.tags, "tags", 30);
      let out;
      try {
        out = await r.settingsGalleryWrite(row, tags, tags.includes("家长已同意展示"), user, req.method === "DELETE");
      } catch (e) {
        if (raced(e)) conflict(galleryDto(await r.settingsGallery(row.id), apiBase));
        throw e;
      }
      if (req.method === "DELETE") {
        if (!out.kept) {await env.CHANNEL_MEDIA.delete(row.r2_key);await r.galleryReleaseBytes(row.id);}
        return reply({
          ok: true,
          hidden: out.kept
        });
      }
      return reply(galleryDto(await r.settingsGallery(row.id), apiBase));
    }
    fail(404, "不存在", "not_found");
  }
  const resource = path.slice("/api/settings/".length), kind = {
    courses: "courses",
    "stage-types": "stage_types",
    "stage-rules": "stage_rules",
    calendar: "calendar",
    "course-rules": "course_rules",
    "report-classes": "report_classes",
    profile: "profile"
  }[resource.split("/")[0]];
  if (resource === "subjects") {
    allowed(user, policy, req.method === "GET" ? "read" : "write");
    if (req.method === "POST") {
      const d = await body(req);
      if (!Object.hasOwn(subjectPacks, d.key)) error("学科未开放", "key");
      await r.settingsImportSubject(d.key, user);
    } else if (req.method !== "GET") fail(404, "不存在", "not_found");
    return reply((await r.settingsSubjects()).map(x => ({
      key: x.id,
      name: x.name || subjectPacks[x.id]?.name || x.id,
      ...(x.warnings?{warnings:x.warnings}:{}),
      pack_version: x.pack_version
    })));
  }
  if (resource === "brand") {
    allowed(user, policy, req.method === "GET" ? "read" : "write");
    const row = await r.settingsBrand();
    if (req.method === "PATCH") {
      const d = await body(req);
      if (Object.keys(d).some(k => ![ "version", "primary_color", "qr_image_id" ].includes(k))) error("机构只能修改主色与咨询二维码", "body");
      if (version(d.version) !== row.version) conflict(brandDto(row, apiBase));
      const color = d.primary_color ?? row.theme_color;
      if (!/^#[a-f0-9]{6}$/i.test(color)) error("主色格式不正确", "primary_color");
      const qr = d.qr_image_id === undefined ? row.qr_image_id ?? null : d.qr_image_id;
      if (qr !== null) {
        str(qr,"qr_image_id",100);
        const image = await r.settingsGallery(qr);
        if (!image || image.hidden && qr !== row.qr_image_id) fail(404, "不存在", "not_found");
      }
      try {
        await r.settingsBrandWrite({
          primary_color: color,
          qr_image_id: qr
        }, row, user);
      } catch (e) {
        if (raced(e)) conflict(brandDto(await r.settingsBrand(), apiBase));
        throw e;
      }
    } else if (req.method !== "GET") fail(404, "不存在", "not_found");
    return reply(brandDto(await r.settingsBrand(), apiBase));
  }
  if (!kind) fail(404, "不存在", "not_found");
  if (req.method === "GET") {
    if (kind === "courses") {
      if (!can(user, policy, "settings", "read", {
        settings_scope: "tools"
      }) && !can(user, policy, "prices", "read")) fail(403, "没有权限", "forbidden");
    } else if (kind === "report_classes" && user.roles.includes("teacher")) {
      if (!can(user, policy, "settings", "read", {
        settings_scope: "tools",
        kind: "report_dimensions"
      })) fail(403, "没有权限", "forbidden");
    } else allowed(user, policy);
  } else {
    allowed(user, policy, "write");
    if (kind === "courses") allowed(user, policy, "write", "prices");
  }
  if (resource === "courses/import" && req.method === "POST") return importCourses(req, r, user);
  const catalog = [ "courses", "stage_types", "report_classes" ].includes(kind);
  if (catalog) {
    const pathId = resource.split("/")[1];
    if (req.method === "GET") {
      if (pathId) {
        const row = await r.settingsGet(kind, pathId);
        if (!row) fail(404, "不存在", "not_found");
        const doc = snapshot(row, kind);
        if (kind === "courses" && !can(user, policy, "prices", "read")) delete doc.pricing;
        return reply(doc);
      }
      const {offset: offset, limit: limit} = page(url), p = await r.settingsList(kind, {
        subject: url.searchParams.get("subject"),
        group: url.searchParams.get("group"),
        q: url.searchParams.get("q") || "",
        inactive: url.searchParams.get("include_inactive") === "1",
        offset: offset,
        limit: limit
      });
      let rows = p.rows.map(x => snapshot(x, kind));
      if (kind === "courses" && !can(user, policy, "prices", "read")) rows = rows.map(({pricing: pricing, ...rest}) => rest);
      if (kind === "report_classes" && user.roles.includes("teacher")) rows = rows.map(({id: id, name: name, subject: subject, dimensions: dimensions, version: version}) => ({
        id: id,
        name: name,
        subject: subject,
        dimensions: dimensions,
        version: version
      }));
      return reply({
        ...paged(rows, p.total, offset, limit),
        ...kind === "courses" ? {
          price_list_rev: (await r.settingsGet("prices"))?.version || 1
        } : {}
      });
    }
    const d = await body(req), id = req.method === "POST" ? randomId(kind === "courses" ? "crs" : kind === "stage_types" ? "stg" : "rcl") : pathId || d.id;
    if (!id) error("缺少资源ID", "id");
    str(id,"id",100);
    if (![ "POST", "PUT", "DELETE" ].includes(req.method)) fail(404, "不存在", "not_found");
    const old = await r.settingsGet(kind, id);
    if (req.method === "POST" && old) fail(409, "重复资源", "duplicate");
    if (req.method !== "POST" && !old) fail(404, "不存在", "not_found");
    const next = req.method === "DELETE" ? {
      ...snapshot(old, kind),
      version: d.version,
      active: false
    } : d;
    return reply(await save(r, kind, id, next, user), req.method === "POST" ? 201 : 200);
  }
  if (req.method === "GET") {
    const state = await current(r, kind);
    delete state.doc.id;
    return reply(state.doc);
  }
  if (req.method === "PUT") {
    const result = await save(r, kind, "main", await body(req), user);
    delete result.id;
    return reply(result);
  }
  fail(404, "不存在", "not_found");
}

export async function validateSettingProposal(r,payload) {
 const targets=await changeTargets(r,payload,{});
 for(const target of targets)await prepare(r,target.kind,target.doc,target.id);
 const target_versions=Object.fromEntries(targets.map(t=>[t.kind+':'+t.id,t.old?.version||1]));
 const count=await r.settingsAffectedPlanCount();
 return {payload:{ops:payload.ops,side_effects:[],affected:{plans_in_progress:count}},target_versions};
}
