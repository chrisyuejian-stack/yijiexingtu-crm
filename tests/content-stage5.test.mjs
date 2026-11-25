import test from "node:test";

import assert from "node:assert/strict";

import { school, call, ok, course, seed, accountToken, model, content, ai } from "./fixtures-ai.mjs";

test("YX5C 内容CRUD版本、筛选分页、状态人工标记、作者不可伪造、修订不可覆盖", () => school(async s => {
    const p = await content(s, {
        tenant_id: "foreign",
        author_id: "foreign"
    });
    assert.equal(p.author_id, s.user.id);
    assert.equal(p.tenant_id, undefined);
    assert.equal(p.status, "draft");
    const q = ok(await call(s, "content/" + p.id, "PUT", {
        version: p.version,
        title: "新标题"
    }));
    const conflict = ok(await call(s, "content/" + p.id, "PUT", {
        version: 1,
        title: "旧写入"
    }), 409);
    assert.equal(conflict.error, "version_conflict");
    assert.equal(conflict.details.latest.title, "新标题");
    assert.equal(ok(await call(s, "content?type=article&author=" + s.user.id + "&limit=1")).total, 1);
    assert.equal(ok(await call(s, "content?status=published")).total, 0);
    for (const status of [ "ready", "copied", "published", "draft" ]) {
        const current = ok(await call(s, "content/" + p.id));
        ok(await call(s, "content/" + p.id + "/status", "POST", {
            version: current.version,
            status: status
        }));
    }
    assert.equal(s.f.db.raw.prepare("SELECT COUNT(*) n FROM content_revisions WHERE tenant_id=?").get(s.t.id).n, 6);
    assert.throws(() => s.f.db.raw.prepare("UPDATE content_revisions SET doc_json='{}' WHERE tenant_id=?").run(s.t.id), /content_revision_immutable/);
    const current = ok(await call(s, "content/" + p.id));
    ok(await call(s, "content/" + p.id, "DELETE", {
        version: current.version
    }));
    ok(await call(s, "content/" + p.id), 404);
    assert.equal(ok(await call(s, "content")).total, 0);
}));

test("YX5C 七种纯文字块可保存，HTML、旧块类型、错误标题级别和不规则表格422", () => school(async s => {
    await s.r.settingsGalleryCreate({
        id: "img_content",
        r2_key: "local/image",
        mime: "image/png",
        width: 100,
        height: 100,
        tags: [],
        consent: false
    }, s.user);
    const b = [ {
        type: "heading",
        text: "标题",
        level: 2
    }, {
        type: "paragraph",
        text: "段落"
    }, {
        type: "list",
        items: [ "条目" ],
        ordered: true
    }, {
        type: "table",
        rows: [ [ "表头" ], [ "值" ] ]
    }, {
        type: "quote",
        text: "引用"
    }, {
        type: "image",
        image_id: "img_content",
        caption: "说明"
    }, {
        type: "divider"
    } ];
    const p = await content(s, {
        blocks: b
    });
    assert.deepEqual(p.blocks, b);
    assert.equal(s.f.db.raw.prepare("SELECT COUNT(*) n FROM setting_asset_refs WHERE tenant_id=? AND entity='content_revision'").get(s.t.id).n, 1);
    for (const blocks of [ [ {
        type: "p",
        text: "旧HTML块"
    } ], [ {
        type: "paragraph",
        text: "<script>bad<\/script>"
    } ], [ {
        type: "heading",
        text: "标题",
        level: 4
    } ], [ {
        type: "table",
        rows: [ [ "a" ], [ "a", "b" ] ]
    } ], [ {
        type: "list",
        items: [ "a" ],
        ordered: 1
    } ] ]) ok(await call(s, "content/" + p.id, "PUT", {
        version: p.version,
        blocks: blocks
    }), 422);
    ok(await call(s, "content/" + p.id, "PUT", {
        version: p.version,
        blocks: [ {
            type: "image",
            image_id: "img_foreign"
        } ]
    }), 404);
}));

test("YX5C 六种内容类型与场景来自本机构模板、节点和课程库", () => school(async s => {
    await seed(s);
    const scenes = ok(await call(s, "content/scenes"));
    assert.ok(scenes.items.some(x => x.id === "summer_camp"));
    assert.ok(scenes.items.some(x => x.required?.length));
    for (const type of [ "article", "moments", "xhs", "poster_text", "group_notice", "event_invite" ]) await content(s, {
        type: type
    });
    assert.equal(ok(await call(s, "content")).total, 6);
}));

test("YX5C 内容读改删、图库和来源跨机构404，只有主管顾问可读写", () => school(async s => {
    const p = await content(s), other = await (await import("./fixtures-credit.mjs")).setup(s.f, 1, "content-other");
    other.f = s.f;
    for (const [path, method, data] of [ [ "content/" + p.id, "GET" ], [ "content/" + p.id, "PUT", {
        version: p.version,
        title: "x"
    } ], [ "content/" + p.id, "DELETE", {} ], [ "content/" + p.id + "/status", "POST", {
        version: p.version,
        status: "ready"
    } ] ]) ok(await call(other, path, method, data), 404);
    assert.equal(ok(await call(other, "content")).total, 0);
    const finance = await accountToken(s, [ "finance" ]), academic = await accountToken(s, [ "academic" ]), consultant = await accountToken(s, [ "consultant" ]);
    for (const person of [ finance, academic ]) {
        ok(await call(s, "content", "GET", undefined, person.token), 403);
        ok(await call(s, "content", "POST", {
            type: "article",
            subject: "music_interest"
        }, person.token), 403);
    }
    ok(await call(s, "content/" + p.id, "GET", undefined, consultant.token));
    s.f.db.raw.prepare("UPDATE tenant_modules SET enabled=0 WHERE tenant_id=? AND id='content'").run(s.t.id);
    ok(await call(s, "content/" + p.id), 404);
}));

test("YX5C 内容风格锁版本，旧风格停用后仍可保存，来源字段不接受注入资料", () => school(async s => {
    const p = await content(s, {
        sources: {
            profile: true,
            course_ids: [],
            gallery_tags: [],
            prices: false,
            profile_data: {
                address: "伪造地址"
            }
        }
    });
    assert.equal(p.sources.profile_data, undefined);
    s.f.db.raw.prepare("UPDATE style_packs SET active=0 WHERE id='stp_article'").run();
    const q = ok(await call(s, "content/" + p.id, "PUT", {
        version: p.version,
        title: "仍可编辑"
    }));
    assert.equal(q.style.pack_version, "1.0.0");
    ok(await call(s, "content", "POST", {
        type: "article",
        subject: "music_interest",
        style: {
            pack_id: "stp_article"
        }
    }), 422);
}));

test("YX5C 六类内容AI使用冻结target与payload，保存采纳时重做校验", () => school(async s => {
    await seed(s);
    await s.r.settingsGalleryCreate({
        id: "img_own",
        r2_key: "local/image",
        mime: "image/png",
        width: 100,
        height: 100,
        tags: [ "作品" ],
        consent: true
    }, s.user);
    const p = await content(s, {
        sources: {
            profile: true,
            course_ids: [],
            gallery_tags: [ "作品" ],
            prices: false
        }
    });
    const scenarios = [ [ "outline", {
        sections: [ {
            key: "intro",
            title: "课程介绍",
            required: true,
            points: [ "了解课程" ]
        } ]
    }, {} ], [ "section", {
        section_key: "forged",
        blocks: [ {
            type: "paragraph",
            text: "段落",
            basis: [ 0 ]
        } ]
    }, {
        section_key: "intro"
    } ], [ "versions", {
        versions: {
            short: "短",
            medium: "中",
            long: "长"
        }
    }, {} ], [ "rewrite", {
        mode: "forged",
        blocks: [ {
            type: "paragraph",
            text: "改写结果"
        } ]
    }, {
        block_index: 0,
        mode: "shorten",
        text: "原文"
    } ], [ "fact-check", {
        items: [ {
            result: "match",
            block_index: 0,
            quote: "段落",
            expected: "伪造",
            source: "missing"
        } ]
    }, {} ], [ "images", {
        items: [ {
            section_key: "intro",
            image_ids: [ "img_own", "img_foreign" ],
            reason: "作品"
        } ]
    }, {} ] ];
    for (const [action, payload, extra] of scenarios) {
        model(s, {
            suggestions: [ {
                target: {
                    content_id: "foreign",
                    block_index: 99
                },
                payload: payload,
                basis: [ {
                    type: "ai_judgement",
                    text: "建议"
                } ]
            } ]
        });
        const r = ok(await ai(s, "content/" + action, {
            content_id: p.id,
            ...extra
        }));
        const suggestion = r.suggestions[0];
        assert.ok(suggestion, JSON.stringify(r));
        assert.equal(suggestion.kind, "content." + action.replace("-", "_"));
        assert.equal(suggestion.target.content_id, p.id);
        if (action === "rewrite") {
            assert.equal(suggestion.target.block_index, 0);
            assert.equal(suggestion.payload.mode, "shorten");
        }
        if (action === "section") assert.equal(suggestion.payload.section_key, "intro");
        if (action === "images") assert.deepEqual(suggestion.payload.items[0].image_ids, [ "img_own" ]);
        if (action === "fact-check") assert.equal(suggestion.payload.items[0].result, "needs_confirm");
        if (action === "section") {
            const saved = ok(await call(s, "content/" + p.id, "PUT", {
                version: p.version,
                blocks: suggestion.payload.blocks,
                applied_suggestion_ids: [ suggestion.id ]
            }));
            assert.deepEqual(saved.applied_suggestion_ids, [ suggestion.id ]);
            assert.equal(saved.blocks[0].basis, undefined);
        }
    }
}));

test("YX5C AI只看勾选资料，不发送隐藏图库、价格或客户端伪造资料", () => school(async s => {
    const c = await course(s, "选定课程", 999.99);
    const profile = ok(await call(s, "settings/profile"));
    ok(await call(s, "settings/profile", "PUT", {
        ...profile,
        address: "真实地址"
    }));
    await s.r.settingsGalleryCreate({
        id: "img_hidden",
        r2_key: "hidden",
        mime: "image/png",
        width: 1,
        height: 1,
        tags: [ "作品" ],
        consent: false
    }, s.user);
    s.f.db.raw.prepare("UPDATE gallery_images SET hidden=1 WHERE tenant_id=? AND id=?").run(s.t.id, "img_hidden");
    const p = await content(s, {
        sources: {
            profile: false,
            course_ids: [ c.id ],
            gallery_tags: [ "作品" ],
            prices: false
        }
    });
    model(s, {
        suggestions: [ {
            payload: {
                items: [ {
                    section_key: "intro",
                    image_ids: [ "img_hidden", "https://outside.invalid/image" ],
                    reason: "x"
                } ]
            }
        } ]
    });
    const r = ok(await ai(s, "content/images", {
        content_id: p.id,
        context: {
            profile: {
                address: "伪造地址"
            },
            course: {
                amount: 1
            }
        }
    }));
    const prompt = JSON.stringify(s.modelCalls[0].messages);
    assert.ok(!prompt.includes("999.99"));
    assert.ok(!prompt.includes("99999"));
    assert.ok(!prompt.includes("真实地址"));
    assert.ok(!prompt.includes("伪造地址"));
    assert.ok(!prompt.includes("img_hidden"));
    assert.deepEqual(r.suggestions, []);
    assert.ok(r.warnings.length);
}));

test("YX5C 来源核验不信任模型match、伪造依据不再标unsupported", () => school(async s => {
    const profile = ok(await call(s, "settings/profile"));
    ok(await call(s, "settings/profile", "PUT", {
        ...profile,
        address: "真实地址"
    }));
    const p = await content(s, {
        blocks: [ {
            type: "paragraph",
            text: "我们的地址是错误地址"
        } ],
        sources: {
            profile: true,
            course_ids: [],
            gallery_tags: [],
            prices: false
        }
    });
    model(s, {
        suggestions: [ {
            payload: {
                items: [ {
                    result: "match",
                    block_index: 0,
                    quote: "错误地址",
                    expected: "错误地址",
                    source: "profile.address"
                } ]
            },
            basis: [ {
                type: "profile",
                ref: "profile.address",
                quote: "编造的引用"
            } ]
        } ]
    });
    const r = ok(await ai(s, "content/fact-check", {
        content_id: p.id
    }));
    assert.equal(r.suggestions[0].payload.items[0].result, "mismatch");
    assert.equal(r.suggestions[0].payload.items[0].expected, "真实地址");
    assert.ok(!r.suggestions[0].basis.some(x => x.type === "unsupported"));
    assert.ok(r.suggestions[0].flags.some(x => x.kind === "fact_mismatch"));
}));

import { after } from "node:test";

import { mkdir, writeFile } from "node:fs/promises";

import { aiExamples } from "./fixtures-ai.mjs";

import { examples } from "./fixtures-plans.mjs";

after(async () => {
    await mkdir("work/stage5", {
        recursive: true
    });
    await writeFile("work/stage5/content-http-" + (process.env.TEST_BUNDLE === "1" ? "bundle" : "source") + ".json", JSON.stringify({
        local_only: true,
        examples: [ ...examples.filter(x => /\/api\/content/.test(x.request.path)), ...aiExamples ]
    }, null, 2) + "\n");
});

test("YX5C 勾选机构档案允许使用公开业务电话，不与学员隐私字段混用", () => school(async s => {
    const profile = ok(await call(s, "settings/profile"));
    ok(await call(s, "settings/profile", "PUT", {
        ...profile,
        contact_phone: "13800001111"
    }));
    const c = await content(s, {
        sources: {
            profile: true,
            course_ids: [],
            gallery_tags: [],
            prices: false
        }
    });
    model(s, {
        suggestions: [ {
            payload: {
                versions: {
                    short: "联系电话13800001111",
                    medium: "联系电话13800001111",
                    long: "联系电话13800001111"
                }
            },
            basis: [ {
                type: "profile",
                ref: "profile.contact_phone",
                quote: "13800001111"
            } ]
        } ]
    });
    const r = ok(await ai(s, "content/versions", {
        content_id: c.id
    }));
    assert.ok(JSON.stringify(s.modelCalls[0].messages).includes("13800001111"));
    assert.ok(r.suggestions[0].basis.some(x => x.type === "profile" && x.quote === "13800001111"));
}));

// Common styles remain usable when institutions buy content independently.
test("YX5C 内容模块独立读取文章风格，停用且撤销范围后本机构旧文件仍可读取锁定版本", () => school(async s => {
    const p = await content(s);
    s.f.db.raw.prepare("UPDATE tenant_modules SET enabled=0 WHERE tenant_id=? AND id='plans'").run(s.t.id);
    const styles = ok(await call(s, "styles?doc_type=article")).items;
    assert.ok(styles.some(x => x.id === p.style.pack_id));
    ok(await call(s, "styles?doc_type=plan"), 404);
    s.f.db.raw.prepare("UPDATE style_packs SET active=0,scope_all=0 WHERE id='stp_article'").run();
    assert.deepEqual(ok(await call(s, "styles?doc_type=article")).items, []);
    const locked = ok(await call(s, "styles/stp_article/versions/1.0.0"));
    assert.equal(locked.id, p.style.pack_id);
    assert.ok(locked.manifest.doc_types.includes("article"));
    const {setup: setup} = await import("./fixtures-credit.mjs");
    const other = await setup(s.f, 1, "style-other");
    other.f = s.f;
    ok(await call(other, "styles/stp_article/versions/1.0.0"), 404);
    s.f.db.raw.prepare("UPDATE tenant_modules SET enabled=0 WHERE tenant_id=? AND id='content'").run(s.t.id);
    ok(await call(s, "styles/stp_article/versions/1.0.0"), 404);
}));
