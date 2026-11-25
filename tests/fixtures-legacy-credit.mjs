// 仅用于对照测试：来自用户提供旧包 edu/app.js 最后生效的函数；不进入 dist。
// 原文件 SHA256: 3c2b03876b89bf3c9409774f6323b874f6347765c277c94ec16a4538d1252e96
export function legacyCreditOracle(db) {
  const N = (e) => Number(e) || 0,
    obj = (rows, id) => rows.find((x) => x.id === id),
    nm = (rows, id) => obj(rows, id)?.name || "—";
  let serial = 0;
  const uid = () => "legacy_" + ++serial,
    nowDate = () => "2026-11-02";
  function policyDeduct(e, t, n) {
    if ("attended" === n) {
      let n = e.makeupFor ? obj(db.lessonParticipants, e.makeupFor) : null;
      return n && N(n.deducted) > 0 ? 0 : N(t.units);
    }
    return "no_show" === n
      ? !1 === db.settings.absencePolicies.student_no_show?.deduct
        ? 0
        : N(t.units)
      : "student_leave" === n &&
          db.settings.absencePolicies.student_leave?.deduct
        ? N(t.units)
        : 0;
  }
  function allocateParticipant(e, t, n) {
    if (n <= 0) return void (e.deducted = 0);
    if ("overall" === obj(db.students, e.studentId)?.billingMode)
      return void (e.deducted = n);
    let s = db.packages
      .filter(
        (n) => n.studentId === e.studentId && n.courseTypeId === t.courseTypeId,
      )
      .sort((e, t) => String(e.date || "").localeCompare(String(t.date || "")));
    if (!s.length)
      throw Error(
        nm(db.students, e.studentId) + "尚未购买此课程课时包，不能销课",
      );
    let a = n;
    for (let t of s) {
      let n = Math.max(0, pkgBalance(t)),
        s = Math.min(n, a);
      if (
        (s &&
          (db.packageTransactions.push({
            id: uid("txn"),
            packageId: t.id,
            lessonParticipantId: e.id,
            type: "consume",
            delta: -s,
            date: nowDate(),
          }),
          (a -= s)),
        a < 0.001)
      )
        break;
    }
    if (a > 0.001)
      throw Error(
        nm(db.students, e.studentId) + "课时余额不足，缺少 " + a + " 课时",
      );
    e.deducted = n;
  }
  function reverseParticipant(e) {
    let t = db.packageTransactions.filter(
        (t) => t.lessonParticipantId === e.id,
      ),
      n = new Map();
    for (let e of t) n.set(e.packageId, (n.get(e.packageId) || 0) + N(e.delta));
    for (let [t, s] of n)
      Math.abs(s) > 0.001 &&
        db.packageTransactions.push({
          id: uid("txn"),
          packageId: t,
          lessonParticipantId: e.id,
          type: "reversal",
          delta: -s,
          date: nowDate(),
          note: "销课调整 / 撤销回补",
        });
    e.deducted = 0;
  }
  function refreshLinkedMakeups(e) {
    for (let t of db.lessonParticipants.filter(
      (t) => t.makeupFor === e && "attended" === t.attendance,
    )) {
      let e = obj(db.lessons, t.lessonId);
      e &&
        (reverseParticipant(t),
        allocateParticipant(t, e, policyDeduct(t, e, t.attendance)));
    }
  }
  function v093ReconcileLessonStatus(e) {
    const t = db.lessonParticipants.filter((t) => t.lessonId === e.id);
    if (!t.length) return;
    const n = t.map((e) => e.attendance || "planned");
    n.includes("attended")
      ? (e.status = "completed")
      : n.includes("planned")
        ? (e.status = "planned")
        : n.every((e) => "teacher_leave" === e)
          ? (e.status = "teacher_leave")
          : n.every((e) => "cancelled" === e)
            ? (e.status = "cancelled")
            : n.includes("no_show")
              ? (e.status = "student_no_show")
              : n.includes("student_leave")
                ? (e.status = "student_leave")
                : n.includes("teacher_leave")
                  ? (e.status = "teacher_leave")
                  : (e.status = "planned");
  }
  function pkgBalance(e) {
    return (
      N(e.total) +
      db.packageTransactions
        .filter((t) => t.packageId === e.id)
        .reduce((e, t) => e + N(t.delta), 0)
    );
  }
  return {
    db,
    apply(lessonId, status) {
      const lesson = obj(db.lessons, lessonId);
      for (const p of db.lessonParticipants.filter(
        (p) => p.lessonId === lessonId,
      )) {
        if (status === "completed" && p.attendance !== "planned") continue;
        reverseParticipant(p);
        p.attendance =
          {
            completed: "attended",
            student_no_show: "no_show",
            student_leave: "student_leave",
            teacher_leave: "teacher_leave",
            cancelled: "cancelled",
          }[status] || "planned";
        allocateParticipant(p, lesson, policyDeduct(p, lesson, p.attendance));
        refreshLinkedMakeups(p.id);
      }
      v093ReconcileLessonStatus(lesson);
    },
    balance(id) {
      return pkgBalance(obj(db.packages, id));
    },
  };
}
