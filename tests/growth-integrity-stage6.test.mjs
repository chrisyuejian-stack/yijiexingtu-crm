import test from "node:test";

import assert from "node:assert/strict";

import { readFile } from "node:fs/promises";

import { createHash } from "node:crypto";

import { growthSchool, call, ok, batch, readyDoc, submitFeedback, confirmFeedback, parent } from "./fixtures-growth.mjs";

import { fixture } from "./support.mjs";

import { mobileSetup, proposal, decide, MOBILE_NOW } from "./fixtures-mobile.mjs";

test("YX6I 0001–0022与阶段5逐字节相同；0023仅扩展旧点评字段、保留原列原值且可升级", async () => {
    const base = JSON.parse(await readFile("docs/reference/stage6-start-baseline-sha256.json", "utf8"));
    for (const e of base.files.filter(x => x.path.startsWith("migrations/"))) assert.equal(createHash("sha256").update(await readFile(e.path)).digest("hex"), e.sha256, e.path);
    const old = Date.now;
    Date.now = () => MOBILE_NOW;
    const f = await fixture({
        migrateGrowth: false
    });
    try {
        const s = await mobileSetup(f, 1, "upgradegrowth");
        s.f = f;
        f.db.raw.prepare("UPDATE tenant_modules SET enabled=0 WHERE tenant_id=? AND id='growth_reports'").run(s.t.id);
        const proposed = ok(await proposal(s));
        ok(await decide(s, proposed.id));
        const tables = f.db.raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x => x.name), before = Object.fromEntries(tables.map(n => [ n, f.db.raw.prepare("SELECT * FROM " + n).all().map(x => JSON.stringify(x)) ]));
        f.db.raw.exec(await readFile("migrations/0023_feedback_and_growth_reports.sql", "utf8"));
        for (const n of tables) {
            const after = new Set(f.db.raw.prepare("SELECT * FROM " + n).all().map(x => {
                delete x.personal_json;
                delete x.feedback_versions_json;
                return JSON.stringify(x);
            }));
            for (const row of before[n]) assert.ok(after.has(row), n);
        }
        f.db.raw.prepare("UPDATE tenant_modules SET enabled=1 WHERE tenant_id=? AND id='growth_reports'").run(s.t.id);
        const pa = await parent(s);
        assert.equal(ok(await call(s, "parent/children/" + s.students[0] + "/feed", "GET", undefined, pa.token)).items.length, 1);
        ok(await call(s, "feedback/" + proposed.id + "/" + s.students[0] + "/copied", "POST", {}, s.teacherAccount.token));
        assert.deepEqual(f.db.raw.prepare("PRAGMA foreign_key_check").all(), []);
    } finally {
        f.restore();
        Date.now = old;
    }
});

test("YX6I 新增结构及已发布修订纳入全量加密快照，修订/已确认反馈不可覆盖", () => growthSchool(async s => {
    const rep = ok(await call(s, "students/" + s.students[0] + "/repertoire", "POST", {
        name: "小步舞曲"
    }, s.teacherAccount.token), 201);
    const submitted = ok(await submitFeedback(s));
    ok(await confirmFeedback(s, submitted.id));
    ok(await call(s, "feedback/" + submitted.id + "/" + s.students[0] + "/copied", "POST", {}, s.teacherAccount.token));
    const b = await batch(s), d = await readyDoc(s, b.reports[0]);
    ok(await call(s, "reports/" + d.id + "/ready", "POST", {}));
    ok(await call(s, "reports/" + d.id + "/publish", "POST", {}));
    const {startBackup: startBackup} = await import("../src/server/backup.js");
    await startBackup(s.f.env, Date.now());
    for (const table of [ "lesson_submissions", "lesson_comments", "growth_repertoire", "growth_feedback_copies", "growth_batches", "growth_reports", "growth_report_revisions", "growth_notifications" ]) assert.ok(s.f.db.raw.prepare("SELECT row_json FROM backup_snapshot_rows WHERE table_name=? AND tenant_id=?").get(table, s.t.id), table);
    assert.equal(s.f.db.raw.prepare("SELECT type FROM sqlite_master WHERE name='growth_feedback'").get().type, "view");
    const reportStyles = ok(await call(s, "styles?doc_type=report", "GET", undefined, s.teacherAccount.token)).items;
    assert.equal(reportStyles[0].id, "stp_growth_folio");
    assert.ok(reportStyles[0].manifest.doc_types.includes("report"));
    assert.equal(ok(await call(s, "styles?doc_type=feedback_card", "GET", undefined, s.teacherAccount.token)).items[0].id, "stp_growth_folio");
    ok(await call(s, "styles/stp_growth_folio/versions/1.0.0", "GET", undefined, s.teacherAccount.token));
    ok(await call(s, "styles/stp_folio/versions/1.0.0", "GET", undefined, s.teacherAccount.token), 404);
    s.f.db.raw.prepare("UPDATE tenant_modules SET enabled=0 WHERE tenant_id=? AND id IN('plans','content')").run(s.t.id);
    ok(await call(s, "styles/stp_article/versions/1.0.0"), 404);
    ok(await call(s, "styles/stp_growth_folio/versions/1.0.0"));
    assert.throws(() => s.f.db.raw.prepare("UPDATE growth_feedback SET doc_json='{}' WHERE status='confirmed'").run(), /growth_feedback_immutable/);
    assert.throws(() => s.f.db.raw.prepare("UPDATE growth_report_revisions SET doc_json='{}'").run(), /growth_revision_immutable/);
    assert.deepEqual(s.f.db.raw.prepare("PRAGMA foreign_key_check").all(), []);
}));

test("YX6I 同版本并发报告保存只成功一份，失败不遗留修订或通知", () => growthSchool(async s => {
    const b = await batch(s), row = b.reports[0], results = await Promise.all([ "甲", "乙" ].map(progress => call(s, "reports/" + row.id, "PUT", {
        version: 1,
        texts: {
            progress: progress
        }
    }, s.teacherAccount.token)));
    assert.deepEqual(results.map(x => x.status).sort(), [ 200, 409 ]);
    assert.equal(s.f.db.raw.prepare("SELECT COUNT(*) n FROM growth_report_revisions WHERE report_id=?").get(row.id).n, 1);
    assert.equal(s.f.db.raw.prepare("SELECT COUNT(*) n FROM growth_notifications").get().n, 0);
}));

test("YX6I 未登录新接口401，跨机构会话404，到期403且原会话保留", () => growthSchool(async s => {
    const b = await batch(s);
    for (const path of [ "report-batches", "reports/" + b.reports[0].id, "feedback/today", "students/" + s.students[0] + "/repertoire" ]) ok(await call(s, path, "GET", undefined, null), 401);
    const {setup: setup} = await import("./fixtures-credit.mjs"), other = await setup(s.f, 1, "othergrowthscope");
    other.f = s.f;
    ok(await call(s, "/" + other.t.slug + "/api/reports/" + b.reports[0].id), 404);
    s.f.db.raw.prepare("UPDATE tenants SET status='paused' WHERE id=?").run(s.t.id);
    assert.equal(ok(await call(s, "reports/" + b.reports[0].id), 403).error, "tenant_expired");
    assert.ok(s.f.db.raw.prepare("SELECT * FROM sessions WHERE tenant_id=? AND user_id=?").get(s.t.id, s.user.id));
    s.f.db.raw.prepare("UPDATE tenants SET status='active' WHERE id=?").run(s.t.id);
    ok(await call(s, "reports/" + b.reports[0].id));
}));

test("YX6I 校验和提交之间图片变隐藏，报告整笔冲突且不留下修订", () => growthSchool(async s => {
    await s.r.settingsGalleryCreate({
        id: "img_race",
        r2_key: "local/race",
        mime: "image/png",
        width: 1,
        height: 1,
        tags: [],
        consent: true
    }, s.user);
    const b = await batch(s), row = b.reports[0], original = s.f.db.batch.bind(s.f.db);
    let injected = false;
    s.f.db.batch = async statements => {
        if (!injected && statements.some(x => x.query.includes("INSERT INTO growth_report_revisions"))) {
            injected = true;
            s.f.db.raw.prepare("UPDATE gallery_images SET hidden=1 WHERE tenant_id=? AND id='img_race'").run(s.t.id);
        }
        return original(statements);
    };
    try {
        ok(await call(s, "reports/" + row.id, "PUT", {
            version: 1,
            artwork_image_ids: [ "img_race" ]
        }, s.teacherAccount.token), 409);
        assert.equal((await s.r.growthGet(row.id)).version, 1);
        assert.equal(s.f.db.raw.prepare("SELECT COUNT(*) n FROM growth_report_revisions").get().n, 0);
    } finally {
        s.f.db.batch = original;
    }
}));
