import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fixture } from "./support.mjs";
import { setup, request, accountToken } from "./fixtures-credit.mjs";
import { adminCall } from "./fixtures-admin.mjs";
test("第八阶段查询预算：30机构、30课次、30人名单；所有新接口每请求不超过40次", async () => {
  const f = await fixture();
  try {
    const schools = [],
      rows = [];
    const check = (name, r, code = 200) => {
      assert.equal(r.status, code, r.text);
      assert.ok(r.queries <= 40, name);
      rows.push({ name, queries: r.queries });
      return r.body;
    };
    for (let i = 0; i < 30; i++)
      schools.push({
        ...(await setup(f, i === 0 ? 30 : 1, "promo-budget-" + i)),
        f,
      });
    const a = schools[0],
      sessions = Array.from({ length: 30 }, (_, i) => ({
        start_at:
          new Date(Date.now() + (10 + i) * 86400000 + 8 * 3600000)
            .toISOString()
            .slice(0, 10) + "T09:00",
        duration: 45,
        meeting_no: "预算会议",
        meeting_url: "https://meeting.tencent.com/test",
      }));
    const image = "img_" + "1".repeat(24);
    f.db.raw
      .prepare(
        "INSERT INTO promo_images(id,tenant_id,owner_id,kind,width,height,ready,created_at) VALUES(?,'platform','fixture','detail',750,1000,1,?)",
      )
      .run(image, Date.now());
    const id = check(
      "POST /api/promo（30课次）",
      await adminCall(f, "promo", "POST", {
        type: "course",
        detail_image_key: image,
        title: "规模合作课",
        audience: "all",
        publish_at: Date.now() - 1000,
        status: "published",
        lecturer: "规模讲师",
        seat_price: 100,
        suggested_price: 200,
        min_size: 30,
        apply_deadline: Date.now() + 86400000,
        sessions,
      }),
    ).id;
    for (const s of schools)
      check(
        "POST /promo/ID/application",
        await request(s, "promo/" + id + "/application", "POST", {
          est_size: 30,
          unsure: false,
        }),
      );
    let d = check(
      "GET /api/promo/ID（30机构汇总）",
      await adminCall(f, "promo/" + id),
    );
    for (const app of d.applications)
      check(
        "PUT /api/promo/ID/applications/ID",
        await adminCall(f, "promo/" + id + "/applications/" + app.id, "PUT", {
          version: app.version,
          status: "confirmed",
          confirmed_size: 30,
          consultant: "预算顾问",
        }),
      );
    d = check("GET /api/promo/ID", await adminCall(f, "promo/" + id));
    check(
      "POST /api/promo/ID/open（30机构×30课次）",
      await adminCall(f, "promo/" + id + "/open", "POST", {
        version: d.course.version,
      }),
    );
    let view = check(
      "GET /promo/ID（30课次）",
      await request(a, "promo/" + id),
    );
    check(
      "PUT /promo/ID/roster（30课次×30人）",
      await request(a, "promo/" + id + "/roster", "PUT", {
        version: view.application.version,
        student_ids: a.students,
      }),
    );
    check("GET /promo/ID/roster", await request(a, "promo/" + id + "/roster"));
    check("GET /promo", await request(a, "promo"));
    check("GET /promo/assets", await request(a, "promo/assets"));
    check(
      "PUT /promo/assets",
      await request(a, "promo/assets", "PUT", { logo_key: null, qr_key: null }),
    );
    check(
      "POST /promo/ID/read",
      await request(a, "promo/" + id + "/read", "POST", {}),
    );
    d = check("GET /api/promo/ID", await adminCall(f, "promo/" + id));
    const session = d.sessions[0];
    check(
      "PUT /api/promo/ID/sessions/ID（同步30机构）",
      await adminCall(f, "promo/" + id + "/sessions/" + session.id, "PUT", {
        version: session.version,
        start_at: session.start_at.slice(0, 11) + "11:00",
        duration: 60,
        meeting_no: "更新会议",
      }),
    );
    d = check("GET /api/promo/ID", await adminCall(f, "promo/" + id));
    check(
      "POST /api/promo/ID/fail（取消900课次）",
      await adminCall(f, "promo/" + id + "/fail", "POST", {
        version: d.course.version,
        reason: "预算测试取消未来课程",
      }),
    );
    assert.equal(
      f.db.raw
        .prepare("SELECT COUNT(*) n FROM lessons WHERE source_course_id=?")
        .get(d.course.id).n,
      900,
    );
    const grouped = Object.values(Object.groupBy(rows, (x) => x.name)).map(
      (rs) => ({
        name: rs[0].name,
        queries: Math.max(...rs.map((x) => x.queries)),
        requests: rs.length,
      }),
    );
    await mkdir("work/reports", { recursive: true });
    await writeFile(
      "work/reports/promo-budget" +
        (process.env.TEST_BUNDLE === "1" ? "-bundle" : "") +
        ".json",
      JSON.stringify(
        {
          limit: 40,
          scale: "30机构×30课次，30人名单，900合作课次",
          interfaces: grouped,
          maximum: Math.max(...grouped.map((x) => x.queries)),
        },
        null,
        2,
      ) + "\n",
    );
    for (const row of grouped)
      console.log(row.name + ": " + row.queries + "/40");
  } finally {
    f.restore();
  }
});
