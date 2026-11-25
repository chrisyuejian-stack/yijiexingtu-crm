CREATE UNIQUE INDEX announcement_read_once ON announcement_reads(tenant_id,announcement_id,user_id) WHERE deleted_at IS NULL;
