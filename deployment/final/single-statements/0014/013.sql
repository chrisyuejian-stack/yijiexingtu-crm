CREATE TRIGGER payment_resolution_owner BEFORE INSERT ON student_payment_resolutions
WHEN NOT EXISTS (
  SELECT 1 FROM student_payments p
  WHERE p.tenant_id=NEW.tenant_id AND p.id=NEW.id AND p.student_id=NEW.student_id
) OR (NEW.stage_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM student_stages s
  WHERE s.tenant_id=NEW.tenant_id AND s.id=NEW.stage_id AND s.student_id=NEW.student_id
))
BEGIN SELECT RAISE(ABORT,'payment_resolution_owner'); END;
