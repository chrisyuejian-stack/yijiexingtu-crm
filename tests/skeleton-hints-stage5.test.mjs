import test from "node:test";

import assert from "node:assert/strict";

import { mkdir, writeFile } from "node:fs/promises";

import { school, seed, draft, parent, call, ok } from "./fixtures-plans.mjs";

const instruction = "选课时加入冲刺课程，课程与数量由顾问确认";

const request = {
    start_month: "2026-12",
    target: {
        node_key: "grade_exam",
        month: "2027-07"
    },
    options: {
        insert_holiday_camp: true
    }
};

test("YX5H 冲刺顾问提示只在阶段hints中，采用、发送、导出和家长分享均不泄露", () => school(async s => {
    await seed(s);
    const p = await draft(s), before = ok(await call(s, "plans/" + p.id + "/revisions")).total;
    const proposal = ok(await call(s, "plans/" + p.id + "/skeleton", "POST", request));
    const sprint = proposal.stages.find(x => x.name === "考级冲刺");
    assert.ok(sprint);
    assert.ok(sprint.hints.includes(instruction));
    for (const stage of proposal.stages) {
        assert.ok(Array.isArray(stage.hints));
        assert.ok(stage.hints.every(x => typeof x === "string"));
        assert.ok(!stage.goals.includes(instruction));
    }
    assert.equal(ok(await call(s, "plans/" + p.id + "/revisions")).total, before);
    const visibleGoal = "完成考级曲目的连贯演奏";
    sprint.goals.push(visibleGoal);
    const saved = ok(await call(s, "plans/" + p.id, "PUT", {
        ...p,
        modules: {
            ...p.modules,
            path: {
                visible: true,
                stages: proposal.stages
            }
        }
    }));
    assert.ok(saved.modules.path.stages.some(x => x.goals.includes(visibleGoal)));
    assert.ok(!JSON.stringify(saved).includes(instruction));
    assert.ok(saved.modules.path.stages.every(x => !Object.hasOwn(x, "hints")));
    const pa = await parent(s);
    ok(await call(s, "plans/" + p.id + "/send", "POST", {}));
    const link = ok(await call(s, "plans/" + p.id + "/share-links", "POST", {}), 201);
    for (const result of [ ok(await call(s, "plans/" + p.id + "/export", "POST", {})), ok(await call(s, "parent/plans/" + p.id, "GET", undefined, pa.token)), ok(await call(s, "/api/share/" + link.url.split("/").at(-1), "GET", undefined, null)) ]) {
        assert.ok(!JSON.stringify(result).includes(instruction));
        assert.ok(result.render_data.modules.path.stages.every(x => !Object.hasOwn(x, "hints")));
        assert.ok(result.render_data.modules.path.stages.some(x => x.goals.includes(visibleGoal)));
    }
    await mkdir("work/stage5/frontend-stage4", {
        recursive: true
    });
    await writeFile("work/stage5/frontend-stage4/skeleton-example-" + (process.env.TEST_BUNDLE === "1" ? "bundle" : "source") + ".json", JSON.stringify({
        request: {
            method: "POST",
            path: "/" + s.t.slug + "/api/plans/" + p.id + "/skeleton",
            body: request
        },
        response: {
            status: 200,
            body: proposal
        }
    }, null, 2) + "\n");
}));

test("YX5H 关闭冲刺规则时hints为空，艺考学生可见目标继续保留", () => school(async s => {
    await seed(s);
    const rules = ok(await call(s, "settings/stage-rules"));
    ok(await call(s, "settings/stage-rules", "PUT", {
        ...rules,
        rules: {
            ...rules.rules,
            exam_sprint_before_grade: false
        }
    }));
    const p = await draft(s), plain = ok(await call(s, "plans/" + p.id + "/skeleton", "POST", request));
    assert.ok(plain.stages.every(x => Array.isArray(x.hints) && x.hints.length === 0));
    await seed(s, "art_exam");
    const artRules = ok(await call(s, "settings/stage-rules"));
    ok(await call(s, "settings/stage-rules", "PUT", {
        ...artRules,
        rules: {
            ...artRules.rules,
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
    assert.ok(exam.stages.every(x => x.hints.length === 0));
    assert.ok(exam.stages.every(x => x.goals.some(y => y.includes("模拟考"))));
    assert.ok(exam.stages.at(-1).goals.some(x => x.includes("文化课")));
}));
