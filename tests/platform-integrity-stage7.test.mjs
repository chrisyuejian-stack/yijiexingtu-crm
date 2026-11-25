import test from "node:test";

import assert from "node:assert/strict";

import { readFile } from "node:fs/promises";

import { fixture } from "./support.mjs";

import { setup } from "./fixtures-credit.mjs";

import { ops, ok, upload, publish, manifest } from "./fixtures-platform.mjs";

import { call } from "./fixtures-plans.mjs";

const using = async fn => {
    const f = await fixture();
    try {
        await fn(f);
    } finally {
        f.restore();
    }
};

test("YX7I 0024只追加平台表和映射，旧表每行原样，旧改名模板不猜key", async () => {
    const f = await fixture({
        migratePlatform: false
    });
    try {
        const s = await setup(f, 1, "legacy7");
        s.f = f;
        ok(await call(s, "settings/subjects", "POST", {
            key: "music_interest"
        }));
        let courses = ok(await call(s, "settings/courses")).items;
        ok(await call(s, "settings/courses/" + courses[0].id, "PUT", {
            ...courses[0],
            name: "旧机构重命名"
        }));
        const db = f.db.raw, names = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x => x.name), before = Object.fromEntries(names.map(n => [ n, db.prepare("SELECT * FROM " + n).all().map(x => JSON.stringify(x)) ]));
        db.exec(await readFile("migrations/0024_platform_management.sql", "utf8"));
        for (const n of names) assert.deepEqual(db.prepare("SELECT * FROM " + n).all().map(x => JSON.stringify(x)), before[n], n);
        assert.equal(db.prepare("SELECT COUNT(*) n FROM setting_template_refs WHERE tenant_id=? AND entity_id=?").get(s.t.id, courses[0].id).n, 0);
        assert.ok(db.prepare("SELECT COUNT(*) n FROM setting_template_refs WHERE tenant_id=?").get(s.t.id).n > 0);
        const subjects = ok(await call(s, "settings/subjects"));
        assert.ok(subjects[0].warnings?.length);
        assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    } finally {
        f.restore();
    }
});

test("YX7I 平台管理与机构映射/发布范围进入全量加密快照，机构清理覆盖新租户表", () => using(async f => {
    const s = await setup(f, 1, "backup7");
    s.f = f;
    ok(await call(s, "settings/subjects", "POST", {
        key: "music_interest"
    }));
    const row = ok(await upload(f), 201);
    ok(await publish(f, row, "tenants", [ s.t.id ]));
    const {startBackup: startBackup} = await import("../src/server/backup.js");
    await startBackup(f.env, Date.now());
    for (const table of [ "subject_packs", "subject_pack_versions", "setting_template_refs", "style_version_meta", "style_version_tenants", "style_assets", "style_defaults" ]) assert.ok(f.db.raw.prepare("SELECT row_json FROM backup_snapshot_rows WHERE table_name=?").get(table), table);
    const {PURGE_TABLES: PURGE_TABLES} = await import("../src/server/purge-schema.js");
    assert.ok(PURGE_TABLES.includes("style_version_tenants"));
    assert.ok(PURGE_TABLES.includes("setting_template_refs"));
}));

test("YX7I 同一草稿并发编辑只成功一份，409附完整latest；发布后不改内容", () => using(async f => {
    const base = ok(await ops(f, "subject-packs")).items[0].versions[0], draft = ok(await ops(f, "subject-packs", "POST", {
        ...base,
        pack_version: "0.2"
    }), 201);
    const payload = {
        ...draft,
        name: "并发修改"
    };
    const responses = await Promise.all([ ops(f, "subject-packs", "PUT", payload), ops(f, "subject-packs", "PUT", payload) ]);
    assert.deepEqual(responses.map(x => x.status).sort(), [ 200, 409 ]);
    const error = responses.find(x => x.status === 409);
    assert.equal(error.body.error, "version_conflict");
    assert.ok(error.body.details.latest.content.courses.length);
    assert.equal(error.body.details.latest.version, 2);
    const d = responses.find(x => x.status === 200).body;
    ok(await ops(f, "subject-packs/" + d.key + "/versions/0.2/publish", "POST", {
        version: 2
    }));
    ok(await ops(f, "subject-packs", "PUT", d), 409);
}));

test("YX7I 同风格版本并发上传只留一个元数据与一份图片，不覆盖胜者", () => using(async f => {
    const r = await Promise.all([ upload(f), upload(f) ]);
    assert.deepEqual(r.map(x => x.status).sort(), [ 201, 409 ]);
    assert.equal(f.db.raw.prepare("SELECT COUNT(*) n FROM style_pack_versions WHERE pack_id='test_style'").get().n, 1);
    assert.equal(f.env.CHANNEL_MEDIA.objects.size, 1);
    ok(await ops(f, "style-packs/test_style/versions/1.0.0/assets/pic.png"));
}));

test("YX7I 导入SQL故障整批回滚，没有新课程/映射/开通标志；清除故障可重试", () => using(async f => {
    const s = await setup(f, 1, "importfault7");
    s.f = f;
    f.db.raw.exec("CREATE TRIGGER fail_template BEFORE INSERT ON setting_template_refs BEGIN SELECT RAISE(ABORT,'local failure'); END");
    ok(await call(s, "settings/subjects", "POST", {
        key: "music_interest"
    }), 500);
    for (const table of [ "offer_courses", "stage_types", "report_classes", "setting_template_refs", "tenant_subjects" ]) assert.equal(f.db.raw.prepare("SELECT COUNT(*) n FROM " + table + " WHERE tenant_id=?").get(s.t.id).n, 0, table);
    f.db.raw.exec("DROP TRIGGER fail_template");
    ok(await call(s, "settings/subjects", "POST", {
        key: "music_interest"
    }));
}));

test("YX7I 禁用机构/模块/越机构会话的资源请求被拒绝，R2不读取", () => using(async f => {
    const a = await setup(f, 1, "resourcea"), b = await setup(f, 1, "resourceb");
    a.f = f;
    b.f = f;
    const row = ok(await upload(f), 201);
    ok(await publish(f, row));
    let reads = 0;
    const get = f.env.CHANNEL_MEDIA.get.bind(f.env.CHANNEL_MEDIA);
    f.env.CHANNEL_MEDIA.get = async k => {
        reads++;
        return get(k);
    };
    ok(await call(a, "/" + b.t.slug + "/api/styles/test_style/versions/1.0.0/assets/pic.png"), 404);
    assert.equal(reads, 0);
    f.db.raw.prepare("UPDATE tenants SET status='paused' WHERE id=?").run(a.t.id);
    ok(await call(a, "styles/test_style/versions/1.0.0/assets/pic.png"), 403);
    assert.equal(reads, 0);
    f.db.raw.prepare("UPDATE tenants SET status='active' WHERE id=?").run(a.t.id);
    f.db.raw.prepare("UPDATE tenant_modules SET enabled=0 WHERE tenant_id=? AND id IN('plans','content','growth_reports')").run(a.t.id);
    ok(await call(a, "styles/test_style/versions/1.0.0/assets/pic.png"), 404);
    assert.equal(reads, 0);
}));

test("YX7I 深层模板和非法标量返回422，不触发500或写入草稿", () => using(async f => {
    const b = ok(await ops(f, "subject-packs")).items[0].versions[0];
    const d = structuredClone(b);
    d.pack_version = "0.2";
    d.content.extra = {};
    let at = d.content.extra;
    for (let i = 0; i < 25; i++) at = at.next = {};
    ok(await ops(f, "subject-packs", "POST", d), 422);
    for (const edit of [ x => x.courses[0].minutes = {}, x => x.calendar[0].months = [ "1" ], x => x.classes[0].options.stats = [ "lessons", "attendance", "repertoire_done", "camp_days" ] ]) {
        const c = structuredClone(b.content);
        edit(c);
        ok(await ops(f, "subject-packs", "POST", {
            ...b,
            pack_version: "0.2",
            content: c
        }), 422);
    }
}));

test("YX7I 平台开通使用当前发布模板，已有机构普通保存不自动换版", () => using(async f => {
    const original = ok(await ops(f, "subject-packs")).items.find(x => x.key === "music_interest").versions[0];
    const d = ok(await ops(f, "subject-packs", "POST", {
        ...original,
        name: "新版音乐模板",
        pack_version: "0.2"
    }), 201);
    assert.equal(d.name, "新版音乐模板");
    ok(await ops(f, "subject-packs/" + d.key + "/versions/0.2/publish", "POST", {
        version: d.version
    }));
    const tenant = ok(await ops(f, "tenants", "POST", {
        name: "新开通机构",
        slug: "stage7-new-school",
        staff_seat_limit: 10,
        subjects: [ "music_interest" ]
    }), 201);
    assert.equal(tenant.subjects[0].pack_version, "0.2");
    assert.ok(f.db.raw.prepare("SELECT COUNT(*) n FROM offer_courses WHERE tenant_id=?").get(tenant.id).n > 0);
    const next = ok(await ops(f, "subject-packs", "POST", {
        ...original,
        pack_version: "0.3"
    }), 201);
    ok(await ops(f, "subject-packs/" + next.key + "/versions/0.3/publish", "POST", {
        version: next.version
    }));
    const saved = ok(await ops(f, "tenants/" + tenant.id, "PUT", {
        version: tenant.version,
        name: tenant.name,
        slug: tenant.slug,
        subjects: [ "music_interest" ]
    }));
    assert.equal(saved.subjects[0].pack_version, "0.2");
}));

test("YX7I 纯成长风格财务不可读，文档类型和默认类型由服务器检查", () => using(async f => {
    const s = await setup(f, 1, "typedstyles");
    s.f = f;
    const m = manifest(f, "growth_only");
    m.doc_types = [ "report", "feedback_card" ];
    const row = ok(await upload(f, m), 201);
    ok(await publish(f, row));
    const {accountToken: accountToken} = await import("./fixtures-plans.mjs");
    const finance = await accountToken(s, [ "finance" ]);
    ok(await call(s, "styles/growth_only/versions/1.0.0/assets/pic.png", "GET", undefined, finance.token), 404);
    ok(await call(s, "plans", "POST", {
        student_id: s.students[0],
        subject: "music_interest",
        title: "错误类型",
        style: {
            pack_id: row.pack_id
        }
    }), 422);
    ok(await ops(f, "style-packs/default", "PUT", {
        doc_type: "plan",
        pack_id: row.pack_id
    }), 422);
}));
