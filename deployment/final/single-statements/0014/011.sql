CREATE VIEW pending_student_payments AS
SELECT p.* FROM student_payments p
WHERE p.package_id IS NULL AND p.deleted_at IS NULL AND NOT EXISTS (
  SELECT 1 FROM student_payment_resolutions r
  WHERE r.tenant_id=p.tenant_id AND r.id=p.id AND r.deleted_at IS NULL
);
