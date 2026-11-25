CREATE TRIGGER balance_ledger_owner BEFORE INSERT ON student_balances_ledger
WHEN (NEW.payment_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM student_payments p
  WHERE p.tenant_id=NEW.tenant_id AND p.id=NEW.payment_id AND p.student_id=NEW.student_id
)) OR (NEW.package_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM packages p
  WHERE p.tenant_id=NEW.tenant_id AND p.id=NEW.package_id AND p.student_id=NEW.student_id
))
BEGIN SELECT RAISE(ABORT,'balance_ledger_owner'); END;
