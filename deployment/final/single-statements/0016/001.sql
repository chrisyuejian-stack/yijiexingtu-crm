CREATE INDEX IF NOT EXISTS p1_credit_ledger_active ON package_transactions(tenant_id,package_id,delta,date) WHERE deleted_at IS NULL;
