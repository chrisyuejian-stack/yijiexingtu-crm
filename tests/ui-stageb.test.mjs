import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { tenantAssets } from "../scripts/frontend-bundle.mjs";
const context = vm.createContext({ Date, Set, Map });
vm.runInContext(await readFile("src/tenant/calendar.js", "utf8"), context);
const C = context.ChannelCalendar;
const lesson = (id, start = "2026-11-02T09:00", props = {}) => ({
  id,
  start_at: start,
  teacher_id: "t1",
  assistant_id: null,
  location_id: "r1",
  mode: "offline",
  duration: 45,
  status: "planned",
  ...props,
});
test("阶段B：已知快照教师/助教、教室和学员冲突在保存前识别，排除自己及取消课程", () => {
  const a = lesson("a"),
    b = lesson("b", "2026-11-02T10:00");
  assert.ok(
    C.knownConflicts(a, "2026-11-02T10:00", [a, b]).includes("教师时间冲突"),
  );
  assert.ok(
    C.knownConflicts(a, "2026-11-02T10:00", [
      lesson("b", b.start_at, { teacher_id: "t2", assistant_id: "t1" }),
    ]).includes("教师时间冲突"),
  );
  assert.ok(
    C.knownConflicts(a, "2026-11-02T10:00", [
      lesson("b", b.start_at, { teacher_id: "t2" }),
    ]).includes("教室时间冲突"),
  );
  const details = new Map([
    ["a", { participants: [{ student_id: "s1" }] }],
    ["b", { participants: [{ student_id: "s1" }] }],
  ]);
  assert.ok(
    C.knownConflicts(
      a,
      "2026-11-02T10:00",
      [lesson("b", b.start_at, { teacher_id: "t2", location_id: "r2" })],
      details,
    ).includes("学员时间冲突"),
  );
  for (const status of ["cancelled", "teacher_leave", "rescheduled"])
    assert.equal(
      C.knownConflicts(a, b.start_at, [lesson("b", b.start_at, { status })])
        .length,
      0,
    );
  assert.equal(C.knownConflicts(a, a.start_at, [a]).length, 0);
});
test("阶段B：已知快照边界时间、不同日期、线上教室及不可排时段与后端口径一致", () => {
  const a = lesson("a"),
    details = new Map([["a", { participants: [{ student_id: "s1" }] }]]);
  assert.equal(
    C.knownConflicts(a, "2026-11-02T10:45", [lesson("b", "2026-11-02T10:00")])
      .length,
    0,
  );
  assert.equal(
    C.knownConflicts(a, "2026-11-03T10:00", [lesson("b", "2026-11-02T10:00")])
      .length,
    0,
  );
  assert.equal(
    C.knownConflicts({ ...a, mode: "online" }, "2026-11-02T10:00", [
      lesson("b", "2026-11-02T10:00", { teacher_id: "t2" }),
    ]).length,
    0,
  );
  const block = {
    student_id: "s1",
    weekday: 0,
    start_time: "10:00",
    end_time: "11:00",
    active: 1,
  };
  assert.ok(
    C.knownConflicts(a, "2026-11-02T10:00", [], details, [block]).includes(
      "学员不可排时段",
    ),
  );
  assert.equal(
    C.knownConflicts(a, "2026-11-02T11:00", [], details, [block]).length,
    0,
  );
  assert.equal(
    C.knownConflicts(a, "2026-11-02T10:00", [], details, [
      { ...block, active: 0 },
    ]).length,
    0,
  );
});
test("阶段B：北京时间日期、跨周跨年与15分钟目标不经浏览器时区换算", () => {
  assert.equal(C.monday("2027-01-01"), "2026-12-28");
  assert.equal(C.shift("2026-12-31", 1), "2027-01-01");
  assert.equal(C.shift("2028-02-28", 1), "2028-02-29");
  assert.equal(C.at("2026-11-02", 9 * 60 + 15), "2026-11-02T09:15");
});
test("阶段B：全部19处原生确认已替换为共享弹窗，无新增内联HTML/样式/事件或外部字体", async () => {
  const app = await readFile("src/tenant/app.js", "utf8"),
    calendar = await readFile("src/tenant/calendar.js", "utf8");
  assert.equal((app.match(/await ask\(/g) || []).length, 19);
  assert.doesNotMatch(app, /\bconfirm\(/);
  assert.match(app, /UI\.confirmDialog/);
  for (const file of [app, calendar]) {
    assert.doesNotMatch(
      file,
      /\.innerHTML\s*=|\.style\.|setAttribute\(["']style["']/,
    );
    assert.doesNotMatch(file, /fonts\.googleapis|cdn\.jsdelivr|unpkg\.com/);
  }
});
test("阶段B：组件合并进既有两条静态路径，生产图标来自A的本地符号，金额仅隐藏.00", async () => {
  const assets = await tenantAssets();
  assert.match(assets.js, /globalThis\.ChannelUI=/);
  assert.match(assets.js, /globalThis\.ChannelCalendar\s*=/);
  assert.match(assets.js, /ChannelUISymbols=/);
  assert.doesNotMatch(assets.js, /import\.meta\.url|from ["'].*components/);
  assert.match(assets.css, /\.ui-actions-head/);
  assert.match(assets.css, /prefers-reduced-motion/);
  if (process.env.TEST_BUNDLE === "1") {
    const built = await readFile("dist/assets/tenant.js", "utf8");
    assert.match(built, /ChannelCalendar/);
    assert.doesNotMatch(built, /sourceMappingURL/);
  }
});
