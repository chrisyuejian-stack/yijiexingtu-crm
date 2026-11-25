CREATE INDEX student_balance_student ON student_balances_ledger(tenant_id,student_id,created_at,id) WHERE deleted_at IS NULL;
