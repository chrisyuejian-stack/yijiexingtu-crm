-- 第三阶段修复。执行一次：金额 REAL 元 -> INTEGER 分；金额接口仍为元。
ALTER TABLE packages ADD COLUMN unit_price_cents INTEGER CHECK(unit_price_cents IS NULL OR (typeof(unit_price_cents)='integer' AND unit_price_cents>=0));
ALTER TABLE packages ADD COLUMN amount_cents INTEGER CHECK(amount_cents IS NULL OR (typeof(amount_cents)='integer' AND amount_cents>=0));
UPDATE packages SET unit_price_cents=CASE WHEN unit_price IS NULL THEN NULL ELSE CAST(ROUND(unit_price*100) AS INTEGER) END,amount_cents=CASE WHEN amount IS NULL THEN NULL ELSE CAST(ROUND(amount*100) AS INTEGER) END;
ALTER TABLE packages DROP COLUMN unit_price;
ALTER TABLE packages DROP COLUMN amount;
ALTER TABLE packages RENAME COLUMN unit_price_cents TO unit_price;
ALTER TABLE packages RENAME COLUMN amount_cents TO amount;
ALTER TABLE student_payments ADD COLUMN amount_cents INTEGER NOT NULL DEFAULT 0 CHECK(typeof(amount_cents)='integer' AND amount_cents>=0);
UPDATE student_payments SET amount_cents=CAST(ROUND(amount*100) AS INTEGER);
ALTER TABLE student_payments DROP COLUMN amount;
ALTER TABLE student_payments RENAME COLUMN amount_cents TO amount;
ALTER TABLE audit_log ADD COLUMN money_version INTEGER NOT NULL DEFAULT 0;
CREATE TRIGGER ledger_student_reference BEFORE INSERT ON package_transactions BEGIN SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM packages WHERE tenant_id=NEW.tenant_id AND id=NEW.package_id AND student_id=NEW.student_id) THEN RAISE(ABORT,'invalid_package_student') END; END;
CREATE TRIGGER payment_student_reference BEFORE INSERT ON student_payments WHEN NEW.package_id IS NOT NULL BEGIN SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM packages WHERE tenant_id=NEW.tenant_id AND id=NEW.package_id AND student_id=NEW.student_id) THEN RAISE(ABORT,'invalid_payment_student') END; END;
CREATE TRIGGER payment_student_update BEFORE UPDATE OF package_id,student_id,tenant_id ON student_payments WHEN NEW.package_id IS NOT NULL BEGIN SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM packages WHERE tenant_id=NEW.tenant_id AND id=NEW.package_id AND student_id=NEW.student_id) THEN RAISE(ABORT,'invalid_payment_student') END; END;
CREATE TRIGGER package_owner_immutable BEFORE UPDATE OF tenant_id,student_id ON packages WHEN NEW.tenant_id IS NOT OLD.tenant_id OR NEW.student_id IS NOT OLD.student_id BEGIN SELECT RAISE(ABORT,'immutable_package_owner'); END;
