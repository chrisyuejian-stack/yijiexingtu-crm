import test from "node:test";

import assert from "node:assert/strict";

import { school, call, ok, seed, course, draft, filled, parent, accountToken, examples } from "./fixtures-plans.mjs";

import { calendarWeeks, coveredMonths, allocateCents, centsProduct } from "../src/server/plan-math.js";

import { writeFile, mkdir } from "node:fs/promises";

test("YX4 基础方案创建、列表、读写、修订、并发版本与草稿删除", () => school(async s => {
    const p = await draft(s);
    assert.equal(p.status, "draft");
    assert.equal(p.computed.total.amount, 0);
    assert.equal(p.meta.consultant_id, s.user.id);
    assert.equal(p.tenant_id, undefined);
    assert.equal(ok(await call(s, "plans")).total, 1);
    assert.equal(ok(await call(s, "plans/" + p.id)).id, p.id);
    const u = ok(await call(s, "plans/" + p.id, "PUT", {
        version: p.version,
        title: "已修改"
    }));
    assert.equal(u.version, 2);
    assert.equal(u.title, "已修改");
    const conflict = ok(await call(s, "plans/" + p.id, "PUT", {
        version: 1,
        title: "冲突"
    }), 409);
    assert.equal(conflict.error, "version_conflict");
    assert.equal(conflict.details.latest.version, 2);
    const revisions = ok(await call(s, "plans/" + p.id + "/revisions"));
    assert.equal(revisions.total, 2);
    const restored = ok(await call(s, "plans/" + p.id + "/revisions/" + revisions.items[1].id + "/restore", "POST", {
        version: 2
    }));
    assert.equal(restored.title, p.title);
    assert.equal(restored.version, 3);
    ok(await call(s, "plans/" + p.id, "DELETE", {
        version: 3
    }));
    ok(await call(s, "plans/" + p.id), 404);
    assert.equal(ok(await call(s, "plans")).total, 0);
}));

test("YX4 金额伪造和快照伪造被忽略、临时引用统一改写", () => school(async s => {
    const p = await filled(s);
    assert.equal(p.computed.total.amount, 400);
    const stage = p.modules.path.stages[0], line = p.modules.courses.lines[0];
    assert.match(stage.key, /^stk_/);
    assert.match(line.line_id, /^ln_/);
    assert.equal(line.stage_key, stage.key);
    assert.equal(p.id_map.tmp_stage_1, stage.key);
    const u = ok(await call(s, "plans/" + p.id, "PUT", {
        ...p,
        computed: {
            total: {
                amount: .01
            }
        },
        modules: {
            ...p.modules,
            courses: {
                visible: true,
                lines: [ {
                    ...line,
                    amount: .01,
                    snapshot: {
                        pricing: {
                            amount_cents: 1
                        }
                    }
                } ]
            }
        }
    }));
    assert.equal(u.computed.total.amount, 400);
    assert.equal(u.modules.courses.lines[0].snapshot.pricing.amount_cents, 2e4);
}));

test("YX4 日历周、自然月、整数分分配纯函数边界", () => {
    assert.deepEqual([ [ "2026-12-01", "2026-12-31" ], [ "2027-01-01", "2027-02-28" ], [ "2027-03-01", "2027-05-31" ], [ "2027-06-01", "2027-07-31" ] ].map(x => calendarWeeks(...x)), [ 4, 8, 13, 9 ]);
    assert.equal(coveredMonths("2027-12-31", "2028-01-01"), 2);
    assert.equal(calendarWeeks("2028-02-01", "2028-02-29"), 4);
    assert.throws(() => calendarWeeks("2027-02-29", "2027-03-01"));
    assert.equal(centsProduct(1, .5), 1);
    assert.deepEqual(allocateCents(30001, [ 5e3, 5e3 ]), [ 15001, 15e3 ]);
    assert.deepEqual(allocateCents(2, [ 3333, 3333, 3334 ]), [ 1, 0, 1 ]);
    assert.deepEqual(allocateCents(0, [ 1, 9999 ]), [ 0, 0 ]);
    for (let n = 0; n < 1e3; n++) assert.equal(allocateCents(n, [ 2e3, 3e3, 5e3 ]).reduce((a, b) => a + b), n);
});

import { golden } from "./fixtures-plans.mjs";

test("YX4 范例A：完整四阶段得到11400元、49课时和寒假营1期", () => school(async s => {
    const p = await golden(s, "A");
    assert.equal(p.computed.total.amount, 11400);
    assert.equal(p.computed.total.units, 49);
    assert.deepEqual(p.computed.total.bundles, [ "寒假钢琴集训营 1 期" ]);
    assert.deepEqual(p.computed.stages.map(x => x.amount), [ 800, 3600, 3640, 3360 ]);
    assert.deepEqual(p.computed.stages.map(x => x.calendar_weeks), [ 4, 8, 13, 9 ]);
    assert.equal(p.computed.budget.remaining, 600);
    assert.equal(p.computed.cover_numbers[0].value, "8");
    assert.deepEqual(p.computed.installments.map(x => x.amount), [ 800, 3600, 3640, 3360 ]);
    assert.deepEqual(p.computed.installments.map(x => x.due), [ "2026-11-30", "2026-12-31", "2027-02-28", "2027-05-31" ]);
    assert.equal(p.computed.days_to_exam, undefined);
}));

test("YX4 范例B：学期、期、4×6500元按月不重计包含项，总价68000元", () => school(async s => {
    const p = await golden(s, "B");
    assert.equal(p.computed.total.amount, 68e3);
    assert.equal(p.computed.total.units, 0);
    assert.deepEqual(p.computed.stages.map(x => x.amount), [ 14e3, 16e3, 26e3, 12e3 ]);
    assert.deepEqual(p.computed.stages.map(x => x.weeks_display), [ 30, 8, 16, 10 ]);
    assert.equal(p.computed.optional_fees.length, 1);
    assert.equal(p.computed.optional_fees[0].label, "画室公寓住宿");
    assert.equal(p.computed.installments.reduce((n, x) => n + x.amount, 0), 68e3);
    assert.equal(p.computed.days_to_exam, undefined);
}));

test("YX4 课包按包收一次钱，课时按包内课时相乘，包含项不收费", () => school(async s => {
    const p = await filled(s), c = await course(s, "十课时包", 900, "package");
    const out = ok(await call(s, "plans/" + p.id, "PUT", {
        ...p,
        modules: {
            ...p.modules,
            courses: {
                visible: true,
                lines: [ {
                    line_id: "tmp_pack",
                    stage_key: p.modules.path.stages[0].key,
                    course_id: c.id,
                    qty: {
                        packages: 2
                    },
                    includes: [ {
                        label: "讲评",
                        amount: 999999
                    } ]
                } ]
            }
        }
    }));
    assert.equal(out.computed.total.amount, 1800);
    assert.equal(out.computed.total.units, 20);
}));

test("YX4 自定义分期按整数分分配，引用临时ID并忽略客户端金额", () => school(async s => {
    const p = await filled(s, {
        amount: 300.01,
        qty: 1,
        modules: {
            fees: {
                installments: "custom",
                custom: [ {
                    stage_key: "tmp_stage_1",
                    label: "首期",
                    due: "2026-11-30",
                    ratio_bps: 5e3,
                    amount: 1
                }, {
                    stage_key: null,
                    label: "尾款",
                    due: null,
                    ratio_bps: 5e3,
                    amount: 999
                } ],
                due_dates: {}
            }
        }
    });
    assert.deepEqual(p.computed.installments.map(x => x.amount), [ 150.01, 150 ]);
    assert.equal(p.modules.fees.custom[0].stage_key, p.modules.path.stages[0].key);
    assert.equal(p.modules.fees.custom[0].amount, undefined);
    assert.equal(p.computed.installments[1].due, null);
    const full = ok(await call(s, "plans/" + p.id, "PUT", {
        ...p,
        modules: {
            ...p.modules,
            fees: {
                installments: "custom",
                custom: [ {
                    label: "一次付清",
                    stage_key: null,
                    due: null,
                    ratio_bps: 1e4
                } ]
            }
        }
    }));
    assert.equal(full.computed.installments[0].amount, 300.01);
}));

test("YX4 自定义分期排除可选费用，零总额也守恒", () => school(async s => {
    const p = await golden(s, "B");
    const q = ok(await call(s, "plans/" + p.id, "PUT", {
        ...p,
        modules: {
            ...p.modules,
            fees: {
                installments: "custom",
                custom: [ {
                    stage_key: null,
                    label: "首付",
                    due: null,
                    ratio_bps: 4e3
                }, {
                    stage_key: null,
                    label: "尾款",
                    due: "2027-08-25",
                    ratio_bps: 6e3
                } ]
            }
        }
    }));
    assert.deepEqual(q.computed.installments.map(x => x.amount), [ 27200, 40800 ]);
    const zero = ok(await call(s, "plans/" + q.id, "PUT", {
        ...q,
        modules: {
            ...q.modules,
            courses: {
                visible: true,
                lines: []
            }
        }
    }));
    assert.deepEqual(zero.computed.installments.map(x => x.amount), [ 0, 0 ]);
}));

test("YX4 分期模式、比例、标签、日期和跨方案阶段引用均校验", () => school(async s => {
    const p = await filled(s), base = {
        stage_key: null,
        label: "首期",
        due: null,
        ratio_bps: 1e4
    };
    const invalid = [ {
        installments: "once"
    }, {
        installments: "per_stage",
        custom: [ base ]
    }, {
        installments: "custom",
        custom: []
    }, ...[ 0, 10001, 1.5, "10000", null ].map(ratio_bps => ({
        installments: "custom",
        custom: [ {
            ...base,
            ratio_bps: ratio_bps
        } ]
    })), {
        installments: "custom",
        custom: [ {
            ...base,
            ratio_bps: 9999
        } ]
    }, {
        installments: "custom",
        custom: [ {
            ...base,
            label: ""
        } ]
    }, {
        installments: "custom",
        custom: [ {
            ...base,
            label: "长".repeat(31)
        } ]
    }, {
        installments: "custom",
        custom: [ {
            ...base,
            due: "2027-02-29"
        } ]
    }, {
        installments: "custom",
        custom: [ {
            ...base,
            stage_key: "stk_foreign"
        } ]
    } ];
    for (const fees of invalid) {
        const r = ok(await call(s, "plans/" + p.id, "PUT", {
            version: p.version,
            modules: {
                fees: fees
            }
        }), 422);
        assert.equal(r.error, "validation_failed");
    }
    assert.equal(ok(await call(s, "plans/" + p.id)).version, p.version);
}));

test("YX4 qty只能带匹配的一种正数数量字段", () => school(async s => {
    const p = await filled(s), line = p.modules.courses.lines[0];
    for (const qty of [ {
        months: 1
    }, {
        units: 1,
        terms: 1
    }, {}, {
        units: 0
    }, {
        units: -1
    }, {
        units: 1.001
    }, {
        units: "2"
    } ]) ok(await call(s, "plans/" + p.id, "PUT", {
        ...p,
        modules: {
            ...p.modules,
            courses: {
                visible: true,
                lines: [ {
                    ...line,
                    qty: qty
                } ]
            }
        }
    }), 422);
}));

test("YX4 教学周必须有原因，日期必须真实、连续且无重叠", () => school(async s => {
    const p = await filled(s), stage = p.modules.path.stages[0];
    for (const stages of [ [ {
        ...stage,
        teaching_weeks: 4,
        weeks_note: ""
    } ], [ {
        ...stage,
        start: "2027-02-29"
    } ], [ stage, {
        ...stage,
        key: "tmp_s2",
        start: "2026-12-31",
        end: "2027-01-31"
    } ], [ stage, {
        ...stage,
        key: "tmp_s2",
        start: "2027-01-02",
        end: "2027-01-31"
    } ] ]) ok(await call(s, "plans/" + p.id, "PUT", {
        ...p,
        modules: {
            ...p.modules,
            path: {
                visible: true,
                stages: stages
            }
        }
    }), 422);
    const q = ok(await call(s, "plans/" + p.id, "PUT", {
        ...p,
        modules: {
            ...p.modules,
            path: {
                visible: true,
                stages: [ {
                    ...stage,
                    teaching_weeks: 3,
                    weeks_note: "元旦休课"
                } ]
            }
        }
    }));
    assert.equal(q.computed.stages[0].calendar_weeks, 4);
    assert.equal(q.computed.stages[0].weeks_display, 3);
    assert.equal(q.computed.total.units, 2);
}));

test("YX4 快照保价，按最新价格预览不落库，选择重算后预览与执行一致", () => school(async s => {
    const p = await filled(s), line = p.modules.courses.lines[0];
    await course(s, "钢琴一对一", 250);
    const saved = ok(await call(s, "plans/" + p.id, "PUT", {
        ...p
    }));
    assert.equal(saved.computed.total.amount, 400);
    const before = s.f.db.raw.prepare("SELECT COUNT(*) n FROM plan_revisions WHERE tenant_id=?").get(s.t.id).n;
    const preview = ok(await call(s, "plans/" + p.id + "/reprice"));
    assert.equal(preview.lines[0].status, "changed");
    assert.deepEqual(preview.total, {
        old: 400,
        new: 500
    });
    assert.equal(s.f.db.raw.prepare("SELECT COUNT(*) n FROM plan_revisions WHERE tenant_id=?").get(s.t.id).n, before);
    const q = ok(await call(s, "plans/" + p.id + "/reprice", "POST", {
        version: saved.version,
        line_ids: [ line.line_id ]
    }));
    assert.equal(q.computed.total.amount, preview.total.new);
    assert.equal(q.modules.courses.lines[0].snapshot.pricing.amount_cents, 25e3);
    assert.equal(ok(await call(s, "plans/" + p.id + "/reprice")).lines[0].status, "unchanged");
    assert.equal(s.f.db.raw.prepare("SELECT COUNT(*) n FROM audit_log WHERE tenant_id=? AND module='plans' AND action='reprice'").get(s.t.id).n, 1);
}));

test("YX4 停用旧课程仍可保存和导出，新行与重算拒绝停用或未定价课程", () => school(async s => {
    const p = await filled(s), id = p.modules.courses.lines[0].course_id;
    await course(s, "钢琴一对一", 200, "per_unit", {
        active: false
    });
    const q = ok(await call(s, "plans/" + p.id, "PUT", {
        ...p
    }));
    assert.equal(q.computed.total.amount, 400);
    assert.ok(ok(await call(s, "plans/" + p.id + "/check")).warnings.some(x => x.code === "course_inactive"));
    ok(await call(s, "plans/" + p.id + "/export", "POST", {}));
    assert.equal(ok(await call(s, "plans/" + p.id + "/reprice")).lines[0].status, "course_inactive");
    assert.equal(ok(await call(s, "plans/" + p.id + "/reprice", "POST", {
        version: q.version
    }), 422).error, "out_of_scope");
    const fresh = {
        ...q.modules.courses.lines[0],
        line_id: "tmp_new"
    };
    ok(await call(s, "plans/" + p.id, "PUT", {
        ...q,
        modules: {
            ...q.modules,
            courses: {
                visible: true,
                lines: [ fresh ]
            }
        }
    }), 422);
    await course(s, "钢琴一对一", 200, "per_unit", {
        pricing: null
    });
    assert.equal(ok(await call(s, "plans/" + p.id + "/reprice")).lines[0].status, "unpriced");
    ok(await call(s, "plans/" + p.id + "/reprice", "POST", {
        version: q.version
    }), 422);
}));

test("YX4 expected_price_list_rev冲突返回最新计算、不写方案或修订，旧行不受影响", () => school(async s => {
    const p = await filled(s), fresh = await course(s, "新课程", 123), rev = ok(await call(s, "settings/courses")).price_list_rev;
    const conflict = ok(await call(s, "plans/" + p.id, "PUT", {
        ...p,
        expected_price_list_rev: rev - 1,
        modules: {
            ...p.modules,
            courses: {
                visible: true,
                lines: [ ...p.modules.courses.lines, {
                    line_id: "tmp_new",
                    stage_key: p.modules.path.stages[0].key,
                    course_id: fresh.id,
                    qty: {
                        units: 1
                    }
                } ]
            }
        }
    }), 409);
    assert.equal(conflict.error, "price_changed");
    assert.equal(conflict.details.computed.total.amount, 523);
    assert.equal(ok(await call(s, "plans/" + p.id)).version, p.version);
    ok(await call(s, "plans/" + p.id, "PUT", {
        ...p,
        expected_price_list_rev: -99
    }));
}));

test("YX4 稳定ID不能重复、借用或修改已有课程行的course_id", () => school(async s => {
    const p = await filled(s), q = await draft(s), line = p.modules.courses.lines[0], c = await course(s, "另一课程", 300);
    ok(await call(s, "plans/" + p.id, "PUT", {
        ...p,
        modules: {
            ...p.modules,
            courses: {
                visible: true,
                lines: [ {
                    ...line,
                    course_id: c.id
                } ]
            }
        }
    }), 422);
    ok(await call(s, "plans/" + p.id, "PUT", {
        ...p,
        modules: {
            ...p.modules,
            courses: {
                visible: true,
                lines: [ line, line ]
            }
        }
    }), 422);
    ok(await call(s, "plans/" + q.id, "PUT", {
        ...q,
        modules: p.modules
    }), 404);
    const removed = ok(await call(s, "plans/" + p.id, "PUT", {
        ...p,
        modules: {
            ...p.modules,
            courses: {
                visible: true,
                lines: []
            }
        }
    }));
    const returned = ok(await call(s, "plans/" + p.id, "PUT", {
        ...removed,
        modules: {
            ...removed.modules,
            courses: {
                visible: true,
                lines: [ {
                    ...line,
                    snapshot: {
                        pricing: {
                            amount_cents: 1
                        }
                    }
                } ]
            }
        }
    }));
    assert.equal(returned.computed.total.amount, 400);
}));

test("YX4 发送后工作稿改价和改分期不影响家长与旧分享链接，再发送才更新", () => school(async s => {
    const p = await filled(s, {
        amount: 300.01,
        qty: 1,
        modules: {
            fees: {
                installments: "custom",
                custom: [ {
                    stage_key: null,
                    label: "首付",
                    due: null,
                    ratio_bps: 5e3
                }, {
                    stage_key: null,
                    label: "尾款",
                    due: null,
                    ratio_bps: 5e3
                } ],
                due_dates: {}
            }
        }
    }), pa = await parent(s);
    ok(await call(s, "parent/plans/" + p.id, "GET", undefined, pa.token), 404);
    const sent = ok(await call(s, "plans/" + p.id + "/send", "POST", {
        version: p.version
    }));
    const link = ok(await call(s, "plans/" + p.id + "/share-links", "POST", {}), 201), publicPath = "/api/share/" + link.url.split("/").at(-1);
    const original = ok(await call(s, "parent/plans/" + p.id, "GET", undefined, pa.token));
    assert.deepEqual(original.render_data.computed.installments.map(x => x.amount), [ 150.01, 150 ]);
    const changed = ok(await call(s, "plans/" + p.id, "PUT", {
        ...sent,
        title: "新工作稿",
        modules: {
            ...sent.modules,
            fees: {
                installments: "custom",
                custom: [ {
                    stage_key: null,
                    label: "一次付清",
                    due: null,
                    ratio_bps: 1e4
                } ],
                due_dates: {}
            }
        }
    }));
    await course(s, "钢琴一对一", 400);
    const repriced = ok(await call(s, "plans/" + p.id + "/reprice", "POST", {
        version: changed.version
    }));
    assert.equal(repriced.computed.total.amount, 400);
    for (const r of [ ok(await call(s, "parent/plans/" + p.id, "GET", undefined, pa.token)), ok(await call(s, publicPath, "GET", undefined, null)) ]) {
        assert.equal(r.render_data.title, p.title);
        assert.equal(r.render_data.computed.total.amount, 300.01);
        assert.deepEqual(r.render_data.computed.installments.map(x => x.amount), [ 150.01, 150 ]);
    }
    const sent2 = ok(await call(s, "plans/" + p.id + "/send", "POST", {
        version: repriced.version
    }));
    assert.notEqual(sent2.sent_revision_id, sent.sent_revision_id);
    assert.equal(ok(await call(s, "parent/plans/" + p.id, "GET", undefined, pa.token)).render_data.computed.total.amount, 400);
    assert.equal(ok(await call(s, publicPath, "GET", undefined, null)).render_data.computed.total.amount, 300.01);
    const signed = ok(await call(s, "plans/" + p.id + "/sign", "POST", {
        revision_id: sent.sent_revision_id
    }));
    assert.equal(signed.status, "signed");
    assert.equal(ok(await call(s, "parent/plans/" + p.id, "GET", undefined, pa.token)).render_data.computed.total.amount, 300.01);
    for (const [path, method, data] of [ [ "", "PUT", {
        ...signed
    } ], [ "/reprice", "POST", {
        version: signed.version
    } ], [ "/revisions/" + sent.sent_revision_id + "/restore", "POST", {
        version: signed.version
    } ] ]) {
        const r = ok(await call(s, "plans/" + p.id + path, method, data), 409);
        assert.equal(r.error, "invalid_state");
    }
}));

test("YX4 签约只能选已发送修订，复制签约方案可换学员且不联动财务", () => school(async s => {
    const p = await filled(s);
    ok(await call(s, "plans/" + p.id + "/sign", "POST", {
        revision_id: p.current_revision_id
    }), 404);
    const sent = ok(await call(s, "plans/" + p.id + "/send", "POST", {}));
    const signed = ok(await call(s, "plans/" + p.id + "/sign", "POST", {}));
    assert.equal(signed.signed_revision_id, sent.sent_revision_id);
    const dup = ok(await call(s, "plans/" + p.id + "/duplicate", "POST", {
        student_id: s.students[1],
        title: "第二位学员方案"
    }), 201);
    assert.equal(dup.status, "draft");
    assert.equal(dup.student_id, s.students[1]);
    assert.equal(dup.signed_revision_id, null);
    assert.equal(dup.sent_revision_id, null);
    assert.notEqual(dup.modules.path.stages[0].key, p.modules.path.stages[0].key);
    assert.notEqual(dup.modules.courses.lines[0].line_id, p.modules.courses.lines[0].line_id);
    assert.equal(dup.computed.total.amount, 400);
    assert.equal(s.f.db.raw.prepare("SELECT COUNT(*) n FROM student_payments WHERE tenant_id=?").get(s.t.id).n, 0);
}));

test("YX4 归档关闭家长入口并立即作废分享，已发送不能按草稿删除", () => school(async s => {
    const p = await filled(s), pa = await parent(s);
    const sent = ok(await call(s, "plans/" + p.id + "/send", "POST", {}));
    ok(await call(s, "plans/" + p.id, "DELETE", {}), 409);
    const link = ok(await call(s, "plans/" + p.id + "/share-links", "POST", {}), 201);
    const archived = ok(await call(s, "plans/" + p.id + "/archive", "POST", {
        version: sent.version
    }));
    assert.equal(archived.status, "archived");
    ok(await call(s, "parent/plans/" + p.id, "GET", undefined, pa.token), 404);
    assert.equal(ok(await call(s, "plans", "GET", undefined, pa.token)).total, 0);
    ok(await call(s, "/api/share/" + link.url.split("/").at(-1), "GET", undefined, null), 404);
    ok(await call(s, "plans/" + p.id, "PUT", {
        ...archived
    }), 409);
}));

test("YX4 所有方案资源及分享链接跨机构读改删统一404，列表不混入", () => school(async s => {
    const other = await (await import("./fixtures-credit.mjs")).setup(s.f, 1, "yx4b");
    other.f = s.f;
    const p = await filled(s);
    ok(await call(s, "plans/" + p.id + "/send", "POST", {}));
    const link = ok(await call(s, "plans/" + p.id + "/share-links", "POST", {}), 201);
    const tests = [ [ "", "GET" ], [ "", "PUT", {
        version: p.version
    } ], [ "", "DELETE", {} ], [ "/duplicate", "POST", {} ], [ "/revisions", "GET" ], [ "/revisions/" + p.current_revision_id + "/restore", "POST", {} ], [ "/skeleton", "POST", {} ], [ "/check", "GET" ], [ "/reprice", "GET" ], [ "/reprice", "POST", {} ], [ "/export", "POST", {} ], [ "/send", "POST", {} ], [ "/sign", "POST", {} ], [ "/archive", "POST", {} ], [ "/share-links", "GET" ], [ "/share-links", "POST", {} ], [ "/share-links/" + link.id, "DELETE", {} ] ];
    for (const [tail, method, data] of tests) ok(await call(other, "plans/" + p.id + tail, method, data), 404);
    assert.equal(ok(await call(other, "plans")).total, 0);
    ok(await call(s, "/" + other.t.slug + "/api/plans", "GET"), 404);
    const own = await draft(other);
    ok(await call(other, "plans/" + own.id + "/share-links/" + link.id, "DELETE", {}), 404);
    ok(await call(other, "plans/" + own.id + "/revisions/" + p.current_revision_id + "/restore", "POST", {}), 404);
    ok(await call(other, "plans", "POST", {
        student_id: s.students[0],
        subject: "music_interest",
        title: "跨机构"
    }), 404);
}));

test("YX4 老师不能读方案和价格，财务只能读方案，顾问教务可编辑", () => school(async s => {
    const p = await filled(s), finance = await accountToken(s, [ "finance" ]), consultant = await accountToken(s, [ "consultant" ]), academic = await accountToken(s, [ "academic" ]);
    const made = ok(await call(s, "accounts", "POST", {
        name: "老师",
        phone: "13855556666",
        roles: [ "teacher" ],
        teacher_id: s.teacher
    }), 201);
    s.f.db.raw.prepare("UPDATE users SET must_change=0 WHERE tenant_id=? AND id=?").run(s.t.id, made.id);
    const {b64: b64, bytes: bytes, sha: sha} = await import("../src/server/core.js"), teacher = b64(bytes(32));
    await s.r.createSession(await sha(teacher), await s.r.user(made.id), {
        ip: "test",
        ua: "yx4"
    });
    for (const path of [ "plans", "plans/" + p.id, "styles", "settings/courses" ]) ok(await call(s, path, "GET", undefined, teacher), 403);
    ok(await call(s, "plans/" + p.id, "GET", undefined, finance.token));
    for (const [path, method, data] of [ [ "plans", "POST", {
        student_id: s.students[0],
        subject: "music_interest",
        title: "财务"
    } ], [ "plans/" + p.id, "PUT", {
        version: p.version
    } ], [ "plans/" + p.id + "/share-links", "POST", {} ] ]) ok(await call(s, path, method, data, finance.token), 403);
    for (const u of [ consultant, academic ]) {
        const current = ok(await call(s, "plans/" + p.id));
        ok(await call(s, "plans/" + p.id, "PUT", {
            version: current.version,
            title: "由员工修改"
        }, u.token));
    }
}));

test("YX4 家长只见所绑两个孩子已发送方案，解绑即时失去读取权限", () => school(async s => {
    const p = await filled(s), pa = await parent(s, [ 0, 1 ]), q = ok(await call(s, "plans/" + p.id + "/duplicate", "POST", {
        student_id: s.students[1]
    }), 201), foreign = ok(await call(s, "plans/" + p.id + "/duplicate", "POST", {
        student_id: s.students[2]
    }), 201);
    for (const item of [ p, q, foreign ]) ok(await call(s, "plans/" + item.id + "/send", "POST", {}));
    assert.equal(ok(await call(s, "plans", "GET", undefined, pa.token)).total, 2);
    ok(await call(s, "parent/plans/" + p.id, "GET", undefined, pa.token));
    ok(await call(s, "parent/plans/" + q.id, "GET", undefined, pa.token));
    ok(await call(s, "parent/plans/" + foreign.id, "GET", undefined, pa.token), 404);
    ok(await call(s, "parent/children/" + s.students[2] + "/feed", "GET", undefined, pa.token), 404);
    assert.equal(ok(await call(s, "parent/children/" + s.students[0] + "/feed", "GET", undefined, pa.token)).items.length, 1);
    const links = ok(await call(s, "students/" + s.students[0] + "/guardians"));
    ok(await call(s, "students/" + s.students[0] + "/guardians/" + links.items[0].id, "DELETE", {}));
    ok(await call(s, "parent/plans/" + p.id, "GET", undefined, pa.token), 404);
    assert.equal(ok(await call(s, "plans", "GET", undefined, pa.token)).total, 1);
}));

test("YX4 学员账号仅可读自己的已发送快照", () => school(async s => {
    const p = await filled(s), own = await accountToken(s, [ "student" ], s.students[0]), other = await accountToken(s, [ "student" ], s.students[1]);
    ok(await call(s, "plans/" + p.id, "GET", undefined, own.token), 404);
    ok(await call(s, "plans/" + p.id + "/send", "POST", {}));
    ok(await call(s, "plans/" + p.id, "GET", undefined, own.token));
    ok(await call(s, "plans/" + p.id, "GET", undefined, other.token), 404);
    ok(await call(s, "plans/" + p.id + "/revisions", "GET", undefined, own.token), 403);
}));

test("YX4 根会话和机构路径会话均可访问新接口，api_base与路径对应", () => school(async s => {
    const p = await filled(s), {b64: b64, bytes: bytes, sha: sha} = await import("../src/server/core.js"), token = b64(bytes(32));
    await s.r.createSession(await sha(token), await s.r.user(s.user.id), {
        ip: "test",
        ua: "root"
    }, null, "root");
    const root = ok(await call(s, "/api/plans/" + p.id, "GET", undefined, token));
    assert.equal(root.id, p.id);
    const e = ok(await call(s, "/api/plans/" + p.id + "/export", "POST", {}, token));
    assert.equal(e.render_data.id, p.id);
    assert.equal(ok(await call(s, "me")).api_base, "/" + s.t.slug + "/api");
    assert.equal(ok(await call(s, "/api/me", "GET", undefined, token)).api_base, "/api");
}));

test("YX4 导出检查覆盖预算、旧价、档案、禁用词与主管强制审计", () => school(async s => {
    let p = await filled(s);
    p = ok(await call(s, "plans/" + p.id, "PUT", {
        ...p,
        meta: {
            ...p.meta,
            budget_cap: 100
        }
    }));
    const checks = ok(await call(s, "plans/" + p.id + "/check"));
    assert.ok(checks.blocking.some(x => x.code === "over_budget"));
    assert.ok(checks.warnings.some(x => x.code === "profile_placeholder"));
    assert.equal(ok(await call(s, "plans/" + p.id + "/export", "POST", {}), 422).error, "check_failed");
    const consult = await accountToken(s, [ "consultant" ]);
    ok(await call(s, "plans/" + p.id + "/export", "POST", {
        force: [ "over_budget" ]
    }, consult.token), 422);
    ok(await call(s, "plans/" + p.id + "/export", "POST", {
        force: [ "over_budget" ]
    }));
    assert.ok(s.f.db.raw.prepare("SELECT after_json FROM audit_log WHERE tenant_id=? AND module='plans' AND action='export'").get(s.t.id).after_json.includes("over_budget"));
    ok(await call(s, "plans/" + p.id + "/send", "POST", {}), 422);
    p = ok(await call(s, "plans/" + p.id, "PUT", {
        ...p,
        title: "包过保证",
        meta: {
            ...p.meta,
            budget_cap: 1e3
        }
    }));
    const terms = ok(await call(s, "compliance/terms"));
    assert.ok(terms.items.includes("包过"));
    assert.ok(ok(await call(s, "plans/" + p.id + "/check")).blocking.some(x => x.code === "ad_law_terms"));
    ok(await call(s, "plans/" + p.id + "/export", "POST", {
        force: [ "over_budget" ]
    }), 422);
    ok(await call(s, "plans/" + p.id + "/export", "POST", {
        force: [ "ad_law_terms" ]
    }), 422);
}));

test("YX4 已发送后的工作稿违规不影响旧版本导出和分享检查", () => school(async s => {
    const p = await filled(s), sent = ok(await call(s, "plans/" + p.id + "/send", "POST", {}));
    ok(await call(s, "plans/" + p.id, "PUT", {
        ...sent,
        title: "包过新工作稿"
    }));
    ok(await call(s, "plans/" + p.id + "/export", "POST", {}), 422);
    const old = ok(await call(s, "plans/" + p.id + "/export", "POST", {
        revision_id: sent.sent_revision_id
    }));
    assert.equal(old.render_data.title, p.title);
    ok(await call(s, "plans/" + p.id + "/share-links", "POST", {}), 201);
}));

test("YX4 show_unit_price关闭时导出、家长和公开分享均剔除单价及可选费用price_text", () => school(async s => {
    const p = await golden(s, "B"), pa = await parent(s);
    ok(await call(s, "plans/" + p.id + "/send", "POST", {}));
    const link = ok(await call(s, "plans/" + p.id + "/share-links", "POST", {}), 201);
    for (const r of [ ok(await call(s, "plans/" + p.id + "/export", "POST", {})), ok(await call(s, "parent/plans/" + p.id, "GET", undefined, pa.token)), ok(await call(s, "/api/share/" + link.url.split("/").at(-1), "GET", undefined, null)) ]) {
        for (const l of r.render_data.modules.courses.lines) assert.equal(l.snapshot.pricing.amount_cents, undefined);
        assert.equal(r.render_data.computed.optional_fees[0].price_text, undefined);
        assert.equal(r.render_data.brand.name, s.t.name);
        assert.equal(r.render_data.tenant_id, undefined);
        // golden(B) 的学员0 未同意展示且无独立安全昵称，按 G4 脱敏回退为“同学”
        assert.equal(r.render_data.student.display_name, "同学");
        assert.equal(r.render_data.computed.total.amount, 68e3);
    }
    assert.equal(ok(await call(s, "plans/" + p.id)).modules.courses.lines[0].snapshot.pricing.amount_cents, 14e5);
    const current = ok(await call(s, "plans/" + p.id)), changed = ok(await call(s, "plans/" + p.id, "PUT", {
        version: current.version,
        style: {
            ...current.style,
            show_unit_price: true
        }
    }));
    assert.equal(ok(await call(s, "plans/" + p.id + "/export", "POST", {})).render_data.modules.courses.lines[0].snapshot.pricing.amount_cents, 14e5);
    assert.ok(ok(await call(s, "plans/" + p.id + "/export", "POST", {})).render_data.computed.optional_fees[0].price_text);
}));

test("YX4 分享token仅首次返回、只存哈希，链接列表与审计不泄露token，访问计数和作废即时生效", () => school(async s => {
    const p = await filled(s);
    ok(await call(s, "plans/" + p.id + "/share-links", "POST", {}), 409);
    ok(await call(s, "plans/" + p.id + "/send", "POST", {}));
    const link = ok(await call(s, "plans/" + p.id + "/share-links", "POST", {}), 201), token = link.url.split("/").at(-1);
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    const stored = s.f.db.raw.prepare("SELECT * FROM share_links WHERE tenant_id=? AND id=?").get(s.t.id, link.id);
    assert.equal(Buffer.from(stored.token_hash, "base64").length, 32);
    assert.ok(!JSON.stringify(stored).includes(token));
    const publicResult = await call(s, "/api/share/" + token, "GET", undefined, null);
    ok(publicResult);
    assert.equal(publicResult.headers.get("x-robots-tag"), "noindex, nofollow");
    assert.equal(publicResult.headers.get("referrer-policy"), "no-referrer");
    const listed = ok(await call(s, "plans/" + p.id + "/share-links"));
    assert.equal(listed.items[0].visits, 1);
    assert.ok(!JSON.stringify(listed).includes(token));
    assert.ok(!JSON.stringify(s.f.db.raw.prepare("SELECT * FROM audit_log WHERE tenant_id=? AND module='plans'").all(s.t.id)).includes(token));
    ok(await call(s, "plans/" + p.id + "/share-links/" + link.id, "DELETE", {
        version: listed.items[0].version
    }));
    ok(await call(s, "/api/share/" + token, "GET", undefined, null), 404);
    const shell = await call(s, "/s/" + token, "GET", undefined, null);
    ok(shell);
    assert.match(shell.headers.get("content-type"), /text\/html/);
    assert.equal(shell.headers.get("x-robots-tag"), "noindex");
}));

test("YX4 分享错误、过期、作废、删除、机构到期或停用使用相同中性404且至少200ms", () => school(async s => {
    const p = await filled(s);
    ok(await call(s, "plans/" + p.id + "/send", "POST", {}));
    const link = ok(await call(s, "plans/" + p.id + "/share-links", "POST", {}), 201), path = "/api/share/" + link.url.split("/").at(-1);
    const results = [];
    let at = performance.now();
    results.push(await call(s, "/api/share/" + "a".repeat(43), "GET", undefined, null));
    assert.ok(performance.now() - at >= 185);
    const db = s.f.db.raw;
    db.prepare("UPDATE share_links SET expires_at=1 WHERE tenant_id=? AND id=?").run(s.t.id, link.id);
    results.push(await call(s, path, "GET", undefined, null));
    db.prepare("UPDATE share_links SET expires_at=?,revoked_at=1 WHERE tenant_id=? AND id=?").run(Date.now() + 1e5, s.t.id, link.id);
    results.push(await call(s, path, "GET", undefined, null));
    db.prepare("UPDATE share_links SET revoked_at=NULL WHERE tenant_id=? AND id=?").run(s.t.id, link.id);
    db.prepare("UPDATE tenants SET expires_at='2000-01-01' WHERE id=?").run(s.t.id);
    results.push(await call(s, path, "GET", undefined, null));
    db.prepare("UPDATE tenants SET expires_at=NULL,status='paused' WHERE id=?").run(s.t.id);
    results.push(await call(s, path, "GET", undefined, null));
    db.prepare("UPDATE tenants SET status='active' WHERE id=?").run(s.t.id);
    db.prepare("UPDATE plans SET deleted_at=1 WHERE tenant_id=? AND id=?").run(s.t.id, p.id);
    results.push(await call(s, path, "GET", undefined, null));
    for (const r of results) {
        assert.equal(r.status, 404);
        assert.equal(r.text, results[0].text);
        assert.equal(r.headers.get("content-type"), results[0].headers.get("content-type"));
        assert.equal(r.headers.get("x-robots-tag"), "noindex, nofollow");
    }
}));

test("YX4 公开分享按IP限速，换IP不沿用该计数", () => school(async s => {
    const {sha: sha} = await import("../src/server/core.js");
    const key = "plan-share:" + await sha("198.51.100.9");
    const p = (await import("../src/server/repo.js")).repo(s.f.env, null);
    for (let i = 0; i < 60; i++) await p.limit(key, 6e4, 60, 6e4);
    const r = ok(await call(s, "/api/share/" + "a".repeat(43), "GET", undefined, null, {
        "CF-Connecting-IP": "198.51.100.9"
    }), 429);
    assert.equal(r.error, "rate_limited");
    ok(await call(s, "/api/share/" + "a".repeat(43), "GET", undefined, null, {
        "CF-Connecting-IP": "198.51.100.10"
    }), 404);
}));

test("YX4 程序骨架只读、阶段连续，按机构规则插入集训与考级前冲刺，不串学科", () => school(async s => {
    await seed(s, "art_exam");
    await seed(s);
    const rules = ok(await call(s, "settings/stage-rules"));
    ok(await call(s, "settings/stage-rules", "PUT", {
        ...rules,
        rules: {
            ...rules.rules,
            exam_sprint_before_grade: true,
            insert_holiday_camp: true
        }
    }));
    const p = await draft(s), before = s.f.db.raw.prepare("SELECT COUNT(*) n FROM plan_revisions WHERE tenant_id=?").get(s.t.id).n;
    const proposed = ok(await call(s, "plans/" + p.id + "/skeleton", "POST", {
        start_month: "2026-12",
        target: {
            node_key: "grade_exam",
            month: "2027-07"
        },
        options: {
            insert_holiday_camp: true
        }
    }));
    assert.equal(proposed.stages[0].start, "2026-12-01");
    assert.equal(proposed.stages.at(-1).end, "2027-07-31");
    assert.ok(proposed.stages.some(x => x.name === "考级冲刺"));
    assert.ok(proposed.stages.some(x => x.name === "假期集训"));
    for (let i = 1; i < proposed.stages.length; i++) assert.equal(Date.parse(proposed.stages[i].start) - Date.parse(proposed.stages[i - 1].end), 864e5);
    for (const item of proposed.stages) {
        assert.match(item.key, /^tmp_/);
        assert.equal(s.f.db.raw.prepare("SELECT subject FROM stage_types WHERE tenant_id=? AND id=?").get(s.t.id, item.stage_type_id).subject, "music_interest");
    }
    assert.equal(s.f.db.raw.prepare("SELECT COUNT(*) n FROM plan_revisions WHERE tenant_id=?").get(s.t.id).n, before);
    assert.equal(ok(await call(s, "plans/" + p.id)).version, p.version);
    const noCamp = ok(await call(s, "plans/" + p.id + "/skeleton", "POST", {
        start_month: "2026-12",
        target: {
            node_key: "grade_exam",
            month: "2027-07"
        },
        options: {
            insert_holiday_camp: false
        }
    }));
    assert.ok(!noCamp.stages.some(x => x.name === "假期集训"));
    const adopted = ok(await call(s, "plans/" + p.id, "PUT", {
        ...p,
        modules: {
            ...p.modules,
            path: {
                visible: true,
                stages: proposed.stages
            }
        }
    }));
    assert.ok(adopted.modules.path.stages.every(x => x.key.startsWith("stk_")));
}));

test("YX4 风格发布新版本或停用后，已有方案与导出仍锁旧manifest", () => school(async s => {
    const p = await filled(s), old = ok(await call(s, "plans/" + p.id + "/export", "POST", {})).manifest, db = s.f.db.raw;
    const fresh = {
        ...old,
        version: "2.0.0",
        name: "新版书册"
    };
    db.prepare("INSERT INTO style_pack_versions(id,pack_id,version,manifest_json,created_at) VALUES(?,?,?,?,?)").run("sv_test", "stp_folio", "2.0.0", JSON.stringify(fresh), Date.now());
    db.prepare("UPDATE style_packs SET current_version='2.0.0',active=0 WHERE id='stp_folio'").run();
    assert.deepEqual(ok(await call(s, "plans/" + p.id + "/export", "POST", {})).manifest, old);
    const saved = ok(await call(s, "plans/" + p.id, "PUT", {
        ...p,
        title: "旧风格继续编辑"
    }));
    assert.equal(saved.style.pack_version, "1.0.0");
    assert.deepEqual(ok(await call(s, "styles/stp_folio/versions/1.0.0")).manifest, old);
    assert.ok(!ok(await call(s, "styles")).items.some(x => x.id === "stp_folio"));
    ok(await call(s, "plans", "POST", {
        student_id: s.students[0],
        subject: "music_interest",
        title: "新方案",
        style: {
            pack_id: "stp_folio"
        }
    }), 422);
}));

test("YX4 图片按发送版本和孩子授权，隐藏模块图片不外泄，员工文件URL可读取", () => school(async s => {
    const p = await filled(s), db = s.f.db.raw;
    for (const [id, hidden] of [ [ "img_cover", 0 ], [ "img_about", 0 ], [ "img_unused", 0 ] ]) {
        await s.r.settingsGalleryCreate({
            id: id,
            r2_key: "promo/" + s.t.id + "/" + id,
            mime: "image/png",
            width: 1,
            height: 1,
            tags: [],
            consent: false
        }, s.user);
        await s.f.env.CHANNEL_MEDIA.put("promo/" + s.t.id + "/" + id, "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jw1kAAAAASUVORK5CYII=");
    }
    const q = ok(await call(s, "plans/" + p.id, "PUT", {
        ...p,
        style: {
            ...p.style,
            cover_image_id: "img_cover"
        },
        modules: {
            ...p.modules,
            about: {
                visible: false,
                image_ids: [ "img_about" ]
            }
        }
    }));
    assert.ok(ok(await call(s, "plans/" + p.id + "/check")).warnings.some(x => x.code === "image_low_res"));
    const exported = ok(await call(s, "plans/" + p.id + "/export", "POST", {}));
    assert.ok(exported.render_data.style.cover_image_url.endsWith("/gallery/img_cover/file"));
    assert.equal(exported.render_data.modules.about.image_ids, undefined);
    const finance = await accountToken(s, [ "finance" ]);
    assert.equal((await call(s, "gallery/img_cover/file", "GET", undefined, finance.token)).status, 200);
    ok(await call(s, "gallery/img_unused/file", "GET", undefined, finance.token), 404);
    const pa = await parent(s);
    ok(await call(s, "parent/media/img_cover", "GET", undefined, pa.token), 404);
    ok(await call(s, "plans/" + p.id + "/send", "POST", {}));
    assert.equal((await call(s, "parent/media/img_cover", "GET", undefined, pa.token)).status, 200);
    ok(await call(s, "parent/media/img_about", "GET", undefined, pa.token), 404);
    ok(await call(s, "parent/media/img_unused", "GET", undefined, pa.token), 404);
    const link = ok(await call(s, "plans/" + p.id + "/share-links", "POST", {}), 201), base = "/api/share/" + link.url.split("/").at(-1);
    assert.equal((await call(s, base + "/media/img_cover", "GET", undefined, null)).status, 200);
    ok(await call(s, base + "/media/img_about", "GET", undefined, null), 404);
    ok(await call(s, base + "/media/img_unused", "GET", undefined, null), 404);
    const row = ok(await call(s, "plans/" + p.id));
    ok(await call(s, "plans/" + p.id, "PUT", {
        version: row.version,
        style: {
            ...row.style,
            cover_image_id: null
        }
    }));
    assert.equal((await call(s, "parent/media/img_cover", "GET", undefined, pa.token)).status, 200);
    assert.equal(ok(await call(s, "gallery/img_cover", "DELETE", {
        version: 1
    })).hidden, true);
    assert.ok(await s.f.env.CHANNEL_MEDIA.get("promo/" + s.t.id + "/img_cover"));
}));

test("YX4 机构停用或到期阻止新私有接口但保留会话，模块关闭同时关闭分享", () => school(async s => {
    const p = await filled(s);
    ok(await call(s, "plans/" + p.id + "/send", "POST", {}));
    const link = ok(await call(s, "plans/" + p.id + "/share-links", "POST", {}), 201), db = s.f.db.raw;
    for (const change of [ "status='paused'", "status='active',expires_at='2000-01-01'" ]) {
        db.prepare("UPDATE tenants SET " + change + " WHERE id=?").run(s.t.id);
        const r = ok(await call(s, "plans/" + p.id), 403);
        assert.equal(r.error, "tenant_expired");
        assert.ok(db.prepare("SELECT id FROM sessions WHERE tenant_id=?").get(s.t.id));
    }
    db.prepare("UPDATE tenants SET status='active',expires_at=NULL WHERE id=?").run(s.t.id);
    ok(await call(s, "plans/" + p.id));
    db.prepare("UPDATE tenant_modules SET enabled=0 WHERE tenant_id=? AND id='plans'").run(s.t.id);
    ok(await call(s, "plans/" + p.id), 404);
    ok(await call(s, "/api/share/" + link.url.split("/").at(-1), "GET", undefined, null), 404);
}));

test("YX4 新迁移保留旧数据，修订与资料快照不可覆盖，外键完整", () => school(async s => {
    const p = await filled(s), db = s.f.db.raw;
    assert.throws(() => db.prepare("UPDATE plan_revisions SET doc_json='{}' WHERE tenant_id=? AND plan_id=?").run(s.t.id, p.id), /plan_revision_immutable/);
    assert.throws(() => db.prepare("UPDATE plan_contexts SET doc_json='{}' WHERE tenant_id=? AND plan_id=?").run(s.t.id, p.id), /plan_context_immutable/);
    assert.throws(() => db.prepare("UPDATE style_pack_versions SET manifest_json='{}' WHERE pack_id='stp_folio'").run(), /style_version_immutable/);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
}));

test("YX4 同版本并发保存只有一个成功，失败事务不留下多余修订或元素", () => school(async s => {
    const p = await filled(s), results = await Promise.all([ call(s, "plans/" + p.id, "PUT", {
        version: p.version,
        title: "并发A"
    }), call(s, "plans/" + p.id, "PUT", {
        version: p.version,
        title: "并发B"
    }) ]);
    assert.deepEqual(results.map(x => x.status).sort(), [ 200, 409 ]);
    const latest = ok(await call(s, "plans/" + p.id));
    assert.equal(latest.version, p.version + 1);
    assert.equal(ok(await call(s, "plans/" + p.id + "/revisions")).total, p.version + 1);
    assert.equal(results.find(x => x.status === 409).body.error, "version_conflict");
}));

test("YX4 完整加密备份包含方案、修订、分享哈希及风格词库", () => school(async s => {
    const p = await filled(s);
    ok(await call(s, "plans/" + p.id + "/send", "POST", {}));
    ok(await call(s, "plans/" + p.id + "/share-links", "POST", {}), 201);
    const {startBackup: startBackup} = await import("../src/server/backup.js");
    await startBackup(s.f.env, Date.now());
    for (const table of [ "plans", "plan_contexts", "plan_revisions", "plan_elements", "share_links" ]) assert.ok(s.f.db.raw.prepare("SELECT row_json FROM backup_snapshot_rows WHERE tenant_id=? AND table_name=? LIMIT 1").get(s.t.id, table), table);
    for (const table of [ "style_packs", "style_pack_versions", "compliance_terms" ]) assert.ok(s.f.db.raw.prepare("SELECT row_json FROM backup_snapshot_rows WHERE table_name=? LIMIT 1").get(table), table);
}));

test("YX4 未登录新私有接口为401，公开链接不依赖会话", () => school(async s => {
    const p = await filled(s);
    for (const path of [ "plans", "plans/" + p.id, "styles", "compliance/terms" ]) ok(await call(s, path, "GET", undefined, null), 401);
    ok(await call(s, "/api/plans", "GET", undefined, null), 401);
}));

test("YX4 骨架按真实学员年龄插入美术过渡阶段，艺考模拟考与校考收尾仅给文字建议", () => school(async s => {
    await seed(s, "art_interest");
    s.f.db.raw.prepare("UPDATE students SET birth_year=2017 WHERE tenant_id=? AND id=?").run(s.t.id, s.students[0]);
    const p = await draft(s, {
        subject: "art_interest"
    }), result = ok(await call(s, "plans/" + p.id + "/skeleton", "POST", {
        start_month: "2026-12",
        target: {
            node_key: "showcase",
            month: "2027-06"
        },
        options: {
            insert_holiday_camp: false
        }
    }));
    assert.ok(result.stages.some(x => x.name === "过渡阶段"));
    await seed(s, "art_exam");
    const rules = ok(await call(s, "settings/stage-rules"));
    ok(await call(s, "settings/stage-rules", "PUT", {
        ...rules,
        rules: {
            ...rules.rules,
            mock_exam_schedule: true,
            art_exam_end_after_school_exam: true
        }
    }));
    const q = await draft(s, {
        subject: "art_exam"
    }), exam = ok(await call(s, "plans/" + q.id + "/skeleton", "POST", {
        start_month: "2027-07",
        target: {
            node_key: "school_exam",
            month: "2028-03"
        },
        options: {
            insert_holiday_camp: true
        }
    }));
    assert.ok(exam.stages.every(x => x.goals.some(y => y.includes("模拟考"))));
    assert.ok(exam.stages.at(-1).goals.some(x => x.includes("文化课")));
}));

test("YX4 恶意结构和错误标量返回校验错误，不产生500或落库", () => school(async s => {
    const p = await filled(s), bad = [ {
        student_id: {}
    }, {
        source_lead_id: []
    }, {
        meta: {
            consultant_id: []
        }
    }, {
        modules: []
    }, {
        modules: {
            fees: {
                custom: [ null ]
            }
        }
    }, {
        modules: {
            courses: {
                lines: [ {
                    ...p.modules.courses.lines[0],
                    includes: [ null ]
                } ]
            }
        }
    }, {
        modules: {
            path: {
                stages: [ null ]
            }
        }
    }, {
        modules: {
            courses: {
                lines: [ null ]
            }
        }
    } ];
    for (const change of bad) {
        const r = await call(s, "plans/" + p.id, "PUT", {
            version: p.version,
            ...change
        });
        assert.equal(r.status, 422, r.text);
    }
    assert.equal(ok(await call(s, "plans/" + p.id)).version, p.version);
}));

test("YX4 历史阶段设置和机构档案保留快照，新方案读取当前配置", () => school(async s => {
    const p = await filled(s), before = ok(await call(s, "plans/" + p.id + "/export", "POST", {}));
    s.f.db.raw.prepare("UPDATE tenant_branding SET display_name='改名后的机构',theme_color='#010203',version=version+1 WHERE tenant_id=?").run(s.t.id);
    const profile = ok(await call(s, "settings/profile"));
    ok(await call(s, "settings/profile", "PUT", {
        ...profile,
        address: "新的机构地址"
    }));
    const saved = ok(await call(s, "plans/" + p.id, "PUT", {
        version: p.version,
        title: "仅改工作稿标题"
    }));
    const after = ok(await call(s, "plans/" + p.id + "/export", "POST", {}));
    assert.deepEqual(after.render_data.brand, before.render_data.brand);
    assert.deepEqual(saved.modules.path.stages[0].stage_snapshot, p.modules.path.stages[0].stage_snapshot);
    const q = await draft(s);
    assert.equal(ok(await call(s, "plans/" + q.id + "/export", "POST", {})).render_data.brand.name, "改名后的机构");
}));

test("YX4 记录已采用建议ID，外机构或过期建议不允许写入", () => school(async s => {
    const p = await draft(s), id = "sg_plan_test", doc = {
        cards: []
    };
    s.f.db.raw.prepare("INSERT INTO ai_suggestions(tenant_id,id,user_id,kind,doc_json,created_at,expires_at) VALUES(?,?,?,?,?,?,?)").run(s.t.id, id, s.user.id, "plan.fields", JSON.stringify(doc), Date.now(), Date.now() + 1e5);
    const saved = ok(await call(s, "plans/" + p.id, "PUT", {
        version: p.version,
        applied_suggestion_ids: [ id ]
    }));
    assert.deepEqual(saved.applied_suggestion_ids, [ id ]);
    assert.ok(s.f.db.raw.prepare("SELECT after_json FROM audit_log WHERE tenant_id=? AND module='plans' AND action='save'").get(s.t.id).after_json.includes(id));
    ok(await call(s, "plans/" + p.id, "PUT", {
        version: saved.version,
        applied_suggestion_ids: [ "sg_foreign" ]
    }), 404);
}));

test("YX4 查询预算、无tenant_id输出，保存真实HTTP请求响应供前端复用", async () => {
    const subset = examples.filter(x => /\/api\/(plans|parent\/(plans|children\/[^/]+\/feed|media)|share|styles|compliance)/.test(x.request.path));
    assert.ok(subset.length > 100);
    const success = subset.filter(x => x.response.status < 300);
    for (const x of success) {
        if (x.response.body && typeof x.response.body === "object") assert.ok(!JSON.stringify(x.response.body).includes('"tenant_id"'), x.request.path);
    }
    const required = [ [ "POST", /\/plans$/ ], [ "GET", /\/plans(?:\?.*)?$/ ], [ "GET", /\/plans\/pln_[^/]+$/ ], [ "PUT", /\/plans\/pln_[^/]+$/ ], [ "DELETE", /\/plans\/pln_[^/]+$/ ], ...[ "duplicate", "skeleton", "send", "sign", "archive", "export", "reprice" ].map(k => [ "POST", new RegExp("/plans/[^/]+/" + k + "$") ]), [ "GET", /\/plans\/[^/]+\/revisions$/ ], [ "POST", /\/plans\/[^/]+\/revisions\/[^/]+\/restore$/ ], [ "GET", /\/plans\/[^/]+\/check$/ ], [ "GET", /\/plans\/[^/]+\/reprice$/ ], [ "GET", /\/plans\/[^/]+\/share-links$/ ], [ "POST", /\/plans\/[^/]+\/share-links$/ ], [ "DELETE", /\/plans\/[^/]+\/share-links\/[^/]+$/ ], [ "GET", /\/parent\/plans\// ], [ "GET", /\/parent\/children\/[^/]+\/feed$/ ], [ "GET", /\/parent\/media\// ], [ "GET", /\/share\/[^/]+$/ ], [ "GET", /\/share\/[^/]+\/media\// ], [ "GET", /\/styles$/ ], [ "GET", /\/styles\/[^/]+\/versions\/[^/]+$/ ], [ "GET", /\/compliance\/terms$/ ] ];
    for (const [method, pattern] of required) assert.ok(success.some(x => x.request.method === method && pattern.test(x.request.path)), method + " " + pattern);
    await mkdir("work/stage4", {
        recursive: true
    });
    await writeFile("work/stage4/http-examples-" + (process.env.TEST_BUNDLE === "1" ? "bundle" : "source") + ".json", JSON.stringify({
        local_only: true,
        mode: process.env.TEST_BUNDLE === "1" ? "bundle" : "source",
        examples: subset
    }, null, 2) + "\n");
});
