import { withStudentSearchKeys } from "./student-search.js";
import { VIEW_DEFAULTS } from "../shared/view.js";
import { repo } from "./repo.js";
import {
  fail,
  string,
  integer,
  randomId,
  now,
  version,
  phone,
} from "./core.js";
import { requireCan } from "./accounts.js";
import { can } from "./permissions.js";
import { encrypt, decrypt } from "./crypto.js";
import { day, prepareStudent, addStudentSummaries } from "./scheduling.js";
import { moneyOut } from "./numbers.js";
export const toolResources = {
  classes: "classes",
  class_members: "classes",
  followup_notes: "followup",
  followup_tasks: "followup",
  student_routines: "followup",
  leads: "leads",
  referrals: "referrals",
};
export const LEAD_STAGES = {
  new: "新咨询",
  contacted: "跟进中",
  trial: "已试听",
  enrolled: "已转正",
  lost: "已流失",
};
export const RENEWAL_DEFAULTS = {
  low_balance_threshold: VIEW_DEFAULTS.low_balance_threshold,
  expiry_warning_days: VIEW_DEFAULTS.expiry_warning_days,
};
export function renewalSettings(settings) {
  return Object.fromEntries(
    Object.entries(RENEWAL_DEFAULTS).map(([key, fallback]) => [
      key,
      Number.isFinite(settings[key]) ? settings[key] : fallback,
    ]),
  );
}
function staff(user) {
  if (
    !user.roles.some((r) => ["supervisor", "academic", "finance", "consultant"].includes(r))
  )
    fail(403, "没有权限");
}
async function reference(r, kind, id) {
  if (typeof id !== "string" || !id) fail(400, "缺少关联资料");
  const row = await r.businessGet(kind, id);
  if (!row) fail(404, "不存在");
  return row;
}
const text = (d, k, max = 100, required = false) =>
  string(d[k] ?? "", k, max, required ? 1 : 0);
function instant(value) {
  string(value, "北京时间", 40);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\+08:00)?$/.test(value))
    fail(400, "请填写北京时间");
  day(value.slice(0, 10));
  if (!Number.isFinite(Date.parse(value.slice(0, 16) + ":00+08:00")))
    fail(400, "时间不正确");
  return value.slice(0, 16) + "+08:00";
}
async function normalize(env, t, r, kind, d, user, old) {
  const row = { ...old, id: old?.id || randomId("rec"), deleted_at: null };
  if (
    [
      "class_members",
      "followup_notes",
      "student_routines",
      "referrals",
    ].includes(kind)
  ) {
    const student = await reference(r, "students", d.student_id);
    row.student_id = student.id;
    if (old && old.student_id !== student.id) fail(400, "不可更换关联学员");
    if (kind === "referrals") {
      row.name = student.name;
      row.grade = student.grade;
      row.direction = student.direction;
      row.intention = text(d, "intention", 1000, true);
      row.parent_phone_enc = await encrypt(
        env,
        phone(d.parent_phone),
        t.id + ":phone",
      );
      row.consent_name = text(d, "consent_name", 100, true);
      row.consent_at = instant(d.consent_at);
      if (Date.parse(row.consent_at) > now())
        fail(400, "同意时间不能晚于当前时间");
      row.consent_method = text(d, "consent_method", 100, true);
      row.consent_operator = text(d, "consent_operator", 100, true);
      row.status = "submitted";
    }
  }
  if (kind === "followup_tasks")
    row.student_id = d.student_id
      ? (await reference(r, "students", d.student_id)).id
      : null;
  if (kind === "classes") {
    row.name = text(d, "name", 100, true);
    for (const key of ["course_type_id", "teacher_id"]) row[key] = d[key];
    await reference(r, "course_types", row.course_type_id);
    await reference(r, "teachers", row.teacher_id);
    row.location_id = d.location_id || null;
    if (row.location_id) await reference(r, "locations", row.location_id);
    row.date_from = day(d.date_from);
    row.date_to = day(d.date_to);
    if (row.date_to < row.date_from) fail(400, "结束日期早于开始日期");
    row.status = d.status || "active";
    if (!["active", "archived"].includes(row.status))
      fail(400, "班级状态不正确");
    row.note = text(d, "note", 2000);
  } else if (kind === "class_members") {
    const cls = await reference(r, "classes", d.class_id);
    if (cls.status !== "active") fail(400, "班级已归档");
    const student = await reference(r, "students", row.student_id);
    if (student.status !== "active") fail(400, "学员已归档或暂停");
    row.class_id = cls.id;
    if (old && old.class_id !== row.class_id) fail(400, "不可更换班级");
    const members = await r.classMembers(row.class_id);
    if (members.some((p) => p.student_id === row.student_id && p.id !== row.id))
      fail(409, "学员已在班级中");
    if (!old && members.length >= 200) fail(400, "每班最多 200 人");
  } else if (kind === "followup_notes") {
    row.at = instant(d.at);
    row.content = text(d, "content", 6000, true);
  } else if (kind === "followup_tasks") {
    row.title = text(d, "title", 500, true);
    row.due_date = day(d.due_date);
    const completionOnly =
      old &&
      old.assignee_id === null &&
      d.assignee_id === null &&
      d.title === old.title &&
      d.due_date === old.due_date &&
      (d.student_id || null) === (old.student_id || null);
    const assignee = completionOnly ? null : await r.user(d.assignee_id);
    if (
      !completionOnly &&
      (!assignee ||
        !assignee.active ||
        !JSON.parse(assignee.roles).some((x) =>
          ["supervisor", "academic", "finance"].includes(x),
        ))
    )
      fail(404, "不存在");
    row.assignee_id = completionOnly ? null : assignee.id;
    if (![true, false, 0, 1, undefined].includes(d.done))
      fail(400, "完成状态不正确");
    row.done = d.done ? 1 : 0;
    row.legacy_owner = old?.legacy_owner || "";
  } else if (kind === "student_routines") {
    row.weekday = integer(d.weekday, "星期", 0, 6);
    row.time = text(d, "time", 70, true);
    row.content = text(d, "content", 1000, true);
  } else if (kind === "leads") {
    if (old?.student_id) fail(409, "已转正线索不可更改，请编辑学员档案");
    row.name = text(d, "name", 100, true);
    row.grade = text(d, "grade");
    row.direction = text(d, "direction");
    row.source = text(d, "source");
    row.note = text(d, "note", 6000);
    row.stage = d.stage || "new";
    if (!LEAD_STAGES[row.stage] || row.stage === "enrolled")
      fail(400, "请通过转为正式学员操作转正");
    row.next_followup = d.next_followup ? day(d.next_followup) : null;
    row.trial_at = d.trial_at ? instant(d.trial_at) : null;
    row.student_id = null;
    for (const key of ["phone", "parent_phone"]) {
      if (d[key] !== undefined)
        row[key + "_enc"] = d[key]
          ? await encrypt(env, phone(d[key]), t.id + ":phone")
          : null;
    }
    if (d.phone !== undefined)
      row.phone_last4 = d.phone ? d.phone.slice(-4) : "";
  }
  return row;
}
function safe(kind, row) {
  const out = { ...row };
  for (const k of [
    "tenant_id",
    "created_by",
    "updated_by",
    "phone_enc",
    "parent_phone_enc",
  ])
    delete out[k];
  if (kind === "leads")
    out.phone = row.phone_last4 ? "***" + row.phone_last4 : "";
  return kind === "class_members" ? withStudentSearchKeys(out) : out;
}
export async function toolsApi(req, env, t, user, policy, path, url, readBody) {
  if (
    /^\/api\/tools\/referrals(?:\/|$)/.test(path) &&
    !(await repo(env, null).referralsEnabled())
  )
    fail(403, "功能未开放");
  const r = repo(env, t.id);
  if (!path.startsWith("/api/system-messages")) staff(user);
  if (path === "/api/followup-assignees" && req.method === "GET") {
    requireCan(user, policy, "followup", "read");
    return { items: await r.followupAssignees() };
  }
  if (path === "/api/renewal-settings") {
    if (req.method === "GET") {
      requireCan(user, policy, "packages", "read");
      return { settings: renewalSettings(policy.settings) };
    }
    if (req.method === "PUT") {
      requireCan(user, policy, "accounts", "manage_settings");
      const d = await readBody(req);
      const settings = {
        low_balance_threshold: integer(
          d.low_balance_threshold,
          "低余额课时",
          0,
          10000,
        ),
        expiry_warning_days: integer(
          d.expiry_warning_days,
          "到期提醒天数",
          1,
          365,
        ),
      };
      await r.saveRenewalSettings(settings, user);
      return { ok: true };
    }
    fail(404, "不存在");
  }
  if (path === "/api/finance/receivable-summary" && req.method === "GET") {
    staff(user);
    requireCan(user, policy, "tuition", "read");
    return moneyOut(await r.receivableSummary());
  }
  if (path === "/api/search" && req.method === "GET") {
    staff(user);
    const query = string(url.searchParams.get("q") || "", "搜索", 100, 0);
    const groups = ["students", "teachers", "leads"].filter((kind) =>
      can(user, policy, kind === "teachers" ? "settings" : kind, "read"),
    );
    const matches = query ? await r.globalSearch(query, groups) : {};
    if (matches.students) matches.students = matches.students.map((row) => withStudentSearchKeys(row));
    return { groups: matches };
  }
  if (path === "/api/todo/summary" && req.method === "GET") {
    staff(user);
    requireCan(user, policy, "home", "read");
    const data = await r.todoSummary(
      new Date(now()).toLocaleDateString("sv-SE", {
        timeZone: "Asia/Shanghai",
      }),
      now(),
      renewalSettings(policy.settings),
    );
    for (const [key, module] of Object.entries({
      unchecked_lessons: "schedule",
      teacher_submissions: "attendance",
      makeup_pending: "attendance",
      makeup_recent: "attendance",
      followup_overdue: "followup",
      followup_today: "followup",
      stage_expired: "students",
      renewal_zero: "packages",
      renewal_debt: "packages",
      renewal_low: "packages",
      renewal_expiring: "packages",
    }))
      if (!can(user, policy, module, "read")) delete data[key];
    if (data.followup_today !== undefined)
      data.followup_today += data.stage_expired || 0;
    return data;
  }
  if (path === "/api/workbench" && req.method === "GET") {
    requireCan(user, policy, "home", "read");
    const date = new Date(now()).toLocaleDateString("sv-SE", {
      timeZone: "Asia/Shanghai",
    });
    const data = await r.workbench(date, renewalSettings(policy.settings));
    if (!can(user, policy, "schedule", "read")) delete data.lessons;
    else await addStudentSummaries(r, data.lessons, user);
    if (!can(user, policy, "attendance", "read")) {
      delete data.pending;
      delete data.overdue;
    }
    if (!can(user, policy, "packages", "read")) {
      delete data.renewals;
      delete data.expiring;
    }
    if (!can(user, policy, "followup", "read")) delete data.tasks;
    if (!can(user, policy, "tuition", "read")) delete data.tuition_amount;
    if (!can(user, policy, "schedule", "read")) delete data.lesson_count;
    return moneyOut(data);
  }
  if (path === "/api/renewals/remind" && req.method === "POST") {
    requireCan(user, policy, "packages", "read");
    requireCan(user, policy, "exports", "export");
    const d = await readBody(req);
    const student = string(d.student_id, "学员", 80);
    const course = string(d.course_type_id, "课程", 80);
    if (!["image", "text"].includes(d.channel)) fail(400, "提醒渠道不正确");
    if (
      !Array.isArray(d.package_ids) ||
      d.package_ids.length > 500
    )
      fail(400, "最多选择 500 个课时包");
    const ids = [
      ...new Set(d.package_ids.map((id) => string(id, "课时包", 80))),
    ];
    return {
      ok: true,
      sent_at: await r.recordRenewalReminder(
        user,
        student,
        course,
        ids,
        d.channel,
      ),
    };
  }
  if (path === "/api/renewals" && req.method === "GET") {
    requireCan(user, policy, "packages", "read");
    const date = new Date(now()).toLocaleDateString("sv-SE", {
      timeZone: "Asia/Shanghai",
    });
    const settings = renewalSettings(policy.settings);
    const offset = integer(
      Number(url.searchParams.get("offset") || 0),
      "分页",
      0,
      1000000,
    );
    const group = url.searchParams.get("group") || "";
    if (!["", "debt", "zero", "low", "expiring", "expired"].includes(group))
      fail(400, "分组不正确");
    const rows = await r.renewals(date, settings, offset, group);
    const total =
      rows[0]?.page_total ??
      (offset ? ((await r.renewals(date, settings, 0, group))[0]?.page_total ?? 0) : 0);
    return {
      items: rows.map(({ page_total, ...row }) => row),
      settings,
      total,
      next_offset: offset + 200 < total ? offset + 200 : null,
    };
  }
  if (path === "/api/renewal-brand" && req.method === "GET") {
    requireCan(user, policy, "packages", "read");
    requireCan(user, policy, "exports", "export");
    const b = await r.brand();
    await r.audit(user, "exports", "export", null, "生成续费通知");
    return {
      display_name: b.display_name,
      logo: b.logo,
      theme_color: b.theme_color,
      consultant_qr: b.consultant_qr,
      contact_text: await decrypt(env, b.contact_text, t.id + ":contact"),
    };
  }
  if (path.startsWith("/api/system-messages"))
    requireCan(user, policy, "home", "read", {
      id: user.id,
      teacher_id: user.teacher_id,
      student_id: user.student_id,
    });
  if (path === "/api/system-messages" && req.method === "GET") {
    const offset = integer(
      Number(url.searchParams.get("offset") || 0),
      "分页",
      0,
      1000000,
    );
    const promoAccess = can(user, policy, "promo", "read");
    const { items, unread: unread_count, promo } = await r.systemMessagePage(user, offset, promoAccess);
    if (promoAccess) {
      for (const row of promo)
        items.push({
          id: row.id,
          title: row.title,
          content: row.summary,
          starts_at: row.publish_at,
          source: "fengqin",
          thumbnail_key: row.cover || row.detail_image_key,
          is_read: Number(row.is_read > 0),
        });
      items.sort(
        (a, b) => b.starts_at - a.starts_at || a.id.localeCompare(b.id),
      );
    }
    return { items, unread_count };
  }
  const read = /^\/api\/system-messages\/([^/]+)\/read$/.exec(path);
  if (read && req.method === "POST") {
    await readBody(req);
    if (/^camp_[a-f0-9]{24}$/.test(read[1])) {
      requireCan(user, policy, "promo", "read");
      if (!(await r.promoVisible(read[1])).length) fail(404, "不存在");
      await r.promoMarkRead(read[1], user);
    } else await r.readMessage(read[1], user);
    return { ok: true };
  }
  const membership = /^\/api\/tools\/classes\/([^/]+)\/members$/.exec(path);
  if (membership && req.method === "POST") {
    requireCan(user, policy, "classes", "create");
    const d = await readBody(req),
      revision = await r.dataVersion();
    const cls = await reference(r, "classes", membership[1]);
    if (cls.status !== "active") fail(400, "班级已归档");
    if (
      !Array.isArray(d.student_ids) ||
      !d.student_ids.length ||
      d.student_ids.length > 200 ||
      d.student_ids.some((id) => typeof id !== "string") ||
      new Set(d.student_ids).size !== d.student_ids.length
    )
      fail(400, "学员名单不正确");
    await r.primeReferences({ studentIds: d.student_ids });
    const current = await r.classMembers(cls.id),
      added = [];
    for (const id of d.student_ids) {
      const student = await reference(r, "students", id);
      if (student.status !== "active") fail(400, "学员已归档或暂停");
      if (!current.some((x) => x.student_id === id))
        added.push({
          resource: "class_members",
          data: {
            id: randomId("rec"),
            class_id: cls.id,
            student_id: id,
            deleted_at: null,
          },
        });
    }
    if (current.length + added.length > 200) fail(400, "每班最多200人");
    if (added.length)
      await r.commitBusiness(revision, added, user, "classes", "create");
    return { added: added.length };
  }
  const m =
    /^\/api\/tools\/([a-z_]+)(?:\/([^/]+))?(?:\/(convert|contact))?$/.exec(
      path,
    );
  if (!m || !Object.hasOwn(toolResources, m[1])) fail(404, "不存在");
  const [, kind, id, operation] = m,
    module = toolResources[kind];
  if (operation === "contact" && req.method === "POST" && kind === "leads") {
    requireCan(user, policy, "accounts", "reveal_phone");
    await readBody(req);
    const row = await reference(r, kind, id);
    await r.audit(user, module, "reveal_contact", id, "查看线索联系方式");
    return {
      phone: await decrypt(env, row.phone_enc, t.id + ":phone"),
      parent_phone: await decrypt(env, row.parent_phone_enc, t.id + ":phone"),
    };
  }
  requireCan(
    user,
    policy,
    module,
    req.method === "GET"
      ? "read"
      : req.method === "POST"
        ? "create"
        : req.method === "DELETE"
          ? "delete"
          : "update",
  );
  if (req.method === "GET") {
    if (id) {
      const row = kind === "class_members"
        ? await r.pickerRecord(kind, id) : await reference(r, kind, id);
      if (!row) fail(404, "不存在");
      const result = { record: safe(kind, row) };
      if (kind === "classes")
        result.members = (await r.classMembers(id)).map((row) => withStudentSearchKeys(row));
      return result;
    }
    const offset = integer(
      Number(url.searchParams.get("offset") || 0),
      "分页",
      0,
      1000000,
    );
    const filter =
      url.searchParams.get("student_id") ||
      url.searchParams.get("class_id") ||
      null;
    if (filter)
      await reference(
        r,
        kind === "class_members" ? "classes" : "students",
        filter,
      );
    const rows = await r.toolList(kind, offset, filter);
    return {
      items: rows.map((row) => safe(kind, row)),
      next_offset: rows.length === 200 ? offset + 200 : null,
    };
  }
  const d = await readBody(req),
    revision = await r.dataVersion(),
    old = id ? await reference(r, kind, id) : null;
  if (old && version(d.version) !== old.version)
    fail(409, "记录已变更，请刷新");
  if (operation === "convert" && req.method === "POST" && kind === "leads") {
    requireCan(user, policy, "students", "create");
    if (old.student_id) return { student_id: old.student_id };
    // Shared student normalizer, with no intermediate write; conversion and new profile commit atomically.
    const student = await prepareStudent(env, t.id, r, {
      name: old.name,
      grade: old.grade,
      direction: old.direction,
      phone: await decrypt(env, old.phone_enc, t.id + ":phone"),
      parent_phone: await decrypt(env, old.parent_phone_enc, t.id + ":phone"),
    });
    await r.commitBusiness(
      revision,
      [
        { resource: "students", data: student },
        {
          resource: "leads",
          previous: old,
          data: { ...old, student_id: student.id, stage: "enrolled" },
        },
      ],
      user,
      module,
      "convert",
    );
    return { student_id: student.id };
  }
  if (operation) fail(404, "不存在");
  if ((req.method === "POST" && id) || (req.method !== "POST" && !id))
    fail(404, "不存在");
  if (kind === "referrals" && old) {
    if (
      req.method !== "PATCH" ||
      d.status !== "withdrawn" ||
      old.status !== "submitted"
    )
      fail(409, "推荐已接收或已撤回");
    await r.commitBusiness(
      revision,
      [
        {
          resource: kind,
          previous: old,
          data: { ...old, status: "withdrawn" },
        },
      ],
      user,
      module,
      "withdraw",
    );
    return { ok: true };
  }
  if (req.method === "DELETE") {
    if (kind === "classes" && (await r.classMembers(id)).length)
      fail(409, "请先移除班级成员或归档班级");
    await r.commitBusiness(
      revision,
      [{ resource: kind, previous: old, data: { ...old, deleted_at: now() } }],
      user,
      module,
      "delete",
    );
    return { ok: true };
  }
  if (!["POST", "PATCH"].includes(req.method)) fail(404, "不存在");
  const row = await normalize(env, t, r, kind, { ...old, ...d }, user, old);
  await r.commitBusiness(
    revision,
    [{ resource: kind, previous: old, data: row }],
    user,
    module,
    old ? "update" : "create",
  );
  return { id: row.id };
}
