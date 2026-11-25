import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fixture } from "./support.mjs";
import { setup, request } from "./fixtures-credit.mjs";
import { schoolFixture } from "./fixtures-school.mjs";
import { adminCall } from "./fixtures-admin.mjs";
import { IMPORT_HEADERS } from "../src/server/imports.js";
import { workbook } from "../src/server/xlsx.js";
import { startBackup, continueBackup } from "../src/server/backup.js";
import sourceBackup from "../src/server/backup.js";
const backupWorker =
  process.env.TEST_BUNDLE === "1"
    ? (await import("../backup-dist/backup-worker.js")).default
    : sourceBackup;
test("第六阶段查询预算：30人班级、30个班级模板整月、200行Excel；所有新增/修改接口及分批Cron均≤40", async () => {
  const f = await fixture(),
    report = [];
  try {
    const s = { ...(await setup(f, 30)), f };
    const check = async (name, promise, status = 200) => {
      f.db.raw.prepare("DELETE FROM security_limits").run();
      const result = await promise;
      assert.equal(result.status, status, result.text);
      assert.ok(result.queries <= 40, name + " " + result.queries);
      report.push({ name, queries: result.queries, status: result.status });
      return result.body;
    };
    let cls;
    for (let i = 0; i < 30; i++) {
      const created = await check(
        "POST tools/classes",
        request(s, "tools/classes", "POST", {
          name: "预算班级" + i,
          teacher_id: s.teacher,
          course_type_id: s.type,
          location_id: s.room,
          date_from: "2026-11-01",
          date_to: "2026-11-30",
        }),
      );
      cls = created.id;
      await check(
        "POST tools/classes/ID/members（30人）",
        request(s, "tools/classes/" + cls + "/members", "POST", {
          student_ids: s.students,
        }),
      );
      await check(
        "POST data/schedule_templates（班级）",
        request(s, "data/schedule_templates", "POST", {
          class_id: cls,
          assistant_id: "",
          teacher_id: s.teacher,
          course_type_id: s.type,
          location_id: s.room,
          weekday: i % 7,
          start_time: String(9 + Math.floor(i / 7)).padStart(2, "0") + ":00",
          duration: 45,
          units: 1,
          date_from: "2026-11-01",
          date_to: "2026-11-30",
        }),
      );
    }
    const generated = await check(
      "POST templates/generate（30模板×30人×整月）",
      request(s, "templates/generate", "POST", {
        from: "2026-11-01",
        to: "2026-11-30",
      }),
    );
    assert.equal(generated.committed, true);
    assert.ok(generated.generated >= 120);
    await check("GET tools/classes", request(s, "tools/classes"));
    const detail = await check(
      "GET tools/classes/ID（30人）",
      request(s, "tools/classes/" + cls),
    );
    assert.equal(detail.members.length, 30);
    await check(
      "GET tools/class_members",
      request(s, "tools/class_members?class_id=" + cls),
    );
    await check("GET workbench", request(s, "workbench"));
    await check("GET renewals", request(s, "renewals"));
    await check("GET renewal-brand", request(s, "renewal-brand"));
    await check("GET renewal-settings", request(s, "renewal-settings"));
    await check(
      "PUT renewal-settings",
      request(s, "renewal-settings", "PUT", {
        low_balance_threshold: 5,
        expiry_warning_days: 20,
      }),
    );
    await check("GET followup-assignees", request(s, "followup-assignees"));
    const task = await check(
      "POST tools/followup_tasks",
      request(s, "tools/followup_tasks", "POST", {
        student_id: s.students[0],
        title: "跟进",
        due_date: "2026-11-10",
        assignee_id: s.user.id,
      }),
    );
    for (const kind of [
      "followup_notes",
      "student_routines",
      "leads",
      "referrals",
    ]) {
      const data = {
        followup_notes: {
          student_id: s.students[0],
          at: "2026-11-02T09:00",
          content: "沟通",
        },
        student_routines: {
          student_id: s.students[0],
          weekday: 1,
          time: "09:00",
          content: "练习",
        },
        leads: { name: "线索", phone: "13900000008", stage: "new" },
        referrals: {
          student_id: s.students[0],
          intention: "本科",
          parent_phone: "13900000009",
          consent_name: "家长",
          consent_at: "2026-01-01T09:00",
          consent_method: "书面",
          consent_operator: "经办",
        },
      }[kind];
      const id = (
        await check(
          "POST tools/" + kind,
          request(s, "tools/" + kind, "POST", data),
        )
      ).id;
      await check("GET tools/" + kind, request(s, "tools/" + kind));
      const rec = (
        await check(
          "GET tools/" + kind + "/ID",
          request(s, "tools/" + kind + "/" + id),
        )
      ).record;
      await check(
        "PATCH tools/" + kind + "/ID",
        request(s, "tools/" + kind + "/" + id, "PATCH", {
          ...data,
          version: rec.version,
          ...(kind === "referrals" ? { status: "withdrawn" } : {}),
        }),
      );
    }
    const taskDetail = await check(
      "GET tools/followup_tasks/ID",
      request(s, "tools/followup_tasks/" + task.id),
    );
    await check(
      "DELETE tools/followup_tasks/ID",
      request(s, "tools/followup_tasks/" + task.id, "DELETE", {
        version: taskDetail.record.version,
      }),
    );
    const excel = Buffer.from(
      workbook([
        IMPORT_HEADERS.students,
        ...Array.from({ length: 200 }, (_, i) => [
          "批量学员" + i,
          "",
          "",
          "",
          "",
          "",
          "",
          "",
        ]),
      ]),
    ).toString("base64");
    const preview = await check(
      "POST imports/preview（200行）",
      request(s, "imports/preview?kind=students", "POST", { file: excel }),
    );
    await check(
      "POST imports/commit（200行）",
      request(s, "imports/commit?kind=students", "POST", {
        operation_id: "stage6-budget-import",
        rows: preview.rows.map((row) => ({ token: row.token, action: "new" })),
      }),
    );
    await check("GET overview", adminCall(f, "overview"));
    await check("GET backups", adminCall(f, "backups"));
    await check("GET referrals", adminCall(f, "referrals"));
    await check("GET announcements", adminCall(f, "announcements"));
    const msg = await check(
      "POST announcements",
      adminCall(f, "announcements", "POST", {
        title: "系统消息",
        content: "预算验收",
        roles: ["supervisor"],
        tenants: [s.t.id],
        starts_at: Date.now() - 1000,
      }),
    );
    await check("GET system-messages", request(s, "system-messages"));
    await check(
      "POST system-messages/ID/read",
      request(s, "system-messages/" + msg.id + "/read", "POST", {}),
    );
    await check(
      "GET tenants/ID/business",
      adminCall(f, "tenants/" + s.t.id + "/business?path=/data/students"),
    );
    const lease = await check(
      "POST tenants/ID/maintenance",
      adminCall(f, "tenants/" + s.t.id + "/maintenance", "POST", {
        reason: "查询预算代管测试",
      }),
    );
    const student = (await request(s, "data/students/" + s.students[0])).body
      .record;
    await check(
      "POST tenants/ID/operate",
      adminCall(f, "tenants/" + s.t.id + "/operate", "POST", {
        lease: lease.id,
        path: "/data/students/" + student.id,
        method: "PATCH",
        data: { version: student.version, notes: "维护" },
      }),
    );
    await check(
      "DELETE tenants/ID/maintenance/ID",
      adminCall(
        f,
        "tenants/" + s.t.id + "/maintenance/" + lease.id,
        "DELETE",
        {},
      ),
    );
    await check(
      "GET tenants/ID/export-schema",
      adminCall(f, "tenants/" + s.t.id + "/export-schema"),
    );
    await check(
      "GET tenants/ID/export（200行）",
      adminCall(f, "tenants/" + s.t.id + "/export?table=students&offset=0"),
    );
    // Production scheduled handler is bounded: capture once, then 12 encrypted pages per Cron invocation.
    let tick = 0;
    do {
      const response = await f.db.measure(async () => {
        await backupWorker.scheduled(
          {
            cron: tick === 0 ? "0 19 * * *" : "*/5 * * * *",
            scheduledTime: Date.now(),
          },
          f.env,
          {},
        );
        return Response.json({ ok: true });
      });
      const queries = Number(response.headers.get("x-test-d1-queries"));
      assert.ok(queries <= 40);
      report.push({
        name: tick === 0 ? "Cron每日启动" : "Cron分批续传",
        queries,
        status: 200,
      });
      tick++;
      assert.ok(tick < 1000);
    } while (
      f.db.raw
        .prepare(
          "SELECT COUNT(*) n FROM backup_snapshots WHERE status='running'",
        )
        .get().n
    );
    const backup = f.db.raw
      .prepare(
        "SELECT id FROM backup_runs WHERE status='completed' ORDER BY at DESC LIMIT 1",
      )
      .get();
    assert.ok(backup);
    const job = await check(
      "POST tenants/ID/jobs（恢复暂存）",
      adminCall(f, "tenants/" + s.t.id + "/jobs", "POST", {
        kind: "restore",
        backup_id: backup.id,
        reason: "查询预算恢复演练",
      }),
    );
    await check(
      "GET tenants/ID/jobs",
      adminCall(f, "tenants/" + s.t.id + "/jobs"),
    );
    await check(
      "GET tenants/ID/jobs/ID",
      adminCall(f, "tenants/" + s.t.id + "/jobs/" + job.id),
    );
    for (const item of job.manifest.required)
      await check(
        "POST tenants/ID/jobs/ID/page",
        adminCall(
          f,
          "tenants/" + s.t.id + "/jobs/" + job.id + "/page",
          "POST",
          item,
        ),
      );
    await check(
      "POST tenants/ID/jobs/ID/commit（完整恢复）",
      adminCall(
        f,
        "tenants/" + s.t.id + "/jobs/" + job.id + "/commit",
        "POST",
        {},
      ),
    );
    const empty = await schoolFixture(f, "empty-budget");
    const old = await check(
      "POST tenants/ID/jobs（旧JSON）",
      adminCall(f, "tenants/" + empty.t.id + "/jobs", "POST", {
        kind: "legacy",
        counts: { students: 1 },
        settings: {},
        reason: "旧JSON预算验收",
      }),
    );
    await check(
      "POST tenants/ID/jobs/ID/page（旧JSON）",
      adminCall(
        f,
        "tenants/" + empty.t.id + "/jobs/" + old.id + "/page",
        "POST",
        { table: "students", rows: [{ id: "old", name: "旧学员" }] },
      ),
    );
    await check(
      "POST tenants/ID/jobs/ID/preview",
      adminCall(
        f,
        "tenants/" + empty.t.id + "/jobs/" + old.id + "/preview",
        "POST",
        {},
      ),
    );
    await check(
      "POST tenants/ID/jobs/ID/cancel",
      adminCall(
        f,
        "tenants/" + empty.t.id + "/jobs/" + old.id + "/cancel",
        "POST",
        {},
      ),
    );
    const summary = Object.values(Object.groupBy(report, (x) => x.name)).map(
      (rows) => ({
        name: rows[0].name,
        queries: Math.max(...rows.map((x) => x.queries)),
        requests: rows.length,
      }),
    );
    await mkdir("work/reports", { recursive: true });
    await writeFile(
      "work/reports/tools-budget" +
        (process.env.TEST_BUNDLE === "1" ? "-bundle" : "") +
        ".json",
      JSON.stringify(
        {
          limit: 40,
          scale: "30人班级、30班级模板整月、200行Excel",
          interfaces: summary,
          maximum: Math.max(...summary.map((x) => x.queries)),
        },
        null,
        2,
      ),
    );
    for (const row of summary)
      console.log(row.name + ": " + row.queries + "/40");
  } finally {
    f.restore();
  }
});
