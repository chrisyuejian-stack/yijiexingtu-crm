CREATE INDEX payment_allocation_package ON student_payment_allocations(tenant_id,package_id) WHERE deleted_at IS NULL;
