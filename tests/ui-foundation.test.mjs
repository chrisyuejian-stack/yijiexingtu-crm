import { test } from "node:test";
import assert from "node:assert/strict";
import { formatMoney, validDate, isoDate } from "../src/ui/components.js";
test("阶段A：金额仅省略零小数，分位/负数/缺失值不被改写", () => {
  for (const [input, want] of [
    [12, "¥12"],
    [12.3, "¥12.30"],
    [12.01, "¥12.01"],
    [0.01, "¥0.01"],
    [0, "¥0"],
    [-0, "¥0"],
    [-12.5, "-¥12.50"],
    [-12, "-¥12"],
    [1234.5, "¥1,234.50"],
    [null, "—"],
    [undefined, "—"],
    [NaN, "—"],
  ])
    assert.equal(formatMoney(input), want);
});
test("阶段A：日期选择校验闰日和月年边界，不把无效日期自动改日", () => {
  assert.equal(validDate("2028-02-29"), true);
  assert.equal(validDate("2026-02-29"), false);
  assert.equal(validDate("2026-11-31"), false);
  assert.equal(validDate("2026-1-02"), false);
  assert.equal(validDate(""), false);
  assert.equal(isoDate(2026, 12, 32), "2027-01-01");
  assert.equal(isoDate(2026, 11, 0), "2026-10-31");
  assert.equal(isoDate(2028, 2, 29), "2028-02-29");
});
