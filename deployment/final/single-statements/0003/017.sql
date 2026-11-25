CREATE UNIQUE INDEX user_teacher ON users(tenant_id,teacher_id) WHERE teacher_id IS NOT NULL AND deleted_at IS NULL;
