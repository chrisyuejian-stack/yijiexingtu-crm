CREATE VIEW package_receipt_lines AS
SELECT tenant_id,student_id,package_id,amount FROM student_payments
WHERE package_id IS NOT NULL AND deleted_at IS NULL
UNION ALL
SELECT tenant_id,student_id,package_id,amount FROM student_payment_allocations WHERE deleted_at IS NULL;
