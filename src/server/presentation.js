export const LESSON_LABELS = Object.freeze({
  planned: "待上课",
  completed: "已销课",
  student_leave: "学员请假",
  student_no_show: "学员旷课",
  teacher_leave: "教师请假",
  cancelled: "机构取消",
  rescheduled: "已调课",
});
export const ATTENDANCE_LABELS = Object.freeze({
  planned: "未登记",
  attended: "出勤",
  student_leave: "请假",
  no_show: "旷课",
  teacher_leave: "教师请假",
  cancelled: "机构取消",
});
export const REVIEW_LABELS = Object.freeze({
  pending: "待确认",
  returned: "已退回",
  confirmed: "已确认",
  superseded: "已替换",
});
export const SUBMISSION_GRACE_MS = 48 * 3600000;
export function lessonWindow(lesson, at) {
  const start = Date.parse(lesson.start_at),
    close = start + lesson.duration * 60000 + SUBMISSION_GRACE_MS;
  return {
    opens_at: start,
    closes_at: close,
    open: Number.isFinite(start) && at >= start && at <= close,
    overdue: at > close,
  };
}
export function beijingTime(at) {
  return new Date(Number(at) + 8 * 3600000)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");
}
export const MODULE_LABELS = Object.freeze({
  home: "工作台",
  schedule: "课表",
  templates: "固定排课",
  lessons: "课程",
  attendance: "出勤销课",
  students: "学员",
  followup: "教务跟进",
  packages: "课时包",
  tuition: "学费收款",
  teacher_pay: "教师课酬",
  settlements: "月度结算",
  reports: "统计报表",
  content: "招生内容", plans: "课程方案", growth_reports: "成长报告", school_db: "院校库",
  prices: "报价价格", feedback: "课后反馈", parents: "家长管理", ai: "AI工具", usage: "AI用量",
  exports: "导出",
  settings: "设置",
  accounts: "账号权限",
  logs: "操作记录",
  profile: "个人中心",
  classes: "班级",
  leads: "招生线索",
  referrals: "升学推荐",
  imports: "导入",
  comments: "课后点评",
  promo: "推广中心",
});
export const ACTION_LABELS = Object.freeze({
  read: "查看",
  create: "新增",
  update: "修改",
  delete: "删除",
  approve: "批准",
  submit: "提交",
  reject: "退回",
  unlock: "解锁",
  transfer: "课时转移",
  adjust: "课时调整",
  status: "整课销课",
  attendance: "逐人出勤",
  undo: "撤销销课",
  confirm_submission: "确认教师提交",
  return_submission: "退回教师提交",
  submit_attendance: "教师提交出勤",
  submit_comments: "教师提交点评",
  correct_comments: "员工更正点评",
  download: "下载导出",
  export: "下载导出",
  remind: "登记续费提醒",
  timetable: "导出品牌课表图",
  setting: "修改机构设置",
  generate: "生成排课",
  reorder: "调整顺序",
  reset_password: "重置密码",
  password: "修改密码",
  phone: "查看完整手机号",
});
export const AUTH_EVENT_LABELS = Object.freeze({
  login_success: "登录成功",
  login_failed: "登录失败",
  login_locked: "登录已锁定",
  logout: "退出登录",
});
export const EXPORT_KIND_LABELS = Object.freeze({
  lessons: "课程",
  packages: "课时包",
  finance: "财务",
  report: "统计报表",
  logs: "操作记录",
});

export const RATE_UNITS = Object.freeze({
  legacy: "课时",
  unit: "课时",
  lesson: "课次",
  person: "人次",
});
