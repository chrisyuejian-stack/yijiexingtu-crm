SELECT x.tenant_id,x.id AS missing_transaction_id
FROM package_transactions x LEFT JOIN credit_income_entries e
  ON e.tenant_id=x.tenant_id AND e.id=x.id AND e.deleted_at IS NULL
WHERE x.deleted_at IS NULL AND x.type IN ('consume','reversal') AND e.id IS NULL
ORDER BY x.tenant_id,x.id;
