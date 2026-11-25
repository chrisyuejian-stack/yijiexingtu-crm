// 仅测试使用：用户旧包 edu/app.js 最后生效的财务计算片段，不进入 dist。
// SHA256 3c2b03876b89bf3c9409774f6323b874f6347765c277c94ec16a4538d1252e96
export function legacyFinanceOracle(db, ui) {
  const N = (e) => Number(e) || 0,
    obj = (rows, id) => rows.find((x) => x.id === id),
    nm = (rows, id) => obj(rows, id)?.name || "—",
    monthOf = (x) => String(x || "").slice(0, 7),
    typeOf = (l) => obj(db.courseTypes, l.courseTypeId),
    personIds = (l) =>
      db.lessonParticipants
        .filter((p) => p.lessonId === l.id)
        .map((p) => p.studentId),
    isLocked = (l) =>
      db.settlements.some((s) => s.month === monthOf(l.start) && s.locked);
  function rate(e) {
    if (void 0 !== e.overrideRate && "" !== e.overrideRate)
      return N(e.overrideRate);
    let t = db.teacherRates.find(
      (t) =>
        t.teacherId === e.teacherId &&
        t.courseTypeId === e.courseTypeId &&
        t.format === e.format,
    );
    return N(t?.rate);
  }
  function teacherCost(e) {
    let t = db.settings.absencePolicies?.[e.status],
      n = isLocked(e) && void 0 !== e.lockedRate ? N(e.lockedRate) : rate(e);
    return "completed" === e.status || t?.teacherPaid ? n * N(e.units) : 0;
  }
  function financeWeight(e, t) {
    let n = db.lessonParticipants.filter((t) => t.lessonId === e.id),
      s = n.filter(
        (e) => "attended" === e.attendance || "no_show" === e.attendance,
      ),
      a = s.length ? s : n;
    return a.some((e) => e.studentId === t)
      ? teacherCost(e) / Math.max(1, a.length)
      : 0;
  }
  function financeLessons() {
    return db.lessons.filter((e) => monthOf(e.start) === ui.month);
  }
  function teacherRows() {
    return financeLessons()
      .map((e) => ({ lesson: e, amount: teacherCost(e) }))
      .filter((e) => e.amount > 0);
  }
  function paidTeacher(e, t) {
    return db.teacherPayments
      .filter((n) => n.teacherId === e && n.month === t)
      .reduce((e, t) => e + N(t.amount), 0);
  }
  function financeDimension(e, t) {
    return "teacher" === t
      ? e.teacherId
      : "type" === t
        ? e.courseTypeId
        : "category" === t
          ? typeOf(e)?.categoryId || ""
          : "room" === t
            ? e.locationId
            : "";
  }
  function financeDimArray(e) {
    return "teacher" === e
      ? db.teachers
      : "student" === e
        ? db.students
        : "type" === e
          ? db.courseTypes
          : "category" === e
            ? db.categories
            : db.locations;
  }
  function financeItems() {
    let e = ui.financeMode,
      t = teacherRows(),
      n =
        "student" === e
          ? [...new Set(t.flatMap((e) => personIds(e.lesson)))]
          : [
              ...new Set(
                t.map((t) => financeDimension(t.lesson, e)).filter(Boolean),
              ),
            ],
      s = financeDimArray(e);
    return n
      .map((n) => ({
        id: n,
        name: nm(s, n),
        amount:
          "student" === e
            ? t.reduce((e, t) => e + financeWeight(t.lesson, n), 0)
            : t
                .filter((t) => financeDimension(t.lesson, e) === n)
                .reduce((e, t) => e + t.amount, 0),
        units:
          "student" === e
            ? t.reduce(
                (e, t) =>
                  e + (personIds(t.lesson).includes(n) ? N(t.lesson.units) : 0),
                0,
              )
            : t
                .filter((t) => financeDimension(t.lesson, e) === n)
                .reduce((e, t) => e + N(t.lesson.units), 0),
      }))
      .sort((e, t) => t.amount - e.amount);
  }
  return { rate, teacherCost, financeItems, paidTeacher };
}
