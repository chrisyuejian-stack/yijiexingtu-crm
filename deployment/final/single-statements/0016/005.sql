CREATE INDEX IF NOT EXISTS p1_earned_by_date ON package_transactions(tenant_id,date,package_id,student_id,delta) WHERE deleted_at IS NULL AND type IN ('consume','reversal');
