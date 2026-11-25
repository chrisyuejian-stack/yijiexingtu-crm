import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fixture } from "./support.mjs";
import {
  setup,
  request,
  mutate,
  pack,
  lesson,
  details,
  status,
} from "./fixtures-credit.mjs";
import { randomId } from "../src/server/core.js";
test("第三阶段查询预算：30人班课及每个新接口均不超过40次", async () => {
  const f = await fixture();
  try {
    const s = { ...(await setup(f, 30)), f },
      results = [];
    const checked = async (name, path, method = "GET", data) => {
      const res = await request(s, path, method, data);
      assert.equal(res.status, 200, res.text);
      assert.ok(res.queries <= 40);
      results.push({
        name,
        method,
        path: path.replace(/\?.*/, ""),
        queries: res.queries,
        statements: res.statements,
      });
      return res.body;
    };
    const write = (name, path, data = {}, method = "POST") =>
      checked(name, path, method, { operation_id: randomId("op"), ...data });
    const stages = await write("新建学习阶段", "credits/stages", {
      student_id: s.students[0],
      name: "基础学习",
    });
    await write(
      "修改学习阶段",
      "credits/stages/" + stages.id,
      { version: 1, name: "巩固学习" },
      "PATCH",
    );
    await checked("阶段列表", "credits/stages");
    await checked("阶段详情", "credits/stages/" + stages.id);
    let packageId;
    for (const student of s.students) {
      const made = await write(
        "购买课时包（30人逐人独立请求）",
        "credits/packages",
        {
          student_id: student,
          course_type_id: s.type,
          units_total: 10,
          unit_price: 100,
        },
      );
      packageId ??= made.id;
    }
    await write(
      "修改课时包",
      "credits/packages/" + packageId,
      { version: 1, units_total: 11, amount: 1100 },
      "PATCH",
    );
    await checked("课时包列表", "credits/packages");
    await checked("课时包详情", "credits/packages/" + packageId);
    const payment = await write("登记缴费", "credits/payments", {
      student_id: s.students[0],
      package_id: packageId,
      amount: 100,
      paid_at: "2026-11-02",
    });
    await checked("缴费列表", "credits/payments");
    await checked("缴费详情", "credits/payments/" + payment.id);
    await write("手工调整", "credits/adjust", {
      package_id: packageId,
      delta: 1,
      reason: "核对补足",
    });
    const type2 = await s.create("course_types", {
        name: "另一课程",
        category_id: s.cat,
        format: "group",
        capacity: 40,
      }),
      other = await write("第二课程包", "credits/packages", {
        student_id: s.students[0],
        course_type_id: type2,
        units_total: 0,
      });
    await checked(
      "课时转换参考比例",
      "credits/transfer?from_package_id=" +
        packageId +
        "&to_package_id=" +
        other.id,
    );
    await write("课时转换", "credits/transfer", {
      from_package_id: packageId,
      to_package_id: other.id,
      from_units: 1,
      to_units: 2,
      reason: "转课",
    });
    const id = await lesson(s);
    let d = await details(s, id);
    await write(
      "30人逐人出勤一次提交",
      "credits/lessons/" + id + "/attendance",
      {
        lesson_version: d.version,
        participants: d.participants.map((p) => ({
          id: p.id,
          version: p.version,
          attendance: "attended",
        })),
      },
    );
    d = await details(s, id);
    await write("30人撤销销课", "credits/lessons/" + id + "/undo", {
      lesson_version: d.version,
    });
    d = await details(s, id);
    await write("30人整班销课", "credits/lessons/" + id + "/status", {
      lesson_version: d.version,
      status: "completed",
    });
    d = await details(s, id);
    const makeup = await write("新建补课课程", "credits/makeups", {
      original_participant_id: d.participants[0].id,
      new_lesson: {
        start_at: "2026-11-11T09:00",
        teacher_id: s.teacher,
        location_id: s.room,
        duration: 45,
        units: 1,
      },
    });
    const links = await checked("补课关联列表", "credits/makeups");
    await checked("补课关联详情", "credits/makeups/" + links.items[0].id);
    await write(
      "解除补课关联",
      "credits/makeups/" + links.items[0].id + "/unlink",
      { version: links.items[0].version },
    );
    const targetStudent = await s.create("students", {
        name: "补课目标原学员",
      }),
      target = await lesson(s, "2026-11-12T09:00", [targetStudent]);
    await write("加入已有班课补课", "credits/makeups", {
      original_participant_id: d.participants[0].id,
      target_lesson_id: target,
    });
    const ledger = await checked("流水列表", "credits/transactions");
    await checked("流水详情", "credits/transactions/" + ledger.items[0].id);
    const fresh = await lesson(s, "2026-11-13T09:00");
    assert.equal((await status(s, fresh, "completed")).status, 200);
    d = await details(s, fresh);
    await write("删除30人课程并回补", "credits/lessons/" + fresh + "/delete", {
      lesson_version: d.version,
    });
    const legacy = await write("旧入口课时包创建", "data/packages", {
      student_id: s.students[0],
      course_type_id: s.type,
      units_total: 0,
    });
    await write(
      "旧入口课时包修改",
      "data/packages/" + legacy.id,
      { version: 1, units_total: 0 },
      "PATCH",
    );
    await checked("旧入口列表", "data/packages");
    await checked("旧入口详情", "data/packages/" + legacy.id);
    const last = await lesson(s, "2026-11-14T09:00");
    d = await details(s, last);
    await checked("旧入口课程删除", "data/lessons/" + last, "DELETE", {
      version: d.version,
    });
    const report = {
      budget: 40,
      scale:
        "30人班课，30个课时包；每次请求独立计数（含认证、权限、审计、幂等）",
      build:
        process.env.TEST_BUNDLE === "1"
          ? "dist/_worker.js"
          : "src/server/worker.js",
      results,
      max: Math.max(...results.map((x) => x.queries)),
    };
    await mkdir("work/reports", { recursive: true });
    await writeFile(
      "work/reports/credits-budget" +
        (process.env.TEST_BUNDLE === "1" ? "-bundle" : "") +
        ".json",
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report));
  } finally {
    f.restore();
  }
});
