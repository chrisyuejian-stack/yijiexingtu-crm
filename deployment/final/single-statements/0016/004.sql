CREATE INDEX IF NOT EXISTS p1_payments_package_active ON student_payments(tenant_id,package_id,amount) WHERE deleted_at IS NULL AND package_id IS NOT NULL;
