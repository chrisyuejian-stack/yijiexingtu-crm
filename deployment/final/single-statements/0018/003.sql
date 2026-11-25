CREATE INDEX credit_income_reversal ON credit_income_entries(tenant_id,reversed_by) WHERE reversed_by IS NOT NULL;
