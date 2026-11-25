// Pure presentation rules shared by API DTOs and browser. No money conversion/storage.
function displayInstant(value) {
  if (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T/.test(value) &&
    !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)
  )
    value += "+08:00";
  return new Date(value);
}
export const viewFormat = {
  money(v) {
    if (v === null || v === undefined || !Number.isFinite(Number(v)))
      return "未填写";
    const n = Number(v);
    return (
      (n < 0 ? "-¥" : "¥") +
      new Intl.NumberFormat("zh-CN", {
        minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
        maximumFractionDigits: 2,
      }).format(Math.abs(n))
    );
  },
  receivable(amount, unresolved) {
    return (
      viewFormat.money(amount) +
      (unresolved ? " · 另有 " + unresolved + " 笔待核对" : "")
    );
  },
  moneyCell(v) {
    return v === 0 ? "—" : viewFormat.money(v);
  },
  date(v) {
    if (v === null || v === undefined || v === "") return "未填写";
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v))
      return v.slice(0, 10);
    return new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(displayInstant(v));
  },
  day(v) {
    const date = viewFormat.date(v);
    if (date === "未填写") return date;
    return (
      date.slice(5) +
      " 周" +
      ["日", "一", "二", "三", "四", "五", "六"][
        new Date(date + "T12:00:00Z").getUTCDay()
      ]
    );
  },
  time(v) {
    if (v === null || v === undefined || v === "") return "未填写";
    if (typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v)) return v;
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Shanghai",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(displayInstant(v));
  },
  range(start, duration) {
    const min =
      Number(viewFormat.time(start).slice(0, 2)) * 60 +
      Number(viewFormat.time(start).slice(3)) +
      duration;
    return (
      viewFormat.time(start) +
      "–" +
      String(Math.floor(min / 60)).padStart(2, "0") +
      ":" +
      String(min % 60).padStart(2, "0")
    );
  },
  units(v) {
    return Number.isFinite(Number(v)) ? Number(v) + " 课时" : "未填写";
  },
};
export const VIEW_DEFAULTS = {
  low_balance_threshold: 3,
  expiry_warning_days: 30,
  teacher_view_student_balance: false,
};
export function packageStatus(
  row,
  settings = {},
  date = viewFormat.date(Date.now()),
) {
  const low = Number.isFinite(settings.low_balance_threshold)
    ? settings.low_balance_threshold
    : VIEW_DEFAULTS.low_balance_threshold;
  if (row.status === "paused")
    return { code: "paused", text: "已暂停", kind: "neutral" };
  if (row.valid_to && row.valid_to < date)
    return { code: "expired", text: "已过期", kind: "neutral" };
  if (Number(row.balance) === 0)
    return { code: "empty", text: "已用完", kind: "danger" };
  if (Number(row.balance) > 0 && Number(row.balance) <= low)
    return { code: "low", text: "余额低", kind: "warning" };
  return { code: "active", text: "使用中", kind: "success" };
}
export function stageStatus(row, date = viewFormat.date(Date.now())) {
  return row.status === "active" && row.date_to && row.date_to < date
    ? { code: "expired", text: "已到期", kind: "danger" }
    : {
        code: row.status,
        text:
          { active: "进行中", completed: "已完成", paused: "暂停" }[
            row.status
          ] || "未填写",
        kind: row.status === "completed" ? "success" : "neutral",
      };
}
export function studentDisplay(row, duplicates = []) {
  const same = duplicates.filter((x) => x.name === row.name);
  if ((row.same_name_count ?? same.length) <= 1) return row.name;
  let name = row.name + " · " + (row.grade || "未填年级");
  if (
    (row.same_grade_count ?? same.filter((x) => x.grade === row.grade).length) >
    1
  )
    name += " · " + (row.parent_name || "未填家长称呼");
  return name;
}

export function personStatus(row, kind = "students") {
  return (
    (kind === "teachers"
      ? { active: "在职", paused: "离职", archived: "离职" }
      : { active: "在读", paused: "暂停", archived: "归档" })[row.status] ||
    "未填写"
  );
}

export function leadMoveAllowed(from, to) {
  const order = ["new", "contacted", "trial", "lost"];
  return (
    from !== "lost" &&
    order.includes(from) &&
    order.includes(to) &&
    Math.abs(order.indexOf(from) - order.indexOf(to)) === 1
  );
}
