CREATE UNIQUE INDEX makeup_target ON makeup_links(tenant_id,target_participant_id) WHERE deleted_at IS NULL;
