CREATE INDEX payment_allocation_payment ON student_payment_allocations(tenant_id,payment_id) WHERE deleted_at IS NULL;
