CREATE INDEX credit_income_month ON credit_income_entries(tenant_id,booked_on) WHERE deleted_at IS NULL;
