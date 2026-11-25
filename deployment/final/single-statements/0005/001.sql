-- 第三阶段修复。执行一次：金额 REAL 元 -> INTEGER 分；金额接口仍为元。
ALTER TABLE packages ADD COLUMN unit_price_cents INTEGER CHECK(unit_price_cents IS NULL OR (typeof(unit_price_cents)='integer' AND unit_price_cents>=0));
