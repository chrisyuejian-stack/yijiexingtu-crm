// 页面、扣课和课酬共用；不修改传入设置，逐项保留已明确保存的 false。
export const DEFAULT_ABSENCE_POLICIES = Object.freeze({
  student_leave: Object.freeze({ deduct: false, teacherPaid: false }),
  student_no_show: Object.freeze({ deduct: true, teacherPaid: true }),
  teacher_leave: Object.freeze({ deduct: false, teacherPaid: false }),
  cancelled: Object.freeze({ deduct: false, teacherPaid: false }),
});
export function effectivePolicies(settings = {}) {
  const saved = settings?.absence_policies;
  return Object.fromEntries(
    Object.entries(DEFAULT_ABSENCE_POLICIES).map(([key, defaults]) => [
      key,
      Object.fromEntries(
        Object.entries(defaults).map(([field, fallback]) => [
          field,
          typeof saved?.[key]?.[field] === "boolean"
            ? saved[key][field]
            : fallback,
        ]),
      ),
    ]),
  );
}
