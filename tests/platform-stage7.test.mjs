import test, { after } from "node:test";

import assert from "node:assert/strict";

import { readFile, writeFile, mkdir } from "node:fs/promises";

import { createHash } from "node:crypto";

import { fixture } from "./support.mjs";

import { setup } from "./fixtures-credit.mjs";

import { school, call, filled, accountToken, parent } from "./fixtures-plans.mjs";

import { growthSchool, batch, readyDoc } from "./fixtures-growth.mjs";

import { ops, ok, upload, publish, manifest, zipFiles, png, platformExamples } from "./fixtures-platform.mjs";

const subject = async f => ok(await ops(f, "subject-packs")).items.find(x => x.key === "music_interest").versions.find(x => x.pack_version === "0.1");

async function newSubject(f, extra = {}) {
    const old = await subject(f);
    const d = {
        ...old,
        pack_version: "0.2",
        ...extra
    };
    delete d.status;
    delete d.published_at;
    return ok(await ops(f, "subject-packs", "POST", d), 201);
}

async function release(f, row) {
    return ok(await ops(f, "subject-packs/" + row.key + "/versions/" + row.pack_version + "/publish", "POST", {
        version: row.version
    }));
}

async function using(fn) {
    const f = await fixture();
    try {
        await fn(f);
    } finally {
        f.restore();
    }
}

test("YX7 模板草稿编辑版本、发布不可变、既有0.1与原迁移保留", () => using(async f => {
    const base = JSON.parse(await readFile("docs/reference/stage7-implementation-baseline-sha256.json", "utf8"));
    for (const x of base.files.filter(x => x.path.startsWith("migrations/"))) assert.equal(createHash("sha256").update(await readFile(x.path)).digest("hex"), x.sha256);
    const d = await newSubject(f);
    ok(await ops(f, "subject-packs", "PUT", {
        ...d,
        version: 99
    }), 409);
    const saved = ok(await ops(f, "subject-packs", "PUT", d));
    assert.equal(saved.version, 2);
    await release(f, saved);
    ok(await ops(f, "subject-packs", "PUT", saved), 409);
    ok(await ops(f, "subject-packs", "POST", saved), 409);
    assert.throws(() => f.db.raw.prepare("UPDATE subject_pack_versions SET content_json='{}' WHERE key='music_interest' AND pack_version='0.2'").run(), /subject_version_immutable/);
}));

test("YX7 模板错误引用、价格、机构ID和未知学科422，失败不留草稿", () => using(async f => {
    const old = await subject(f);
    for (const edit of [ c => c.courses[0].pricing = {
        amount: 1
    }, c => c.courses[0].tenant_id = "foreign", c => c.course_rules = [ {
        stage_key: "missing",
        required: [],
        recommended: [],
        exclusive: [],
        units: {
            min: 0,
            max: 1
        }
    } ], c => c.courses.push({
        ...c.courses[0]
    }) ]) {
        const d = structuredClone(old);
        d.pack_version = "0.2";
        edit(d.content);
        ok(await ops(f, "subject-packs", "POST", d), 422);
    }
    ok(await ops(f, "subject-packs", "POST", {
        ...old,
        key: "dance_new"
    }), 422);
    assert.equal(f.db.raw.prepare("SELECT COUNT(*) n FROM subject_pack_versions WHERE pack_version='0.2'").get().n, 0);
}));

test("YX7 新机构按发布版导入，课程/阶段规则映射各自机构正式ID", () => using(async f => {
    const old = await subject(f), c = old.content;
    c.course_rules = [ {
        stage_key: c.stages[0].key,
        required: [ c.courses[0].key ],
        recommended: [],
        exclusive: [],
        units: {
            min: 6,
            max: 20
        }
    } ];
    const v = await newSubject(f, {
        content: c
    });
    await release(f, v);
    const a = await setup(f, 1, "importa"), b = await setup(f, 1, "importb");
    for (const s of [ a, b ]) {
        ok(await s.call("settings/subjects", "POST", {
            key: "music_interest"
        }));
        const rules = ok(await s.call("settings/course-rules")).items;
        assert.equal(rules.length, 1);
        assert.ok(f.db.raw.prepare("SELECT id FROM offer_courses WHERE tenant_id=? AND id=?").get(s.t.id, rules[0].required[0]));
        assert.ok(f.db.raw.prepare("SELECT id FROM stage_types WHERE tenant_id=? AND id=?").get(s.t.id, rules[0].stage_type_id));
    }
    assert.notEqual(ok(await a.call("settings/course-rules")).items[0].required[0], ok(await b.call("settings/course-rules")).items[0].required[0]);
}));

test("YX7 老机构不自动更新，显式导入只追加key，原价格/改名/维度/日历不覆盖，同版幂等", () => school(async s => {
    ok(await call(s, "settings/subjects", "POST", {
        key: "music_interest"
    }));
    let course = ok(await call(s, "settings/courses")).items[0];
    course = ok(await call(s, "settings/courses/" + course.id, "PUT", {
        ...course,
        name: "机构改名",
        pricing: {
            mode: "per_unit",
            amount: 321,
            unit_label: "课时"
        }
    }));
    const before = fingerprint(s);
    const old = await subject(s.f);
    old.content.courses[0].name = "平台新版名称";
    old.content.courses.push({
        ...old.content.courses[0],
        key: "extra_course",
        name: "追加新课"
    });
    const v = await newSubject(s.f, {
        content: old.content
    });
    await release(s.f, v);
    assert.equal(fingerprint(s), before);
    ok(await call(s, "settings/subjects", "POST", {
        key: "music_interest"
    }));
    const courses = ok(await call(s, "settings/courses")).items;
    assert.equal(courses.find(x => x.id === course.id).name, "机构改名");
    assert.equal(courses.find(x => x.id === course.id).pricing.amount, 321);
    assert.ok(courses.some(x => x.name === "追加新课"));
    const after = fingerprint(s);
    ok(await call(s, "settings/subjects", "POST", {
        key: "music_interest"
    }));
    assert.equal(fingerprint(s), after);
}));

function fingerprint(s) {
    return JSON.stringify(s.f.db.raw.prepare("SELECT * FROM offer_courses WHERE tenant_id=? ORDER BY id").all(s.t.id));
}

test("YX7 手建同名项不冒充模板key，规则无法映射整次422回滚", () => school(async s => {
    const old = await subject(s.f), c = old.content;
    ok(await call(s, "settings/courses", "POST", {
        ...c.courses[0],
        subject: "music_interest",
        pricing: null
    }), 201);
    c.course_rules = [ {
        stage_key: c.stages[0].key,
        required: [ c.courses[0].key ],
        recommended: [],
        exclusive: [],
        units: {
            min: 1,
            max: 6
        }
    } ];
    await release(s.f, await newSubject(s.f, {
        content: c
    }));
    const before = fingerprint(s);
    ok(await call(s, "settings/subjects", "POST", {
        key: "music_interest"
    }), 422);
    assert.equal(fingerprint(s), before);
    assert.equal(s.f.db.raw.prepare("SELECT COUNT(*) n FROM setting_template_refs WHERE tenant_id=?").get(s.t.id).n, 0);
}));

test("YX7 ZIP上传校验/草稿预览不写业务、不调用AI，图片二进制原样", () => using(async f => {
    const d = ok(await upload(f), 201);
    assert.equal(d.status, "draft");
    assert.ok(d.checks.warnings.length);
    const before = f.db.raw.prepare("SELECT COUNT(*) n FROM plans").get().n;
    const p = ok(await ops(f, "style-packs/" + d.pack_id + "/versions/1.0.0/preview", "POST", {}));
    assert.equal(p.previews.length, 4);
    assert.ok(p.previews.every(x => x.render_data.style.pack_id === d.pack_id));
    assert.equal(f.db.raw.prepare("SELECT COUNT(*) n FROM plans").get().n, before);
    const image = ok(await ops(f, "style-packs/" + d.pack_id + "/versions/1.0.0/assets/pic.png"));
    assert.equal(image.base64, png.toString("base64"));
    assert.equal(f.db.raw.prepare("SELECT COUNT(*) n FROM ai_usage").get().n, 0);
}));

test("YX7 静态对比度/字体/组件/坏路径/脚本/CRC/真实格式错误均拒绝，不生成版本", () => using(async f => {
    for (const change of [ m => m.tokens.color.ink = m.tokens.color.paper, m => m.tokens.color.muted = m.tokens.color.paper, m => m.tokens.font.body = "evilfont", m => m.components["plan.cover"] = "script", m => m.decor.corner_image = "https://evil.test/x.png" ]) {
        const m = manifest(f);
        change(m);
        assert.equal(ok(await upload(f, m), 422).error, "style_pack_invalid");
    }
    ok(await upload(f, manifest(f), {
        "assets/x.svg": "<svg/>"
    }), 422);
    ok(await upload(f, manifest(f), {
        "assets/bad.png": "html"
    }), 422);
    const form = new FormData, b = zipFiles({
        "manifest.json": JSON.stringify(manifest(f)),
        "assets/pic.png": png
    }, false);
    b[b.indexOf(png) + 4] ^= 1;
    form.set("file", new Blob([ b ]), "bad.zip");
    ok(await ops(f, "style-packs/upload", "POST", form), 422);
    assert.equal(f.db.raw.prepare("SELECT COUNT(*) n FROM style_packs WHERE id='test_style'").get().n, 0);
}));

test("YX7 发布范围、默认回退、旧版本和图片不可覆盖，草稿对机构不可读", () => school(async s => {
    const a = ok(await upload(s.f), 201);
    ok(await call(s, "styles/" + a.pack_id + "/versions/1.0.0"), 404);
    ok(await publish(s.f, a, "tenants", [ "foreign" ]), 404);
    ok(await publish(s.f, {
        ...a,
        version: 999
    }), 409);
    ok(await publish(s.f, a, "tenants", [ s.t.id ]));
    const list = ok(await call(s, "styles?doc_type=plan")).items;
    assert.ok(list.some(x => x.id === a.pack_id));
    const other = await setup(s.f, 1, "otherstyle");
    ok(await other.call("styles/" + a.pack_id + "/versions/1.0.0"), 404);
    ok(await ops(s.f, "style-packs/default", "PUT", {
        doc_type: "plan",
        pack_id: a.pack_id
    }));
    const p = ok(await call(s, "plans", "POST", {
        student_id: s.students[0],
        subject: "music_interest",
        title: "默认包方案"
    }), 201);
    assert.equal(p.style.pack_id, a.pack_id);
    const image = await call(s, "styles/" + a.pack_id + "/versions/1.0.0/assets/pic.png");
    assert.equal(image.status, 200);
    ok(await upload(s.f, manifest(s.f)), 409);
    assert.throws(() => s.f.db.raw.prepare("UPDATE style_assets SET r2_key='oops'").run(), /style_asset_immutable/);
    ok(await ops(s.f, "style-packs/" + a.pack_id + "/disable", "POST", {}));
    assert.ok(!ok(await call(s, "styles")).items.some(x => x.id === a.pack_id));
    ok(await call(s, "styles/" + a.pack_id + "/versions/1.0.0"));
    const newer = ok(await call(s, "plans", "POST", {
        student_id: s.students[0],
        subject: "music_interest",
        title: "回退方案"
    }), 201);
    assert.notEqual(newer.style.pack_id, a.pack_id);
}));

test("YX7 平台接口只认超管owner和Access，不接受机构会话冒用", () => school(async s => {
    ok(await ops(s.f, "subject-packs", "GET", undefined, ""), 401);
    ok(await ops(s.f, "style-packs", "GET", undefined, "channel_session=" + s.token), 401);
    const response = await s.f.request("https://" + s.f.env.CONSOLE_HOST + "/api/ops/style-packs", {
        headers: {
            Cookie: s.f.adminCookie
        }
    });
    assert.equal(response.status, 403);
}));

test("YX7 财务不能借图片入口读取成长资源，老师不能借入口读方案包", () => growthSchool(async s => {
    const a = ok(await upload(s.f), 201);
    ok(await publish(s.f, a));
    const finance = await accountToken(s, [ "finance" ]);
    ok(await call(s, "styles/" + a.pack_id + "/versions/1.0.0/assets/pic.png", "GET", undefined, finance.token));
    const only = manifest(s.f, "plan_only");
    only.doc_types = [ "plan" ];
    const row = ok(await upload(s.f, only), 201);
    ok(await publish(s.f, row));
    ok(await call(s, "styles/plan_only/versions/1.0.0/assets/pic.png", "GET", undefined, s.teacherAccount.token), 404);
}));

after(async () => {
    await mkdir("work/stage7/implementation", {
        recursive: true
    });
    await writeFile("work/stage7/implementation/platform-http-" + (process.env.TEST_BUNDLE === "1" ? "bundle" : "source") + ".json", JSON.stringify({
        local_only: true,
        examples: platformExamples
    }, null, 2));
});

test("YX7 家长/分享图片只读可见修订，包更新停用不换图，解绑与作废立即404", () => school(async s => {
    const row = ok(await upload(s.f), 201);
    ok(await publish(s.f, row));
    let p = await filled(s);
    p = ok(await call(s, "plans/" + p.id, "PUT", {
        ...p,
        style: {
            ...p.style,
            pack_id: row.pack_id,
            pack_version: row.pack_version
        }
    }));
    const pa = await parent(s);
    ok(await call(s, "parent/plans/" + p.id + "/style-assets/pic.png", "GET", undefined, pa.token), 404);
    p = ok(await call(s, "plans/" + p.id + "/send", "POST", {}));
    const link = ok(await call(s, "plans/" + p.id + "/share-links", "POST", {}), 201), token = link.url.split("/").at(-1), path = "/api/share/" + token + "/style-assets/pic.png";
    let response = await call(s, "parent/plans/" + p.id + "/style-assets/pic.png", "GET", undefined, pa.token);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control"), /no-store/);
    assert.equal((await call(s, path, "GET", undefined, null)).status, 200);
    const info = ok(await call(s, "parent/plans/" + p.id, "GET", undefined, pa.token));
    assert.ok(info.asset_base.endsWith("/style-assets/"));
    const v2 = ok(await upload(s.f, manifest(s.f, "test_style", "2.0.0")), 201);
    ok(await publish(s.f, v2));
    ok(await ops(s.f, "style-packs/test_style/disable", "POST", {}));
    assert.equal((await call(s, path, "GET", undefined, null)).status, 200);
    assert.equal((await call(s, "parent/plans/" + p.id + "/style-assets/pic.png", "GET", undefined, pa.token)).status, 200);
    const other = await accountToken(s, [ "student" ], s.students[1]);
    ok(await call(s, "parent/plans/" + p.id + "/style-assets/pic.png", "GET", undefined, other.token), 404);
    const links = ok(await call(s, "students/" + s.students[0] + "/guardians")).items;
    ok(await call(s, "students/" + s.students[0] + "/guardians/" + links[0].id, "DELETE", {}));
    ok(await call(s, "parent/plans/" + p.id + "/style-assets/pic.png", "GET", undefined, pa.token), 401);
    ok(await call(s, "plans/" + p.id + "/share-links/" + link.id, "DELETE", {}));
    const bad = await call(s, path, "GET", undefined, null);
    assert.equal(bad.status, 404);
    assert.equal(bad.text, (await call(s, "/api/share/invalid/style-assets/pic.png", "GET", undefined, null)).text);
}));

test("YX7 报告图片按已发布指针，不给工作稿或其他孩子；撤回即时收回", () => growthSchool(async s => {
    const row = ok(await upload(s.f), 201);
    ok(await publish(s.f, row));
    ok(await ops(s.f, "style-packs/default", "PUT", {
        doc_type: "report",
        pack_id: row.pack_id
    }));
    const b = await batch(s);
    let r = await readyDoc(s, b.reports[0]);
    assert.equal(r.style.pack_id, row.pack_id);
    const pa = await parent(s);
    ok(await call(s, "parent/reports/" + r.id + "/style-assets/pic.png", "GET", undefined, pa.token), 404);
    ok(await call(s, "reports/" + r.id + "/ready", "POST", {}));
    ok(await call(s, "reports/" + r.id + "/publish", "POST", {}));
    assert.equal((await call(s, "parent/reports/" + r.id + "/style-assets/pic.png", "GET", undefined, pa.token)).status, 200);
    ok(await call(s, "parent/reports/" + b.reports[1].id + "/style-assets/pic.png", "GET", undefined, pa.token), 404);
    ok(await call(s, "reports/" + r.id + "/unpublish", "POST", {
        reason: "撤回测试"
    }));
    ok(await call(s, "parent/reports/" + r.id + "/style-assets/pic.png", "GET", undefined, pa.token), 404);
}));

test("YX7 admin_only只供平台，机构/伪造tenant_id和路径穿越都不能取图", () => school(async s => {
    const row = ok(await upload(s.f), 201);
    ok(await publish(s.f, row, "admin_only"));
    ok(await call(s, "styles/test_style/versions/1.0.0/assets/pic.png?tenant_id=" + s.t.id), 404);
    ok(await ops(s.f, "style-packs/test_style/versions/1.0.0/assets/pic.png"));
    for (const tail of [ "%2e%2e/x.png", "http%3Aevil.png", "%5Cx.png", "x%00.png", "unknown.png" ]) ok(await ops(s.f, "style-packs/test_style/versions/1.0.0/assets/" + tail), 404);
}));

test("YX7 无默认范围时回退可用包；全部不可用时报错，不绕过scope", () => school(async s => {
    const row = ok(await upload(s.f), 201);
    ok(await publish(s.f, row, "admin_only"));
    ok(await ops(s.f, "style-packs/default", "PUT", {
        doc_type: "plan",
        pack_id: row.pack_id
    }));
    let p = ok(await call(s, "plans", "POST", {
        student_id: s.students[0],
        subject: "music_interest",
        title: "默认回退"
    }), 201);
    assert.notEqual(p.style.pack_id, row.pack_id);
    s.f.db.raw.prepare("UPDATE style_packs SET active=0").run();
    ok(await call(s, "plans", "POST", {
        student_id: s.students[0],
        subject: "music_interest",
        title: "无可用风格"
    }), 422);
}));

test("YX7 AI机构覆盖清零/取消、平台分组统计北京时间、词库写入留审计且机构禁用词随之生效", () => school(async s => {
    ok(await ops(s.f, "tenants/" + s.t.id + "/ai-override", "PUT", {
        fast_daily_limit: 0,
        deep_daily_limit: null
    }));
    assert.equal(ok(await ops(s.f, "tenants/" + s.t.id)).ai_override.fast_daily_limit, 0);
    ok(await ops(s.f, "tenants/" + s.t.id + "/ai-override", "PUT", {
        fast_daily_limit: null,
        deep_daily_limit: null
    }));
    ok(await ops(s.f, "tenants/foreign/ai-override", "PUT", {
        fast_daily_limit: 1,
        deep_daily_limit: 2
    }), 404);
    ok(await ops(s.f, "tenants/" + s.t.id + "/ai-override", "PUT", {
        fast_daily_limit: -1,
        deep_daily_limit: 2
    }), 422);
    const {model: model, ai: ai} = await import("./fixtures-ai.mjs");
    const {content: content} = await import("./fixtures-ai.mjs");
    await call(s, "settings/subjects", "POST", {
        key: "music_interest"
    });
    const c = await content(s);
    model(s);
    ok(await ai(s, "content/versions", {
        content_id: c.id
    }));
    const day = (new Date).toLocaleDateString("sv-SE", {
        timeZone: "Asia/Shanghai"
    });
    for (const group of [ "day", "tenant", "tool" ]) {
        const u = ok(await ops(s.f, "ai/usage?from=" + day + "&to=" + day + "&group=" + group + "&tenant_id=" + s.t.id));
        assert.equal(u.items.reduce((n, x) => n + x.calls, 0), 1);
    }
    ok(await ops(s.f, "ai/usage?from=bad&to=bad"), 422);
    ok(await ops(s.f, "compliance/terms"));
    ok(await ops(s.f, "compliance/terms", "PUT", {
        terms: [ "测试禁词", "包过" ]
    }));
    assert.ok(ok(await call(s, "compliance/terms")).items.includes("测试禁词"));
    assert.ok(s.f.db.raw.prepare("SELECT id FROM platform_audit WHERE action='save_compliance'").get());
}));

test("YX7 R2写失败与SQL失败回滚，不留可发布元数据，不覆盖旧对象", () => using(async f => {
    const put = f.env.CHANNEL_MEDIA.put.bind(f.env.CHANNEL_MEDIA);
    f.env.CHANNEL_MEDIA.put = async () => {
        throw Error("local R2 fault");
    };
    ok(await upload(f), 500);
    assert.equal(f.db.raw.prepare("SELECT COUNT(*) n FROM style_packs WHERE id='test_style'").get().n, 0);
    f.env.CHANNEL_MEDIA.put = put;
    f.db.raw.exec("CREATE TRIGGER fail_style_asset BEFORE INSERT ON style_assets BEGIN SELECT RAISE(ABORT,'local fault'); END");
    ok(await upload(f), 500);
    assert.equal(f.env.CHANNEL_MEDIA.objects.size, 0);
    assert.equal(f.db.raw.prepare("SELECT COUNT(*) n FROM style_packs WHERE id='test_style'").get().n, 0);
}));

test("YX7 超大单图与解压总量拒绝；存储/压缩ZIP均可，嵌套目录合法", () => using(async f => {
    const oversized = new FormData();
    oversized.set("file", new Blob([Buffer.alloc(10 * 1024 * 1024 + 65537)]), "huge.zip");
    assert.equal(ok(await ops(f, "style-packs/upload", "POST", oversized), 422).error, "style_pack_invalid");
    ok(await upload(f, manifest(f), {
        "assets/large.png": Buffer.alloc(2 * 1024 * 1024 + 1)
    }), 422);
    const m = manifest(f);
    m.decor.corner_image = "assets/sub/a.png";
    m.thumbnail = null;
    const form = new FormData;
    form.set("file", new Blob([ zipFiles({
        "manifest.json": JSON.stringify(m),
        "assets/sub/": "",
        "assets/sub/a.png": png
    }, false) ]), "stored.zip");
    ok(await ops(f, "style-packs/upload", "POST", form), 201);
    const many = {
        "manifest.json": JSON.stringify(manifest(f, "total_limit"))
    };
    for (let i = 0; i < 5; i++) many["assets/image" + i + ".png"] = Buffer.concat([ png, Buffer.alloc(2 * 1024 * 1024 - png.length) ]);
    const big = new FormData;
    big.set("file", new Blob([ zipFiles(many) ]), "total.zip");
    ok(await ops(f, "style-packs/upload", "POST", big), 422);
    const chinese = manifest(f, "unicode_style");
    chinese.decor.corner_image = "assets/子目录/画室.图.PNG";
    chinese.thumbnail = null;
    const chineseForm = new FormData;
    chineseForm.set("file", new Blob([ zipFiles({
        "manifest.json": JSON.stringify(chinese),
        "assets/子目录/": "",
        "assets/子目录/画室.图.PNG": png
    }) ]), "unicode.zip");
    ok(await ops(f, "style-packs/upload", "POST", chineseForm), 201);
    ok(await ops(f, "style-packs/unicode_style/versions/1.0.0/assets/" + encodeURI("子目录/画室.图.PNG")));
}));

test("YX7 上传提交成功但回执丢失时保留图片并返回已提交版本", () => using(async f => {
    const batch = f.db.batch.bind(f.db);
    let once = true;
    f.db.batch = async rows => {
        const result = await batch(rows);
        if (once && rows.some(x => x.query.includes("INSERT INTO style_assets"))) {
            once = false;
            throw Error("lost ACK");
        }
        return result;
    };
    const row = ok(await upload(f), 201);
    assert.equal(row.status, "draft");
    assert.equal(f.env.CHANNEL_MEDIA.objects.size, 1);
    ok(await ops(f, "style-packs/test_style/versions/1.0.0/assets/pic.png"));
}));

test("YX7 同版本并发重复导入幂等，不留重复课程或半份映射", () => school(async s => {
    const rows = await Promise.all([ call(s, "settings/subjects", "POST", {
        key: "music_interest"
    }), call(s, "settings/subjects", "POST", {
        key: "music_interest"
    }) ]);
    for (const r of rows) ok(r);
    const count = s.f.db.raw.prepare("SELECT COUNT(*) n FROM offer_courses WHERE tenant_id=?").get(s.t.id).n;
    assert.equal(count, (await subject(s.f)).content.courses.length);
    assert.deepEqual(s.f.db.raw.prepare("PRAGMA foreign_key_check").all(), []);
}));
