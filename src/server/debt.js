import { randomId, now } from "./core.js";

export const DEFAULT_MAX_DEBT_UNITS = 3;
export const maxDebtUnits = (settings) =>
  settings?.max_debt_units ?? DEFAULT_MAX_DEBT_UNITS;
export const roundUnits = (value) => Math.round(value * 100) / 100;
export const validForLesson = (pack, date) =>
  pack.status === "active" && (!pack.valid_from || pack.valid_from <= date) &&
  (!pack.valid_to || pack.valid_to >= date);
export const matchesDebtScope = (pack, scope) =>
  pack.scope_kind === "category"
    ? pack.category_id === scope.category_id
    : pack.course_type_id === scope.course_type_id;

// The caller supplies one credit snapshot per student and shares it across
// all new or recharged packages in this operation.
export function repayDebts(ctx, changes, pack, available, date, referenceId) {
  if (pack.status !== "active") return;
  for (const debt of ctx.debts) {
    if (available <= 0) break;
    if (
      debt.student_id !== pack.student_id ||
      debt.remaining_units <= 0 ||
      !validForLesson(pack, debt.lesson_date) ||
      !matchesDebtScope(pack, debt)
    ) continue;
    const amount = Math.min(available, debt.remaining_units);
    const previous = { ...debt };
    debt.remaining_units = roundUnits(debt.remaining_units - amount);
    debt.settled_at = debt.remaining_units === 0 ? now() : null;
    available = roundUnits(available - amount);
    const existing = changes.find((x) =>
      x.resource === "credit_debts" && x.data.id === debt.id,
    );
    if (!existing) changes.push({ resource: "credit_debts", previous, data: debt });
    changes.push({
      resource: "package_transactions",
      data: {
        id: randomId("txn"),
        package_id: pack.id,
        student_id: pack.student_id,
        delta: -amount,
        type: "consume",
        date,
        participant_id: debt.participant_id,
        reference_id: referenceId,
        note: "补扣欠课时",
        deleted_at: null,
      },
    });
  }
}
