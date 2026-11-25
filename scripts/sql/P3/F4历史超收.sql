SELECT p.tenant_id,p.id AS package_id,p.student_id,p.amount AS due_cents,
       SUM(r.amount) AS paid_cents,SUM(r.amount)-p.amount AS excess_cents
FROM packages p JOIN package_receipt_lines r ON r.tenant_id=p.tenant_id AND r.package_id=p.id
WHERE p.deleted_at IS NULL AND p.amount IS NOT NULL
GROUP BY p.tenant_id,p.id HAVING SUM(r.amount)>p.amount
ORDER BY p.tenant_id,p.id;
