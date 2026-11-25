CREATE INDEX IF NOT EXISTS p1_credit_debt_active ON credit_debts(tenant_id,student_id,course_type_id,category_id,remaining_units) WHERE deleted_at IS NULL AND remaining_units>0;
