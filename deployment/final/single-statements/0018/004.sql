CREATE INDEX credit_txn_participant_package ON package_transactions(tenant_id,participant_id,package_id) WHERE participant_id IS NOT NULL AND deleted_at IS NULL;
