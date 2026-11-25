CREATE TRIGGER stage_has_payment_resolution BEFORE UPDATE OF deleted_at ON student_stages
WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL AND EXISTS(
  SELECT 1 FROM student_payment_resolutions r JOIN student_payments p ON p.tenant_id=r.tenant_id AND p.id=r.id
  WHERE r.tenant_id=NEW.tenant_id AND r.stage_id=NEW.id AND r.deleted_at IS NULL AND p.deleted_at IS NULL
)
BEGIN SELECT RAISE(ABORT,'stage_has_payment_resolution'); END;
