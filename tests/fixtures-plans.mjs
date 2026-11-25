import assert from "node:assert/strict";

import { fixture } from "./support.mjs";

import { setup, accountToken } from "./fixtures-credit.mjs";

import { b64, bytes, sha } from "../src/server/core.js";

export const examples = [];

export async function call(s, path, method = "GET", data, token = s.token, extra = {}) {
    const url = path.startsWith("/") ? path : "/" + s.t.slug + "/api/" + path;
    const headers = {
        Origin: "https://school.test",
        "Content-Type": "application/json",
        ...token ? {
            Cookie: (url.startsWith("/api/") ? "__Host-yx_session=" : "channel_session=") + token
        } : {},
        ...extra
    };
    const response = await s.f.request("https://school.test" + url, {
        method: method,
        headers: headers,
        body: data === undefined ? undefined : JSON.stringify(data)
    });
    const raw = new Uint8Array(await response.arrayBuffer()), text = new TextDecoder().decode(raw);
    let body;
    try {
        body = JSON.parse(text);
    } catch {
        body = text;
    }
    const result = {
        status: response.status,
        body: body,
        text: text,
        headers: response.headers,
        queries: Number(response.headers.get("x-test-d1-queries"))
    };
    examples.push({
        request: {
            method: method,
            path: url,
            body: data ?? null,
            authenticated: !!token
        },
        response: {
            status: response.status,
            body: (response.headers.get("content-type")||"").startsWith("image/") ? {binary:true,mime:response.headers.get("content-type"),base64:Buffer.from(raw).toString("base64")} : body,
            queries: result.queries
        }
    });
    return result;
}

export function ok(r, status = 200) {
    assert.equal(r.status, status, r.text || JSON.stringify(r.body));
    return r.body;
}

export async function school(fn) {
    const f = await fixture();
    try {
        const s = await setup(f, 3, "yx4");
        s.f = f;
        await fn(s);
    } finally {
        f.restore();
    }
}

export async function seed(s, subject = "music_interest") {
    ok(await call(s, "settings/subjects", "POST", {
        key: subject
    }));
    const types = ok(await call(s, "settings/stage-types")).items;
    return types.filter(x => x.subject === subject);
}

export async function course(s, name = "钢琴一对一", amount = 200, mode = "per_unit", extra = {}) {
    const data = {
        subject: "music_interest",
        name: name,
        group: "主修",
        form: "one_to_one",
        minutes: 45,
        duration_text: null,
        pricing: {
            mode: mode,
            amount: amount,
            unit_label: mode === "package" ? "包" : "课时",
            ...mode === "package" ? {
                units_per_package: 10
            } : {}
        },
        ...extra
    };
    const existing = ok(await call(s, "settings/courses?include_inactive=1&q=" + encodeURIComponent(name))).items.find(x => x.name === name && x.subject === data.subject);
    return existing ? ok(await call(s, "settings/courses/" + existing.id, "PUT", {
        ...data,
        version: existing.version
    })) : ok(await call(s, "settings/courses", "POST", data), 201);
}

export async function draft(s, extra = {}) {
    return ok(await call(s, "plans", "POST", {
        student_id: s.students[0],
        source_lead_id: null,
        subject: "music_interest",
        title: "钢琴学习方案",
        style: {
            pack_id: "stp_folio"
        },
        ...extra
    }), 201);
}

export async function filled(s, {amount: amount = 200, qty: qty = 2, ...extra} = {}) {
    const types = await seed(s), c = await course(s, "钢琴一对一", amount), p = await draft(s);
    return ok(await call(s, "plans/" + p.id, "PUT", {
        ...p,
        modules: {
            ...p.modules,
            path: {
                visible: true,
                stages: [ {
                    key: "tmp_stage_1",
                    stage_type_id: types[0].id,
                    name: "体验与适应",
                    start: "2026-12-01",
                    end: "2026-12-31"
                } ]
            },
            courses: {
                visible: true,
                lines: [ {
                    line_id: "tmp_line_1",
                    stage_key: "tmp_stage_1",
                    course_id: c.id,
                    qty: {
                        units: qty
                    },
                    includes: []
                } ]
            },
            ...extra.modules
        },
        ...Object.fromEntries(Object.entries(extra).filter(([k]) => k !== "modules"))
    }));
}

export async function parent(s, indices = [ 0 ]) {
    let user;
    for (const index of indices) {
        const r = ok(await call(s, "students/" + s.students[index] + "/guardians", "POST", {
            name: "家长",
            phone: "13812344321",
            relation: "mother"
        }), 201);
        user = r.parent || r.user || r;
    }
    const row = s.f.db.raw.prepare("SELECT * FROM users WHERE tenant_id=? AND roles='[\"parent\"]'").get(s.t.id);
    s.f.db.raw.prepare("UPDATE users SET must_change=0 WHERE tenant_id=? AND id=?").run(s.t.id, row.id);
    const token = b64(bytes(32));
    await s.r.createSession(await sha(token), await s.r.user(row.id), {
        ip: "test",
        ua: "plans"
    });
    return {
        id: row.id,
        token: token
    };
}

export { accountToken };

export async function golden(s, which = "A") {
    const subject = which === "A" ? "music_interest" : "art_exam", types = await seed(s, subject), p = await draft(s, {
        subject: subject,
        title: which === "A" ? "钢琴四级 8 个月学习方案" : "美术艺考学习方案"
    });
    const specs = which === "A" ? [ [ "钢琴一对一", 200, "per_unit" ], [ "寒假钢琴集训营", 2800, "per_term" ], [ "乐理与视唱练耳", 80, "per_unit" ], [ "考级冲刺", 260, "per_unit" ] ] : [ [ "周末基础班", 14e3, "per_semester" ], [ "暑期集训", 16e3, "per_term" ], [ "统考冲刺集训", 6500, "per_month" ], [ "校考集训", 12e3, "per_term" ], [ "画室公寓住宿", 1500, "per_month" ] ];
    const cs = [];
    for (const [i, [name, price, mode]] of specs.entries()) cs.push(await course(s, name, price, mode, {
        subject: subject,
        optional: which === "B" && i === 4
    }));
    const periods = which === "A" ? [ [ "2026-12-01", "2026-12-31" ], [ "2027-01-01", "2027-02-28" ], [ "2027-03-01", "2027-05-31" ], [ "2027-06-01", "2027-07-31" ] ] : [ [ "2026-12-01", "2027-06-30" ], [ "2027-07-01", "2027-08-31" ], [ "2027-09-01", "2027-12-31" ], [ "2028-01-01", "2028-03-31" ] ];
    const stages = periods.map(([start, end], i) => ({
        key: "tmp_s" + i,
        stage_type_id: types[i % types.length].id,
        name: (which === "A" ? [ "体验与适应", "寒假集训", "常规学习", "考级冲刺" ] : [ "基础学习", "暑期集训", "统考冲刺", "校考集训" ])[i],
        start: start,
        end: end,
        ...which === "B" && i > 0 ? {
            teaching_weeks: [ null, 8, 16, 10 ][i],
            weeks_note: [ "", "暑期集训按8个教学周", "统考12月上旬结束，冲刺期16个教学周", "春节放假，校考期间10个教学周" ][i]
        } : {}
    }));
    const lines = [];
    const add = (stage, index, qty, includes = []) => lines.push({
        line_id: "tmp_l" + lines.length,
        stage_key: "tmp_s" + stage,
        course_id: cs[index].id,
        qty: qty,
        includes: includes
    });
    if (which === "A") {
        add(0, 0, {
            units: 4
        });
        add(1, 0, {
            units: 4
        });
        add(1, 1, {
            terms: 1
        }, [ {
            label: "10天集训，每天2小时",
            form: "6人小组"
        }, {
            label: "结营汇报，不另收费"
        } ]);
        add(2, 0, {
            units: 13
        });
        add(2, 2, {
            units: 13
        });
        add(3, 0, {
            units: 9
        });
        add(3, 3, {
            units: 6
        }, [ {
            label: "两次模拟考"
        } ]);
    } else {
        add(0, 0, {
            semesters: 1
        }, [ {
            label: "周末60次，素描色彩速写"
        } ]);
        add(1, 1, {
            terms: 1
        });
        add(2, 2, {
            months: 4
        }, [ {
            label: "统考三科专项训练",
            form: "小组",
            schedule_text: "每周6天",
            duration_text: "全天"
        }, {
            label: "模拟考与评画讲评",
            form: "小组",
            schedule_text: "每月1次",
            duration_text: "全天"
        } ]);
        add(3, 3, {
            terms: 1
        });
        add(0, 4, {
            months: 6
        });
    }
    const due = which === "A" ? [ "2026-11-30", "2026-12-31", "2027-02-28", "2027-05-31" ] : [ "2026-11-30", "2027-06-15", "2027-08-25", "2027-12-25" ];
    return ok(await call(s, "plans/" + p.id, "PUT", {
        ...p,
        meta: {
            start_month: "2026-12",
            target: {
                node_key: which === "A" ? "grade_exam" : "unified_exam",
                month: which === "A" ? "2027-07" : "2027-12",
                text: which === "A" ? "钢琴四级" : "美术统考"
            },
            budget_cap: which === "A" ? 12e3 : 7e4
        },
        modules: {
            ...p.modules,
            path: {
                visible: true,
                stages: stages
            },
            courses: {
                visible: true,
                lines: lines
            },
            fees: {
                visible: true,
                installments: "per_stage",
                custom: [],
                due_dates: Object.fromEntries(due.map((v, i) => [ "tmp_s" + i, v ]))
            }
        }
    }));
}
