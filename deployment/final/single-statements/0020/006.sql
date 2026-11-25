CREATE UNIQUE INDEX stage_types_name ON stage_types(tenant_id,subject,name) WHERE deleted_at IS NULL;
