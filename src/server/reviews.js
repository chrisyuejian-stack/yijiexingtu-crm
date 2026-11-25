import {feedbackAliases,feedbackPersonal,feedbackInserts,feedbackDecisions,mergeReviewChanges} from './growth-feedback.js';
import { maxDebtUnits } from "./debt.js";
import { repo } from "./repo.js";
import { can } from "./permissions.js";
import { requireCan } from "./accounts.js";
import { fail, sha, randomId, now, version, string, integer } from "./core.js";
import { day, nextDay } from "./scheduling.js";
import { effectivePolicies } from "./absence.js";
import { reviewedAttendanceChanges, attendanceLockMonths } from "./credits.js";
import {
  ATTENDANCE_LABELS,
  lessonWindow,
  SUBMISSION_GRACE_MS,
} from "./presentation.js";
function staff(user, policy, record) {
  return can(user, policy, "attendance", "confirm", record);
}
function scopeRecord(ctx, user) {
  const l = ctx.lessons[0];
  if (l?.source_course_id) fail(403, "合作课不参与机构出勤和点评");
  if (!l) fail(404, "不存在");
  return {
    ...l,
    ...(user.roles.includes("student") &&
    ctx.participants.some((p) => p.student_id === user.student_id)
      ? { student_id: user.student_id }
      : {}),
  };
}
function ordered(rows, fields) {
  return rows
    .map((r) => fields.map((k) => r[k] ?? null))
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
}
async function attendanceFingerprint(ctx) {
  return sha(
    JSON.stringify({
      lesson: ordered(ctx.lessons, [
        "id",
        "start_at",
        "duration",
        "units",
        "teacher_id",
        "assistant_id",
        "course_type_id",
        "location_id",
        "mode",
        "status",
      ]),
      people: ordered(ctx.participants, [
        "id",
        "student_id",
        "attendance",
        "deducted",
        "package_id",
        "makeup_for",
      ]),
    }),
  );
}
async function commentFingerprint(ctx) {
  return sha(
    JSON.stringify({
      comments: ordered(ctx.comments, [
        "id",
        "student_id",
        "text",
        "homework",
        "version",
      ]),
      roster: ordered(ctx.participants, ["id", "student_id"]),
    }),
  );
}

function publicationChanges(ctx, submission, people, user) {
  const rows = [
    {
      student_id: null,
      text: submission.public_text,
      homework: submission.homework,
    },
    ...people.map((p) => ({
      student_id: p.student_id,
      text: p.comment,
      homework: "",
    })),
  ];
  return rows.map((row) => {
    const old = ctx.comments.find((c) => c.student_id === row.student_id);
    return {
      resource: "lesson_comments",
      previous: old,
      data: {
        ...old,
        id: old?.id || randomId("comment"),
        lesson_id: submission.lesson_id,
        ...row,
        published_by: user.id,
        deleted_at: null,
      },
    };
  });
}
function safeReview(r, comments) {
  return r
    ? {
        id: r.id,
        version: r.version,
        kind: r.kind,
        status: r.status,
        ...(comments
          ? { public_text: r.public_text, homework: r.homework }
          : {}),
        submitted_at: r.submitted_at,
        reason: r.reason,
      }
    : null;
}
async function context(r, user, policy, id) {
  const ctx = await r.reviewContext(
      id,
      user.roles.includes("student") ? user.student_id : null,
      staff(user, policy),
      user.roles.includes("teacher") ? user.teacher_id : null,
    ),
    record = scopeRecord(ctx, user);
  if (!can(user, policy, "lessons", "read", record)) fail(404, "不存在");
  return { ctx, record };
}
export async function reviewApi(
  req,
  env,
  tenant,
  user,
  policy,
  path,
  url,
  bodyReader,
) {
  const r = repo(env, tenant.id),
    match = /^\/api\/lessons\/([^/]+)\/(review|comments)$/.exec(path),
    decision = /^\/api\/submissions\/([^/]+)\/(confirm|return)$/.exec(path);
  if (req.method === "GET" && path === "/api/submissions") {
    requireCan(user, policy, "attendance", "confirm");
    const filter = url.searchParams.get("status") || "pending";
    if (!["pending", "returned", "overdue"].includes(filter))
      fail(400, "筛选条件不正确");
    const from = day(url.searchParams.get("from")),
      to = day(url.searchParams.get("to"));
    if (from > to || Date.parse(to) - Date.parse(from) > 366 * 86400000)
      fail(400, "最多查询一年");
    const offset = integer(
        Number(url.searchParams.get("offset") || 0),
        "分页",
        0,
        1000000,
      ),
      items = await r.reviewQueue(
        filter,
        from,
        nextDay(to),
        now(),
        SUBMISSION_GRACE_MS,
        offset,
      );
    const total =
      items[0]?.page_total ??
      (offset
        ? ((
            await r.reviewQueue(
              filter,
              from,
              nextDay(to),
              now(),
              SUBMISSION_GRACE_MS,
            )
          )[0]?.page_total ?? 0)
        : 0);
    for (const item of items) delete item.page_total;
    return {
      items,
      total,
      next_offset: offset + 200 < total ? offset + 200 : null,
    };
  }
  if (match && req.method === "GET" && match[2] === "review") {
    const { ctx, record } = await context(r, user, policy, match[1]),
      window = lessonWindow(record, now()),
      comments = can(user, policy, "comments", "read", record),
      latest = ctx.submissions[0];
    const canDraft =
      staff(user, policy, record) ||
      (user.roles.includes("teacher") && record.teacher_id === user.teacher_id);
    const participants = ctx.participants.map((p) => ({
      id: p.id,
      student_id: p.student_id,
      name: p.student_name,
      attendance: p.attendance,
      ...(user.roles.includes("teacher") ? {} : { deducted: p.deducted }),
      version: p.version,
    }));
    const growthRows=canDraft && policy.modules.growth_reports ? await r.growthReviewRows(match[1]) : [];
    return {
      ...(growthRows.some(x=>x.submission_id===latest?.id&&JSON.parse(x.doc_json).structured) ? {personal:growthRows.filter(x=>x.submission_id===latest?.id).map(x=>({...JSON.parse(x.doc_json),copied_count:x.copied_count}))} : {}),
      lesson: {
        id: record.id,
        version: record.version,
        start_at: record.start_at,
        duration: record.duration,
        units: record.units,
        status: record.status,
        course_name: record.course_name,
        course_type_id: record.course_type_id,
        teacher_name: record.teacher_name,
        location_name: record.location_name,
      },
      participants,
      published: comments
        ? ctx.comments.map((c) => ({
            id: c.id,
            student_id: c.student_id,
            text: c.text,
            homework: c.homework,
            version: c.version,
          }))
        : [],
      submission: canDraft ? safeReview(latest, comments) : null,
      people: canDraft
        ? ctx.people.map((p) => ({
            participant_id: p.participant_id,
            student_id: p.student_id,
            attendance: p.attendance,
            ...(comments ? { comment: p.comment } : {}),
          }))
        : [],
      comment_fingerprint: canDraft ? await commentFingerprint(ctx) : null,
      can_submit_attendance:
        can(user, policy, "attendance", "submit", record) &&
        window.open &&
        !ctx.settlements[0]?.locked &&
        record.status === "planned" &&
        !ctx.confirmed.length,
      can_submit_comments:
        can(user, policy, "comments", "create", record) &&
        window.open &&
        !ctx.settlements[0]?.locked &&
        record.status !== "planned",
      can_review: staff(user, policy, record),
      can_correct_comments: can(user, policy, "comments", "correct", record),
      window,
    };
  }
  if (!(
    (match &&
      ((req.method === "POST" && match[2] === "review") ||
        (req.method === "PUT" && match[2] === "comments"))) ||
    (decision && req.method === "POST")
  ))
    fail(404, "不存在");
  const d = feedbackAliases(await bodyReader(req)),
    receivedAt = now();
  if(d.personal!==undefined||d.public_comment!==undefined||d.attendance!==undefined) env.__identityContract=true;
  if (
    typeof d.operation_id !== "string" ||
    !/^[\w-]{8,100}$/.test(d.operation_id)
  )
    fail(400, "缺少有效操作编号");
  const hash = await sha(JSON.stringify({ path, user: user.id, body: d }));
  for (let retry = 0; ; retry++)
    try {
      const done = await r.creditOperation(d.operation_id);
      if (done) {
        if (done.actor_id !== user.id || done.request_hash !== hash)
          fail(409, "操作编号已使用");
        return JSON.parse(done.response_json);
      }
      const revision = await r.dataVersion(),
        review = decision
          ? await r.businessGet("lesson_submissions", decision[1])
          : null;
      if (decision && !review) fail(404, "不存在");
      const id = match?.[1] || review.lesson_id,
        { ctx, record } = await context(r, user, policy, id),
        latest = ctx.submissions[0],
        changes = [];
      const structured = policy.modules.growth_reports ? await r.growthReviewRows(id) : [];
      const personal = !decision ? await feedbackPersonal(r,d,ctx,policy,structured) : null;
      let submittedId = null;
      let result = { committed: true, lesson_id: id },
        audit = "";
      if (decision) {
        requireCan(user, policy, "attendance", decision[2], record);
        if (
          review.status !== "pending" ||
          record.current_submission_id !== review.id ||
          version(d.version) !== review.version
        )
          fail(409, "提交状态已变化，请刷新");
        if (decision[2] === "return") {
          changes.push({
            resource: "lesson_submissions",
            previous: review,
            data: {
              ...review,
              status: "returned",
              reviewed_by: user.id,
              reviewed_at: now(),
              reason: string(d.reason, "退回原因", 1000),
            },
          });
          changes.push(...feedbackDecisions(structured,review.id,false));
          audit = "return_submission";
        } else {
          await r.assertUnlocked([record.start_at.slice(0, 7)]);
          if (review.comment_fingerprint !== (await commentFingerprint(ctx)))
            fail(409, "点评已被更正，请退回后重新提交");
          if (review.kind === "attendance") {
            if (
              record.status !== "planned" ||
              review.base_fingerprint !== (await attendanceFingerprint(ctx))
            )
              fail(409, "本课出勤或排课已变更，请退回后重新提交");
            const credit = await r.creditContext(id);
            await r.primeReferences({
              typeIds: credit.lessons.map((l) => l.course_type_id),
            });
            for (const l of credit.lessons)
              l.category_id = (
                await r.businessGet("course_types", l.course_type_id)
              )?.category_id;
            await r.assertUnlocked(attendanceLockMonths(credit));
            const attendance = reviewedAttendanceChanges(
              credit,
              id,
              ctx.people,
              effectivePolicies({
                absence_policies: JSON.parse(ctx.absence_settings[0]?.value || "{}"),
              }),
              maxDebtUnits(policy.settings),
            );
            result.blocked = attendance.blocked;
            if (attendance.blocked.length === ctx.people.length)
              result.committed = false;
            else changes.push(...attendance.changes);
          }
          if (result.committed) {
            if (can(user, policy, "comments", "correct", record))
              changes.push(...publicationChanges(ctx, review,
                ctx.people.filter((person) => !result.blocked?.some((block) => block.participant_id === person.participant_id)),
                user));
            else if (
              review.public_text ||
              review.homework ||
              ctx.people.some((p) => p.comment)
            )
              fail(403, "课后点评模块未开通");
            changes.push({
              resource: "lesson_submissions",
              previous: review,
              data: {
                ...review,
                status: "confirmed",
                reviewed_by: user.id,
                reviewed_at: now(),
                reason: "",
              },
            });
          }
          if(result.committed) changes.push(...feedbackDecisions(structured,review.id,true,result.blocked||[]));
          audit = result.committed ? "confirm_submission" : "confirm_blocked";
        }
      } else if (match[2] === "comments") {
        requireCan(user, policy, "comments", "correct", record);
        if (d.comment_fingerprint !== (await commentFingerprint(ctx)))
          fail(409, "本课点评已修改，请刷新");
        const people = validatePeople(d.people, ctx, false),
          proposal = {
            lesson_id: id,
            public_text: string(d.public_text || "", "公共点评", 6000, 0),
            homework: string(d.homework || "", "作业", 4000, 0),
          };
        changes.push(...publicationChanges(ctx, proposal, people, user));
        changes.push(...feedbackInserts(policy.modules.growth_reports?(personal??[]):null,record,null,structured,proposal.public_text,proposal.homework,"confirmed",people));
        audit = "correct_comments";
      } else {
        const kind = d.kind;
        if (!["attendance", "comments"].includes(kind))
          fail(400, "提交类型不正确");
        requireCan(
          user,
          policy,
          kind === "attendance" ? "attendance" : "comments",
          kind === "attendance" ? "submit" : "create",
          record,
        );
        if (
          !user.roles.includes("teacher") ||
          record.teacher_id !== user.teacher_id
        )
          fail(403, "仅主讲教师可提交");
        if (!lessonWindow(record, receivedAt).open)
          fail(403, "提交时间为课程开始至结束后48小时（北京时间）");
        await r.assertUnlocked([record.start_at.slice(0, 7)]);
        if (
          kind === "attendance" &&
          (record.status !== "planned" || ctx.confirmed.length)
        )
          fail(409, "已确认出勤不能由教师修改，请联系教务");
        if (kind === "comments" && record.status === "planned")
          fail(409, "请先提交或确认出勤");
        if (
          (d.previous_id || null) !== (latest?.id || null) ||
          (latest && version(d.previous_version) !== latest.version)
        )
          fail(409, "本课提交已变化，请刷新");
        if (latest?.status === "pending" && latest.kind !== kind)
          fail(409, "请先处理本课待确认提交");
        const people = validatePeople(d.people, ctx, kind === "attendance"),
          public_text = string(d.public_text || "", "公共点评", 6000, 0),
          homework = string(d.homework || "", "作业", 4000, 0);
        if (
          (public_text || homework || people.some((p) => p.comment)) &&
          !can(user, policy, "comments", "create", record)
        )
          fail(403, "课后点评模块未开通");
        if (d.comment_fingerprint !== (await commentFingerprint(ctx)))
          fail(409, "本课点评已修改，请刷新");
        if (latest && ["pending", "returned"].includes(latest.status))
          changes.push({
            resource: "lesson_submissions",
            previous: latest,
            data: { ...latest, status: "superseded" },
          });
        const submitted = {
          id: randomId("submission"),
          lesson_id: id,
          kind,
          status: "pending",
          public_text,
          homework,
          base_fingerprint: await attendanceFingerprint(ctx),
          comment_fingerprint: await commentFingerprint(ctx),
          submitted_by: user.id,
          submitted_at: receivedAt,
          reviewed_by: null,
          reviewed_at: null,
          reason: "",
          deleted_at: null,
        };
        changes.push(
          { resource: "lesson_submissions", data: submitted },
          ...people.map((p) => ({
            resource: "submission_people",
            data: {
              id: randomId("proposed"),
              submission_id: submitted.id,
              ...p,
              deleted_at: null,
            },
          })),
          {
            resource: "lessons",
            previous: record,
            data: { ...record, current_submission_id: submitted.id },
          },
        );
        submittedId = submitted.id;
        const additions = feedbackInserts(policy.modules.growth_reports?(personal??[]):null,record,submitted.id,structured,public_text,homework,'pending',people);
        if(policy.settings.feedback_auto_confirm === true){
          if(kind==='attendance'){
            const credit=await r.creditContext(id);await r.primeReferences({typeIds:credit.lessons.map(l=>l.course_type_id)});
            for(const l of credit.lessons)l.category_id=(await r.businessGet('course_types',l.course_type_id))?.category_id;
            await r.assertUnlocked(attendanceLockMonths(credit));
            const confirmed=reviewedAttendanceChanges(credit,id,people,effectivePolicies({absence_policies:JSON.parse(ctx.absence_settings[0]?.value||'{}')}),maxDebtUnits(policy.settings));
            result.blocked=confirmed.blocked;result.committed=confirmed.blocked.length!==people.length;
            if(result.committed)changes.push(...confirmed.changes);
          }
          if(result.committed){
            submitted.status='confirmed';submitted.reviewed_by=user.id;submitted.reviewed_at=now();
            changes.push(...publicationChanges(ctx,submitted,people.filter(p=>!result.blocked?.some(b=>b.participant_id===p.participant_id)),user));
            for(const c of additions){if(!result.blocked?.some(b=>b.student_id===c.data.student_id)){c.data.status='confirmed';c.data.confirmed_at=now();}else c.data.status='returned';}
          }
        }
        changes.push(...additions);
        result.id = submitted.id;
        audit = "submit_" + kind;
      }
      changes.push({
        resource: "credit_operations",
        data: {
          id: d.operation_id,
          actor_id: user.id,
          request_hash: hash,
          response_json: JSON.stringify(result),
          deleted_at: null,
        },
      });
      await r.commitBusiness(revision, mergeReviewChanges(changes,id,submittedId), user, "attendance", audit);
      return result;
    } catch (e) {
      if (retry >= 1 || (e.code !== "SCHEDULE_RETRY" && e.status !== 409))
        throw e;
    }
}
function validatePeople(input, ctx, attendance) {
  if (
    !Array.isArray(input) ||
    input.length !== ctx.participants.length ||
    input.some(
      (row) =>
        !row ||
        typeof row !== "object" ||
        Array.isArray(row) ||
        typeof row.participant_id !== "string" ||
        typeof row.student_id !== "string",
    ) ||
    new Set(input.map((p) => p.participant_id)).size !== input.length
  )
    fail(400, "须逐人填写本课全部学员");
  return input.map((row) => {
    const p = ctx.participants.find((p) => p.id === row.participant_id);
    if (!p || row.student_id !== p.student_id) fail(404, "不存在");
    const value = attendance ? row.attendance : p.attendance;
    if (
      !Object.hasOwn(ATTENDANCE_LABELS, value) ||
      (attendance && value === "planned")
    )
      fail(400, "请登记每位学员的出勤");
    return {
      participant_id: p.id,
      student_id: p.student_id,
      attendance: value,
      comment: string(row.comment || "", "逐人点评", 4000, 0),
    };
  });
}
export async function timetableApi(env, tenant, user, policy, url) {
  const r = repo(env, tenant.id),
    teacher = user.roles.includes("teacher")
      ? user.teacher_id
      : url.searchParams.get("teacher_id"),
    student = user.roles.includes("student")
      ? user.student_id
      : url.searchParams.get("student_id");
  if (
    (user.roles.includes("teacher") &&
      (url.searchParams.has("student_id") ||
        (url.searchParams.get("teacher_id") &&
          url.searchParams.get("teacher_id") !== teacher))) ||
    (user.roles.includes("student") &&
      (url.searchParams.has("teacher_id") ||
        (url.searchParams.get("student_id") &&
          url.searchParams.get("student_id") !== student)))
  )
    fail(404, "不存在");
  if ((!teacher && !student) || (teacher && student))
    fail(400, "请选择一位教师或学员");
  requireCan(user, policy, "exports", "export", {
    teacher_id: teacher,
    student_id: student,
  });
  requireCan(user, policy, "schedule", "read", {
    teacher_id: teacher,
    student_id: student,
  });
  const owner = await r.businessGet(
    teacher ? "teachers" : "students",
    teacher || student,
  );
  if (!owner) fail(404, "不存在");
  const from = day(url.searchParams.get("from")),
    to = nextDay(from, 7),
    filter = teacher
      ? { roles: ["teacher"], teacher_id: teacher }
      : { roles: ["student"], student_id: student };
  const rows = [];
  for (
    let offset = 0;
    (!teacher || owner.show_in_timetable === 1) && offset < 1000;
    offset += 200
  ) {
    const page = await r.weekPage(from, to, offset, filter, true);
    rows.push(...page);
    if (page.length < 200) break;
    if (offset === 800) fail(400, "一周课程超过图片上限，请联系教务");
  }
  await r.audit(user, "exports", "export", null, "导出个人品牌周课表图");
  return {
    owner_name: owner.name,
    from,
    to: nextDay(to, -1),
    items: rows.map((l) => ({
      start_at: l.start_at,
      source_course_id: l.source_course_id,
      duration: l.duration,
      course_name: l.course_name,
      teacher_name: l.teacher_name,
      location_name: l.mode === "online" ? "线上课" : l.location_name,
      status: l.status,
    })),
  };
}
