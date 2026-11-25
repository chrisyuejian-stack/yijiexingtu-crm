CREATE UNIQUE INDEX credit_debt_active_part ON credit_debts(tenant_id,participant_id) WHERE deleted_at IS NULL;
