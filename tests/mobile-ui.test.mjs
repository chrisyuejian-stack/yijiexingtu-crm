import { installFoundation } from "./ui-dom-support.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import {
  LESSON_LABELS,
  ATTENDANCE_LABELS,
  REVIEW_LABELS,
  RATE_UNITS,
} from "../src/server/presentation.js";
class Node {
  constructor(tag = "div") {
    this.tag = tag;
    this.children = [];
    this.attrs = {};
    this.listeners = {};
    this._text = "";
    this.className = "";
    this.classList = { add: (name) => (this.className += " " + name) };
  }
  set textContent(value) {
    this._text = String(value);
    this.children = [];
  }
  get textContent() {
    return this._text + this.children.map((x) => x.textContent || "").join(" ");
  }
  append(...nodes) {
    this.children.push(...nodes);
  }
  replaceChildren(...nodes) {
    this._text = "";
    this.children = nodes;
  }
  setAttribute(key, value) {
    this.attrs[key] = value;
    if (key === "class") this.className = value;
  }
  removeAttribute(key) {
    delete this.attrs[key];
  }
  addEventListener(key, fn) {
    this.listeners[key] = fn;
  }
  querySelectorAll(tag) {
    return this.children.flatMap((x) => [
      ...(x.tag === tag ? [x] : []),
      ...x.querySelectorAll(tag),
    ]);
  }
  scrollIntoView() {}
  remove() {}
  async click() {
    await this.listeners.click?.({ preventDefault() {} });
  }
}
async function app() {
  let source = await readFile(
    new URL("../src/tenant/app.js", import.meta.url),
    "utf8",
  );
  const a = source.indexOf("(async () => {\n  try {\n    // 品牌和“我是谁”"),
    b = source.indexOf("})();", a) + 5;
  assert.ok(a >= 0);
  source = source.slice(0, a) + source.slice(b);
  const root = new Node(),
    texts = [],
    canvases = [];
  const ctx = {
    fillRect() {},
    drawImage() {},
    fillText(t) {
      texts.push(t);
    },
    measureText(t) {
      return { width: t.length * 30 };
    },
  };
  const document = {
    querySelector: (s) =>
      s === "#root"
        ? root
        : s.includes("tenant-base")
          ? { content: "/school/" }
          : new Node(),
    createElement: (tag) => {
      const n = new Node(tag);
      if (tag === "canvas") {
        canvases.push(n);
        n.getContext = () => ctx;
        n.toBlob = (cb) => cb(new Blob(["test"]));
      }
      return n;
    },
  };
  const context = vm.createContext({
    document,
    Blob,
    URL,
    Intl,
    Date,
    console,
    setTimeout,
    clearTimeout,
    Image: class {
      constructor() {
        this.naturalWidth = 200;
        this.naturalHeight = 200;
      }
      async decode() {}
    },
  });
  await installFoundation(context, Node, document);
  vm.runInContext(
    source +
      '\n globalThis.ui={set(value){me=value.me;brand=value.brand;personalMonth=value.month||"2026-11";},api(fn){api=fn;},schedule(fn){scheduleRows=fn;},monthPicker,personalRecords,personalPay,reviewScreen,brandInitial,timetableImage,shell,wrapCanvasText,renewalNotice,promoContain,partnerLabel,personalPartner,promoDetail,promoTime,media(fn){promoLoadImage=fn;}};',
    context,
  );
  const me = {
    user: { roles: ["student"], name: "本人" },
    labels: {
      lessons: LESSON_LABELS,
      attendance: ATTENDANCE_LABELS,
      reviews: REVIEW_LABELS,
      rate_units: RATE_UNITS,
    },
    capabilities: {},
  };
  const brand = {
    display_name: "机构预览",
    logo: null,
    theme_color: "#2B4C7E",
  };
  context.ui.set({ me, brand });
  return { ui: context.ui, root, me, brand, texts, canvases };
}
test("第五阶段界面修正：品牌首字、月份跨年/闰月切换即加载；学员记录排除未来、逐人待销课状态准确", async () => {
  const { ui, root, me, brand } = await app();
  assert.equal(ui.brandInitial(), "机");
  ui.set({
    me,
    brand: { ...brand, display_name: "🎵音乐机构" },
    month: "2026-03",
  });
  assert.equal(ui.brandInitial(), "🎵");
  let loaded = 0;
  ui.monthPicker(root, () => {
    loaded++;
  });
  await root.querySelectorAll("button")[0].click();
  const monthRoot = new Node();
  ui.monthPicker(monthRoot, () => {});
  assert.ok(monthRoot.textContent.includes("2026年2月"));
  assert.equal(loaded, 1);
  ui.set({ me, brand, month: "2026-01" });
  root.replaceChildren();
  ui.monthPicker(root, () => {
    loaded++;
  });
  await root.querySelectorAll("button")[0].click();
  const previous = new Node();
  ui.monthPicker(previous, () => {});
  assert.ok(previous.textContent.includes("2025年12月"));
  const base = {
    course_name: "记录课程",
    teacher_name: "授课教师",
    location_name: "教室",
    status: "planned",
    own_attendance: "planned",
    own_deducted: 0,
    start_at: "2026-11-01T09:00+08:00",
  };
  ui.schedule(async () => [
    { ...base, id: "started" },
    {
      ...base,
      id: "future",
      course_name: "未来课程",
      start_at: "2099-01-01T09:00+08:00",
    },
    {
      ...base,
      id: "partial",
      course_name: "逐人已销课",
      own_attendance: "attended",
      own_deducted: 1,
    },
  ]);
  await ui.personalRecords(root);
  assert.ok(!root.textContent.includes("未来课程"));
  assert.ok(root.textContent.includes("待销课"));
  assert.ok(!root.textContent.includes("扣0课时"));
  assert.ok(root.textContent.includes("扣1课时"));
});
test("第五阶段界面修正：待确认与出勤名单同序、空点评无尾分隔；未销课课酬区别显示；品牌图按七天分组且不重复本人、不含金额同学", async () => {
  const { ui, root, me, brand, texts } = await app();
  const lesson = {
    course_name: "班课",
    teacher_name: "本人教师",
    location_name: "教室",
    start_at: "2026-11-02T09:00+08:00",
    duration: 45,
    units: 1,
    status: "planned",
  };
  ui.set({ me: { ...me, user: { roles: ["supervisor"] } }, brand });
  ui.api(async () => ({
    lesson,
    participants: [
      { id: "p2", name: "乙同学", attendance: "planned" },
      { id: "p1", name: "甲同学", attendance: "planned" },
    ],
    people: [
      { participant_id: "p1", attendance: "attended", comment: "" },
      { participant_id: "p2", attendance: "attended", comment: "有进步" },
    ],
    submission: { status: "pending", kind: "attendance" },
    published: [],
  }));
  await ui.reviewScreen(root, "lesson", () => {});
  const panels = root.children.filter((x) => x.className.includes("panel")),
    attendance = panels.find((x) => x.textContent.includes("学员出勤")),
    pending = panels.find((x) => x.textContent.includes("待确认不扣课"));
  const names = (p) =>
    p
      .querySelectorAll("p")
      .map((x) => x.textContent)
      .filter((t) => t.includes("甲同学") || t.includes("乙同学"))
      .map((t) => t.split(" · ")[0]);
  assert.deepEqual(names(attendance), names(pending));
  assert.ok(
    !pending.querySelectorAll("p").some((x) => x.textContent.endsWith(" · ")),
  );
  ui.set({ me: { ...me, user: { roles: ["teacher"] } }, brand });
  ui.api(async () => ({
    items: [],
    lessons: [
      { ...lesson, rate: 200, quantity: 0, amount: 0, rate_basis: "legacy" },
      {
        ...lesson,
        status: "completed",
        rate: 200,
        quantity: 1,
        amount: 200,
        rate_basis: "legacy",
      },
    ],
    payments: [],
    adjustments: [],
  }));
  await ui.personalPay(root);
  assert.ok(root.textContent.includes("待销课，不计酬"));
  assert.equal(
    root.children.filter((n) => n.className.includes("pay-pending")).length,
    1,
  );
  ui.api(async () => ({
    owner_name: "本人教师",
    from: "2026-11-02",
    to: "2026-11-08",
    items: [{ ...lesson, amount: 999, students: ["不应画出的同学"] }],
  }));
  await ui.timetableImage(root, "2026-11-02");
  for (const day of [
    "星期一",
    "星期二",
    "星期三",
    "星期四",
    "星期五",
    "星期六",
    "星期日",
  ])
    assert.ok(texts.some((t) => t.includes(day)));
  assert.equal(texts.filter((x) => x === "休息").length, 6);
  assert.equal(texts.filter((t) => t.includes("本人教师")).length, 1);
  assert.ok(texts.some((t) => t.includes("机构预览 · 生成于")));
  assert.ok(!texts.join(" ").includes("999"));
  assert.ok(!texts.join(" ").includes("不应画出的同学"));
});

test("UI重构回归：两组导航（日常7项+机构管理5项）、按角色和权限隐藏空项；第七阶段未来课酬仍按北京时间汇总", async () => {
  const { ui, root, me, brand } = await app();
  const all = Object.fromEntries(
    [
      "home",
      "schedule",
      "templates",
      "classes",
      "attendance",
      "exports",
      "students",
      "packages",
      "followup",
      "leads",
      "referrals",
      "tuition",
      "teacher_pay",
      "settlements",
      "reports",
      "settings",
      "accounts",
      "imports",
      "logs",
      "profile",
    ].map((m) => [m, { read: true, export: true, confirm: true }]),
  );
  ui.set({
    me: { ...me, user: { roles: ["supervisor"] }, capabilities: all },
    brand,
  });
  ui.api(async () => ({ items: [], lessons: [] }));
  ui.shell();
  await Promise.resolve();
  const nav = root.querySelectorAll("nav")[0];
  assert.deepEqual(
    nav.querySelectorAll("button").map((x) => x.textContent),
    [
      "今天",
      "待办",
      "课表",
      "学员",
      "教师",
      "招生",
      "财务",
      "课程与教室",
      "账号与权限",
      "机构设置",
      "数据导入导出",
      "操作记录",
    ],
  );
  assert.equal(
    nav.querySelectorAll("button").some((x) => x.attrs["aria-controls"]),
    false,
  );
  for (const role of ["academic", "finance"]) {
    ui.set({
      me: { ...me, user: { roles: [role] }, capabilities: all },
      brand,
    });
    ui.shell();
    await Promise.resolve();
    const labels = root
      .querySelectorAll("nav")[0]
      .querySelectorAll("button")
      .map((x) => x.textContent);
    assert.deepEqual(
      labels,
      role === "academic"
        ? [
            "今天",
            "待办",
            "课表",
            "学员",
            "教师",
            "招生",
            "课程与教室",
            "账号与权限",
            "机构设置",
            "数据导入导出",
            "操作记录",
          ]
        : ["今天", "课表", "学员", "财务"],
    );
  }
  ui.set({
    me: {
      ...me,
      user: { roles: ["academic"] },
      capabilities: { home: { read: true }, profile: { read: true } },
    },
    brand,
  });
  ui.shell();
  await Promise.resolve();
  assert.deepEqual(
    root
      .querySelectorAll("nav")[0]
      .querySelectorAll("button")
      .map((x) => x.textContent),
    ["今天"],
  );
  ui.set({ me: { ...me, user: { roles: ["teacher"] } }, brand });
  const today = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
  }).format(new Date());
  ui.api(async () => ({
    items: [],
    payments: [],
    adjustments: [],
    lessons: [
      {
        course_name: "今天课程",
        start_at: today + "T23:59+08:00",
        status: "planned",
        units: 1,
      },
      { course_name: "未来一", start_at: "2099-01-01T09:00+08:00" },
      { course_name: "未来二", start_at: "2099-01-02T09:00+08:00" },
    ],
  }));
  await ui.personalPay(root);
  assert.ok(root.textContent.includes("今天课程"));
  assert.ok(root.textContent.includes("本月还有 2 节待上课"));
  assert.ok(!root.textContent.includes("未来一"));
  assert.ok(!root.textContent.includes("未来二"));
});
test("第七阶段界面：续费图中文标点不居行首、无二维码默认联系说明、内容决定高度，二维码和长说明完整绘制", async () => {
  const { ui, root, brand, texts, canvases } = await app();
  const lines = ui.wrapCanvasText(
    { measureText: (t) => ({ width: Array.from(t).length * 10 }) },
    "甲乙丙，丁戊。己庚！辛壬？甲乙（丙丁）戊",
    30,
  );
  assert.ok(lines.every((t) => !/^[，。！？、；：）》」』】〕〉]/u.test(t)));
  assert.equal(lines.join(""), "甲乙丙，丁戊。己庚！辛壬？甲乙（丙丁）戊");
  await ui.renewalNotice(root, brand, {
    student_name: "小明",
    course_name: "钢琴",
    balance: 2,
  });
  assert.ok(texts.includes("请联系机构老师"));
  assert.ok(canvases[0].height < 800);
  const shortHeight = canvases[0].height;
  await ui.renewalNotice(
    root,
    {
      ...brand,
      consultant_qr: "data:image/png;base64,test",
      contact_text: "联系课程顾问，预约下一阶段课程。".repeat(12),
    },
    { student_name: "小明", course_name: "钢琴", balance: 2 },
  );
  assert.ok(canvases[1].height > shortHeight);
  assert.ok(texts.join("").includes("联系课程顾问"));
  assert.ok(!texts.some((t) => /^[，。！？、；：）》」』】〕〉]/u.test(t)));
});

test("第八阶段界面：合作课个人详情无销课/会议信息；Logo等比居中不拉伸", async () => {
  const { ui, root } = await app();
  const image = { naturalWidth: 400, naturalHeight: 100 };
  let drawn;
  ui.promoContain(
    {
      drawImage(...args) {
        drawn = args;
      },
    },
    image,
    { x: 10, y: 20, width: 200, height: 200 },
  );
  assert.deepEqual(drawn, [image, 10, 95, 200, 50]);
  ui.personalPartner(
    root,
    {
      course_name: "合作课",
      teacher_name: "合作讲师",
      start_at: "2099-01-01T09:00:00+08:00",
      duration: 45,
      meeting_url: "https://meeting.tencent.com/private",
    },
    () => {},
  );
  assert.ok(root.textContent.includes("合作课程 · 待上课"));
  assert.ok(!root.textContent.includes("meeting.tencent.com"));
  assert.equal(root.querySelectorAll("button").length, 1);
});

test("第八阶段收尾界面：课程信息/截止先于步骤条和营销长图，课程封面不占首屏；学员直播文案", async () => {
  const { ui, root, me, brand } = await app();
  me.labels.promo = { applications: {} };
  ui.set({ me, brand });
  ui.media(async () => ({ src: "blob:marketing" }));
  ui.api(async (path) =>
    path.endsWith("/read")
      ? {}
      : {
          campaign: {
            id: "course",
            title: "合作课程",
            type: "course",
            cover: "cover",
            lecturer: "合作讲师",
            apply_deadline: Date.parse("2026-11-04T12:00:00+08:00"),
            detail_image_key: "long",
            body: "课程正文",
          },
          sessions: [{ start_at: "2026-11-05T19:00:00+08:00", duration: 45 }],
          posters: [],
          contacts: [],
        },
  );
  await ui.promoDetail(root, "course");
  const text = root.textContent;
  assert.ok(text.indexOf("主讲：") < text.indexOf("申请加入"));
  assert.ok(
    text.indexOf("申请截止：2026-11-04 12:00:00") < text.indexOf("申请加入"),
  );
  assert.equal(root.querySelectorAll("img").length, 1);
  assert.equal(root.querySelectorAll("img")[0].attrs.alt, "课程介绍");
  const body = root.querySelectorAll("ol")[0];
  assert.equal(body.children.length, 4);
  ui.personalPartner(
    root,
    {
      course_name: "合作课",
      teacher_name: "讲师",
      start_at: "2099-01-01T09:00:00+08:00",
      duration: 45,
    },
    () => {},
  );
  assert.ok(root.textContent.includes("线上直播课，上课安排请联系机构老师。"));
  assert.ok(!root.textContent.includes("无需机构销课"));
});
