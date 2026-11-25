import { fail } from "./core.js";
// 仅 HTTP 边界调用 moneyIn/moneyOut；业务、SQL 和审计内部均使用整数分。
export function moneyIn(value, { nullable = false, signed = false } = {}) {
  if (nullable && (value === null || value === "")) return null;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    Math.abs(value) > 100000000 ||
    (!signed && value < 0) ||
    Math.abs(value * 100 - Math.round(value * 100)) > 1e-7
  )
    fail(400, "金额最多两位小数");
  return Math.round(value * 100);
}
export function quantityIn(
  value,
  { zero = false, signed = false, max = 1000000 } = {},
) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    Math.abs(value) > max ||
    (!signed && value < (zero ? 0 : 0.01)) ||
    Math.abs(value * 100 - Math.round(value * 100)) > 1e-7
  )
    fail(400, "课时数最多两位小数");
  return Math.round(value * 100) / 100;
}
const fields = new Set([
  "seat_price",
  "balance_amount",
  "deposit_amount",
  "overflow",
  "other_income_amount",
  "suggested_price",
  "unit_price",
  "amount",
  "rate",
  "override_rate",
  "locked_rate",
  "teacher_cost",
  "teacher_pay_amount",
  "tuition_amount",
  "cost_amount",
  "profit_amount",
  "earned_amount",
  "profit_cash",
  "profit_earned",
  "accrued_amount",
  "adjustment_amount",
  "paid_amount",
  "due_amount",
  "unpaid_amount",
  "total_amount",
  "reference_from_price",
  "reference_to_price",
]);
export function moneyOut(value) {
  if (Array.isArray(value)) return value.map(moneyOut);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, v]) => [
      key,
      fields.has(key) && typeof v === "number" ? v / 100 : moneyOut(v),
    ]),
  );
}
export function multiplyCents(cents, quantity) {
  const scale = 1000000000000n;
  const digits = BigInt(quantity.toFixed(12).replace(".", ""));
  const result = Number((BigInt(cents) * digits + scale / 2n) / scale);
  if (!Number.isSafeInteger(result)) fail(400, "计算金额超出安全范围");
  return result;
}
