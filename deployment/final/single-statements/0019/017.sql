CREATE UNIQUE INDEX guardian_pair_active ON guardian_links(tenant_id,parent_user_id,student_id) WHERE revoked_at IS NULL;
