import {
  node,
  icon,
  button,
  iconButton,
  field,
  badge,
  switchControl,
  card,
  updateNumber,
  formatMoney,
  emptyState,
  tableSkeleton,
  toast,
  overlay,
  confirmDialog,
  disclosure,
  selectControl,
  dateControl,
  pagination,
  dataList,
} from "/ui/components.js";
const get = (id) => document.getElementById(id),
  delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const colors = [
  ["primary", "机构主题色", "默认 #2B4C7E"],
  ["soft", "主题浅底", "主题色 8% · 选中行、当前导航"],
  ["page", "页面底色", "#F4F2F7"],
  ["panel", "面板", "#FFFFFF · 边框 #E3DEEA"],
  ["text", "主文字", "#1E1A26"],
  ["muted", "次要文字", "#6B6476 · 对白底 5.5:1"],
  ["header", "表头浅底", "#FAF9FC"],
  ["border", "输入框边", "#D5CEDF"],
];
for (const [key, title, description] of colors) {
  const item = node("div", null, { class: "preview-swatch" });
  item.append(
    node("div", null, { class: "preview-swatch-paint preview-swatch--" + key }),
    node("strong", title),
    node("small", description),
  );
  get("swatches").append(item);
}
get("status-colors").append(
  node("span", "状态色", { class: "preview-tag-label" }),
);
for (const [text, tone] of [
  ["已上课 / 成功", "success"],
  ["待上课 / 信息", "info"],
  ["请假 / 余额低", "warning"],
  ["旷课 / 错误", "error"],
  ["已取消 / 停用", "neutral"],
])
  get("status-colors").append(badge(text, tone));
get("category-colors").append(
  node("span", "课程类别", { class: "preview-tag-label" }),
);
for (const [text, tone] of [
  ["钢琴", "piano"],
  ["声乐", "voice"],
  ["乐理视唱", "theory"],
  ["集训班", "training"],
  ["美术", "art"],
])
  get("category-colors").append(badge(text, tone));
for (const [label, text, kind] of [
  ["页面标题 22/600", "周课表", "title"],
  ["区块标题 16/600", "今日课程", "section"],
  ["正文 14/400", "预览学员 · 钢琴一对一", "body"],
  ["表格/辅助 13/400", "2026-11-02 周一 10:00–10:45", "small"],
  ["标签/说明 12/500", "最近更新：预览教师 · 片刻前", "caption"],
  ["关键数字 28/700", "126 节", "number"],
])
  get("typography").append(
    node("span", label, { class: "preview-type-label" }),
    node("span", text, { class: "preview-sample--" + kind }),
  );
let saved = 0;
async function fakeCommit() {
  await delay(450);
  if (get("simulate-failure").checked) {
    get("simulate-failure").checked = false;
    throw Error("模拟保存失败，已恢复原值");
  }
  saved++;
}
function openDrawer() {
  let dirty = false;
  const drawer = overlay({
      title: "新建表单 · 组件预览",
      kind: "drawer",
      isDirty: () => dirty,
    }),
    form = node("form", null, { class: "preview-form" }),
    name = field({
      label: "名称",
      name: "preview-name",
      required: true,
      validate: (value) => (value.trim() ? "" : "请输入名称"),
    }),
    notes = field({
      label: "备注",
      name: "preview-notes",
      type: "textarea",
      hint: "仅用于开发演示，不会保存到业务系统",
    });
  name.input.autofocus = true;
  form.append(
    node("p", "抽屉宽度520px；手机全屏。试着修改后按Esc，或点击遮罩。", {
      class: "preview-drawer-copy",
    }),
    name.element,
    notes.element,
  );
  form.addEventListener("input", () => (dirty = true));
  const save = button("保存", {
    kind: "primary",
    onClick: async () => {
      if (!name.validate()) {
        name.input.focus();
        return;
      }
      drawer.setBusy(true);
      try {
        await fakeCommit();
        dirty = false;
        toast("演示保存成功");
        await drawer.close();
      } finally {
        drawer.setBusy(false);
      }
    },
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    save.click();
  });
  drawer.body.append(form);
  drawer.footer.append(button("取消", { onClick: drawer.requestClose }), save);
  return drawer;
}
const basic = get("basic-inputs");
basic.append(
  node("p", "按钮：每个业务页面最多一个主按钮", { class: "preview-note" }),
);
const actions = node("div", null, { class: "preview-actions" });
actions.append(
  button("新建课程", { kind: "primary", icon: "plus", onClick: openDrawer }),
  button("导出 Excel", {
    onClick: () => toast("组件演示，不生成业务导出文件", { tone: "info" }),
  }),
  button("查看全部", {
    kind: "link",
    onClick: () => get("component-lab").scrollIntoView({ block: "start" }),
  }),
  button("停用账号", {
    kind: "danger",
    onClick: async () => {
      if (
        await confirmDialog({
          title: "确认停用？",
          message: "这是确认弹窗的开发演示，不会停用真实账号。",
          confirmLabel: "确认停用",
          danger: true,
        })
      )
        toast("已完成演示操作");
    },
  }),
);
basic.append(
  actions,
  node("p", "输入框：标签在上，错误提示在下", { class: "preview-note" }),
);
const nameField = field({
    label: "学员姓名",
    name: "sample-name",
    value: "预览学员一",
  }),
  phoneField = field({
    label: "手机号",
    name: "sample-phone",
    value: "13912",
    error: "请输入 11 位手机号",
    validate: (value) =>
      /^1[3-9]\d{9}$/.test(value) ? "" : "请输入 11 位手机号",
  });
basic.append(nameField.element, phoneField.element);
const switches = get("basic-switches");
switches.append(
  node("p", "开关：用于设置项，右侧说明影响范围", { class: "preview-note" }),
);
const paymentSwitch = switchControl({
    label: "学员可查看缴费记录",
    description: "关闭后学员端不显示，服务器也不返回",
    checked: true,
    onCommit: fakeCommit,
  }),
  teacherSwitch = switchControl({
    label: "教师自助提交",
    description: "教师提交后需教务确认",
    checked: false,
    onCommit: fakeCommit,
  });
switches.append(
  paymentSwitch.element,
  teacherSwitch.element,
  node("p", "数据卡片：一个数字＋一行对比或说明", { class: "preview-note" }),
);
const metric = card("本周课程"),
  metricLine = node("div", null, { class: "preview-metric-line" });
metricLine.append(
  node("strong", "126", { class: "ui-number" }),
  node("small", "节 · 已上 48"),
);
metric.append(
  metricLine,
  node("p", "比上周多 8 节", { class: "preview-metric-increase" }),
);
switches.append(metric);
const baseColumns = [
  { key: "name", label: "学员" },
  { key: "remaining", label: "剩余课时" },
  {
    key: "status",
    label: "状态",
    searchValue: (r) =>
      ({ active: "在读", low: "余额低", archived: "已结课" })[r.status],
    render: (r) =>
      badge(
        { active: "在读", low: "余额低", archived: "已结课" }[r.status],
        { active: "success", low: "warning", archived: "neutral" }[r.status],
      ),
  },
];
const samples = [
  { id: "sample-a", name: "预览学员一", remaining: 12, status: "active" },
  { id: "sample-b", name: "预览学员二", remaining: 2, status: "low" },
  { id: "sample-c", name: "预览学员三", remaining: 0, status: "archived" },
];
get("basic-table").append(
  node("p", "表格：表头浅底，行高44，操作列靠右", { class: "preview-note" }),
  dataList({
    label: "样式示例",
    columns: baseColumns,
    items: samples,
    onOpen: () => openDrawer(),
  }).element,
  node("p", "空状态：说明为什么空＋下一步", { class: "preview-note" }),
  emptyState("本周还没有课程", "从固定排课模板批量生成，或点“新建课程”"),
);
get("interaction-actions").append(
  button("打开抽屉", { onClick: openDrawer }),
  button("打开弹窗", {
    onClick: () =>
      confirmDialog({
        title: "确认操作",
        message: "弹窗支持焦点陷阱、Esc关闭和返回触发元素。",
        confirmLabel: "确认演示",
      }),
  }),
  button("成功提示", { onClick: () => toast("保存成功，3秒后自动关闭") }),
  button("错误提示", {
    onClick: () => toast("模拟错误：请检查后重新操作", { tone: "error" }),
  }),
  button("保存状态", {
    onClick: async () => {
      await fakeCommit();
      toast("演示保存成功");
    },
  }),
);
const theme = selectControl({
  label: "主题色（预设）",
  options: [
    { value: "blue", label: "蓝色 · #2B4C7E" },
    { value: "purple", label: "紫色 · #3B2A5E" },
    { value: "green", label: "绿色 · #1F6B5C" },
    { value: "red", label: "砖红 · #8A3B2E" },
  ],
  value: "blue",
  onChange: (v) => {
    document.body.dataset.uiTheme = v;
    for (const root of document.querySelectorAll("dialog,.ui-toast-region"))
      root.dataset.uiTheme = v;
  },
});
get("theme-select").append(theme.element);
get("motion-exception").append(
  disclosure("分组展开（获准的高度动画）", [
    button("预览子项一", { kind: "link" }),
    button("预览子项二", { kind: "link" }),
  ]),
);
get("click-card").append(
  card("可点击卡片", "悬停上浮，按下反馈，键盘Enter/空格可用", {
    interactive: true,
    onClick: () => toast("可点击卡片已响应"),
  }),
);
const select = selectControl({
  label: "选择课程类别",
  options: [
    { value: "piano", label: "钢琴" },
    { value: "voice", label: "声乐" },
    { value: "theory", label: "乐理视唱" },
    { value: "art", label: "美术" },
  ],
  value: "piano",
  onChange: () => toast("选项已切换", { tone: "info" }),
});
get("select-demo").append(select.element);
const date = dateControl({
  label: "选择日期",
  value: "2026-11-02",
  onChange: (value) =>
    (get("date-result").textContent =
      "选择结果：" + value + "（北京时间日期）"),
});
get("date-demo").append(date.element);
get("loading-demo").append(tableSkeleton({ columns: 3, rows: 3 }));
get("empty-demo").append(
  emptyState("暂无内容", "新增内容后会显示在这里。", {
    action: button("新建示例", { onClick: openDrawer }),
  }),
);
const count = node("strong", "126", { class: "ui-number ui-number--primary" });
get("number-demo").append(
  node("p", "关键数字变化只高亮，不做滚动计数", { class: "preview-note" }),
  count,
  button("更新数字", {
    onClick: () => updateNumber(count, Number(count.textContent) + 1),
  }),
);
const previewRows = [
  ...samples,
  {
    id: "sample-literal",
    name: "预览 %_\\ 学员",
    remaining: 6,
    status: "active",
  },
];
const list = dataList({
  label: "交互演示列表",
  columns: baseColumns.map((c) => ({ ...c, sortable: c.key !== "status" })),
  items: previewRows,
  searchable: true,
  selectable: true,
  manual: true,
  filters: [
    { value: "active", label: "在读" },
    { value: "low", label: "余额低" },
    { value: "archived", label: "已结课" },
  ],
  onOpen: openDrawer,
  onDelete: fakeCommit,
  deleteMessage: "这是开发演示，确认后只移除本地示例行，不影响业务数据。",
  onReorder: fakeCommit,
  onBatch: async (ids) => {
    await fakeCommit();
    toast("演示已处理 " + ids.length + " 项；未写入业务数据");
  },
  onLoadMore: async () => {
    await delay(500);
    return [
      {
        id: "sample-more",
        name: "新加载的预览学员",
        remaining: 8,
        status: "active",
      },
    ];
  },
});
get("list-demo").append(list.element);
get("list-actions").append(
  button("新增示例行", {
    icon: "plus",
    onClick: () =>
      list.add({
        id: "sample-new-" + Date.now(),
        name: "新建的预览学员",
        remaining: 10,
        status: "active",
      }),
  }),
  button("模拟筛选加载", {
    onClick: async () => {
      list.setLoading(true);
      await delay(600);
      list.setLoading(false);
    },
  }),
);
get("pagination-demo").append(
  pagination({
    loaded: 4,
    offset: 0,
    nextOffset: 200,
    onPage: () => toast("分页组件演示；没有全局总数", { tone: "info" }),
  }),
);
const names = {
  home: "工作台",
  calendar: "课表",
  clock: "时间",
  users: "班级",
  user: "档案",
  book: "课程",
  wallet: "财务",
  settings: "设置",
  plus: "新增",
  edit: "编辑",
  delete: "删除",
  search: "搜索",
  filter: "筛选",
  download: "下载",
  upload: "上传",
  check: "成功",
  close: "关闭",
  warning: "警告",
  info: "信息",
  bell: "消息",
  shield: "安全",
  logout: "退出",
  refresh: "刷新",
  eye: "查看",
  more: "更多",
  empty: "空状态",
  drag: "拖动",
  link: "链接",
  "chevron-left": "向左",
  "chevron-right": "向右",
  "chevron-down": "展开",
  "arrow-up": "上移",
  "arrow-down": "下移",
  sort: "排序",
};
for (const [key, label] of Object.entries(names)) {
  const item = node("div", null, { class: "preview-icon-item" });
  item.append(icon(key), node("span", label));
  get("icon-demo").append(item);
}
// Dev-only observability for reproducible browser interaction checks; no production API or global hook.
get("component-lab").dataset.uiReady = "true";
