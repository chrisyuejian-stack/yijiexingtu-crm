CREATE INDEX credit_debt_student_fifo ON credit_debts(tenant_id,student_id,created_at,id) WHERE deleted_at IS NULL AND remaining_units>0;
