import { repo } from "./repo.js";
import { requireCan } from "./accounts.js";
import { fail, randomId, now, string, unb64, sha } from "./core.js";
import { encrypt, decrypt } from "./crypto.js";
import { prepareStudent, prepareTeacher, day } from "./scheduling.js";
import { quantityIn } from "./numbers.js";
import { workbook, readWorkbook } from "./xlsx.js";
export const IMPORT_HEADERS = {
  students: [
    "姓名",
    "手机号",
    "家长姓名",
    "家长手机号",
    "年级",
    "专业方向",
    "学校",
    "备注",
  ],
  teachers: ["姓名", "手机号", "任教科目"],
  balances: ["学员姓名", "课程名称", "剩余课时", "有效期至"],
};
function allowed(user, policy, kind, action = "create") {
  requireCan(user, policy, "imports", action === "read" ? "read" : "create");
  if (!Object.hasOwn(IMPORT_HEADERS, kind)) fail(404, "不存在");
  requireCan(
    user,
    policy,
    kind === "students"
      ? "students"
      : kind === "teachers"
        ? "settings"
        : "packages",
    action,
  );
}
const scope = (t, u, k) => t.id + ":import:" + u.id + ":" + k;
function importedDate(value) {
  if (!value) return null;
  if (/^\d+$/.test(value)) {
    const serial = Number(value);
    if (
      !Number.isInteger(serial) ||
      serial < 1 ||
      serial > 73050 ||
      serial === 60
    )
      fail(400, "Excel 日期不正确");
    return day(
      new Date(Date.UTC(1899, 11, serial < 60 ? 31 : 30) + serial * 86400000)
        .toISOString()
        .slice(0, 10),
    );
  }
  return day(value);
}
async function prepare(env, t, r, kind, values, id) {
  let row;
  if (kind === "students")
    row = await prepareStudent(env, t.id, r, {
      name: values["姓名"],
      phone: values["手机号"],
      parent_name: values["家长姓名"],
      parent_phone: values["家长手机号"],
      grade: values["年级"],
      direction: values["专业方向"],
      school: values["学校"],
      notes: values["备注"],
    });
  else if (kind === "teachers")
    row = await prepareTeacher(env, t.id, r, {
      name: values["姓名"],
      phone: values["手机号"],
      subjects: (values["任教科目"] || "").split(/[、,，]/).filter(Boolean),
    });
  else {
    if (!values["剩余课时"]) fail(400, "请填写剩余课时");
    const units = quantityIn(Number(values["剩余课时"]), { zero: true });
    row = {
      id,
      units_total: units,
      valid_to: importedDate(values["有效期至"]),
    };
    string(values["学员姓名"], "学员姓名", 50);
    string(values["课程名称"], "课程名称", 100);
  }
  row.id = id;
  return row;
}
export async function importsApi(
  req,
  env,
  t,
  user,
  policy,
  path,
  url,
  readBody,
) {
  const kind = url.searchParams.get("kind"),
    r = repo(env, t.id);
  if (path === "/api/imports/template" && req.method === "GET") {
    allowed(user, policy, kind, "read");
    const file = workbook([IMPORT_HEADERS[kind]], "导入模板");
    await r.audit(user, "imports", "export", null, "下载批量导入模板");
    return new Response(file, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="import-template.xlsx"',
      },
    });
  }
  allowed(user, policy, kind);
  const d = await readBody(req);
  if (path === "/api/imports/preview" && req.method === "POST") {
    let rows;
    try {
      rows = await readWorkbook(unb64(string(d.file, "Excel 文件", 1000000)));
    } catch (e) {
      fail(400, e.message);
    }
    const names = rows.map(
      (x) => x.values[kind === "balances" ? "学员姓名" : "姓名"],
    );
    const refs = await r.importReferences(
      names,
      rows.map((x) => x.values["课程名称"]),
    );
    const seen = new Set(),
      result = [];
    for (const { index, values } of rows) {
      try {
        const id = randomId(kind === "balances" ? "pkg" : "rec");
        await prepare(env, t, r, kind, values, id);
        const name = values[kind === "balances" ? "学员姓名" : "姓名"],
          matches = (
            kind === "teachers" ? refs.teachers : refs.students
          ).filter((x) => x.name === name);
        if (
          kind === "balances" &&
          (!matches.length ||
            !refs.types.some((x) => x.name === values["课程名称"]))
        )
          fail(400, "请先建立本机构学员和课程档案");
        const duplicate =
          kind !== "balances" && (matches.length > 0 || seen.has(name));
        seen.add(name);
        const token = await encrypt(
          env,
          JSON.stringify({ kind, index, values, id, at: now() }),
          scope(t, user, kind),
        );
        result.push({
          index,
          name,
          status: duplicate ? "duplicate" : "valid",
          message: duplicate ? "存在同名，请选择跳过或确认新增" : "校验通过",
          candidates: matches.map((x) => ({
            id: x.id,
            name: x.name,
            grade: x.grade,
            school: x.school,
          })),
          courses:
            kind === "balances"
              ? refs.types
                  .filter((x) => x.name === values["课程名称"])
                  .map((x) => ({ id: x.id, name: x.name }))
              : undefined,
          token,
        });
      } catch (e) {
        result.push({
          index,
          name: values["姓名"] || values["学员姓名"] || "",
          status: "invalid",
          message: e.message,
        });
      }
    }
    return { rows: result, headers: IMPORT_HEADERS[kind] };
  }
  if (path !== "/api/imports/commit" || req.method !== "POST")
    fail(404, "不存在");
  if (!Array.isArray(d.rows) || d.rows.length > 200 || !d.rows.length)
    fail(400, "每批需1–200行");
  const op = string(d.operation_id, "操作编号", 100, 8),
    hash = await sha(JSON.stringify({ actor: user.id, kind, rows: d.rows }));
  const complete = await r.creditOperation(op);
  if (complete) {
    if (complete.actor_id !== user.id || complete.request_hash !== hash)
      fail(409, "操作编号已被使用");
    return JSON.parse(complete.response_json);
  }
  const revision = await r.dataVersion(),
    inputs = [];
  for (const input of d.rows) {
    if (input.action === "skip") continue;
    if (input.action !== "new") fail(400, "请明确选择新增或跳过");
    let data;
    try {
      data = JSON.parse(await decrypt(env, input.token, scope(t, user, kind)));
    } catch {
      fail(400, "导入凭证无效");
    }
    if (data.kind !== kind || data.at < now() - 3600000 || data.at > now())
      fail(409, "导入预览已过期，请重新上传");
    inputs.push({
      ...data,
      student_id: input.student_id,
      course_type_id: input.course_type_id,
      confirm_duplicate: input.confirm_duplicate === true,
    });
  }
  if (new Set(inputs.map((x) => x.id)).size !== inputs.length)
    fail(400, "导入行重复");
  const refs = await r.importReferences(
    inputs.map((x) => x.values[kind === "balances" ? "学员姓名" : "姓名"]),
    inputs.map((x) => x.values["课程名称"]),
    inputs.map((x) => x.id),
  );
  const changes = [],
    seen = new Set();
  let skipped = d.rows.length - inputs.length;
  const date = new Date(now()).toLocaleDateString("sv-SE", {
    timeZone: "Asia/Shanghai",
  });
  if (kind === "balances") await r.assertUnlocked([date.slice(0, 7)]);
  for (const input of inputs) {
    if (refs.existing.includes(input.id)) {
      skipped++;
      continue;
    }
    const values = input.values,
      name = values[kind === "balances" ? "学员姓名" : "姓名"];
    const same = (kind === "teachers" ? refs.teachers : refs.students).filter(
      (x) => x.name === name,
    );
    if (
      kind !== "balances" &&
      (same.length || seen.has(name)) &&
      !input.confirm_duplicate
    )
      fail(409, "同名记录须明确确认新增：" + name);
    seen.add(name);
    const row = await prepare(env, t, r, kind, values, input.id);
    if (kind === "balances") {
      const student =
        same.find((x) => x.id === input.student_id && x.status === "active") ||
        (same.length === 1 && !input.student_id && same[0].status === "active"
          ? same[0]
          : null);
      const types = refs.types.filter((x) => x.name === values["课程名称"]);
      const type =
        types.find((x) => x.id === input.course_type_id) ||
        (types.length === 1 && !input.course_type_id ? types[0] : null);
      if (!student || !type)
        fail(404, "学员或课程不存在，请选择本机构对应档案");
      Object.assign(row, {
        student_id: student.id,
        course_type_id: type.id,
        valid_from: null,
        status: "active",
        unit_price: null,
        amount: null,
        stage_id: null,
        purchase_date: date,
        scope_kind: "type",
        category_id: null,
        deleted_at: null,
      });
      changes.push({ resource: "packages", data: row });
      if (row.units_total)
        changes.push({
          resource: "package_transactions",
          data: {
            id: randomId("txn"),
            package_id: row.id,
            student_id: student.id,
            delta: row.units_total,
            type: "opening",
            date,
            participant_id: null,
            reference_id: op,
            note: "Excel 剩余课时导入",
            deleted_at: null,
          },
        });
    } else changes.push({ resource: kind, data: row });
  }
  const result = {
    imported: changes.filter((x) => x.resource !== "package_transactions")
      .length,
    skipped,
  };
  changes.push({
    resource: "credit_operations",
    data: {
      id: op,
      actor_id: user.id,
      request_hash: hash,
      response_json: JSON.stringify(result),
      deleted_at: null,
    },
  });
  await r.commitBusiness(
    revision,
    changes,
    user,
    kind === "balances" ? "packages" : "imports",
    "create",
  );
  return result;
}
