CREATE INDEX IF NOT EXISTS p1_credit_ledger_active ON package_transactions(tenant_id,package_id,delta,date) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS p1_credit_debt_active ON credit_debts(tenant_id,student_id,course_type_id,category_id,remaining_units) WHERE deleted_at IS NULL AND remaining_units>0;
CREATE INDEX IF NOT EXISTS p1_payments_date_active ON student_payments(tenant_id,paid_at,amount) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS p1_payments_package_active ON student_payments(tenant_id,package_id,amount) WHERE deleted_at IS NULL AND package_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS p1_earned_by_date ON package_transactions(tenant_id,date,package_id,student_id,delta) WHERE deleted_at IS NULL AND type IN ('consume','reversal');
