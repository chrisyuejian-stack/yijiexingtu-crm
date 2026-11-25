CREATE INDEX IF NOT EXISTS p1_payments_date_active ON student_payments(tenant_id,paid_at,amount) WHERE deleted_at IS NULL;
