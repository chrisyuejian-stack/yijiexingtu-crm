CREATE TRIGGER payment_allocation_owner BEFORE INSERT ON student_payment_allocations
WHEN NOT EXISTS (
  SELECT 1 FROM packages p
  WHERE p.tenant_id=NEW.tenant_id AND p.id=NEW.package_id AND p.student_id=NEW.student_id
) OR (NEW.payment_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM student_payments p
  WHERE p.tenant_id=NEW.tenant_id AND p.id=NEW.payment_id AND p.student_id=NEW.student_id
)) OR (NEW.ledger_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM student_balances_ledger l
  WHERE l.tenant_id=NEW.tenant_id AND l.id=NEW.ledger_id AND l.student_id=NEW.student_id
    AND l.package_id=NEW.package_id AND l.type='redeem' AND l.amount=-NEW.amount
))
BEGIN SELECT RAISE(ABORT,'payment_allocation_owner'); END;
