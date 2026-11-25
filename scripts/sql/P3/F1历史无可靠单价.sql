SELECT x.tenant_id,x.id AS transaction_id,x.package_id,x.student_id,x.date AS ledger_date,
       x.type,x.delta,e.source,e.unpriced_units
FROM package_transactions x JOIN credit_income_entries e ON e.tenant_id=x.tenant_id AND e.id=x.id
WHERE x.deleted_at IS NULL AND e.deleted_at IS NULL
  AND (e.source IN ('legacy_no_price','legacy_overall') OR e.unpriced_units<>0)
ORDER BY x.tenant_id,x.date,x.id;
