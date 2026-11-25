CREATE UNIQUE INDEX user_student ON users(tenant_id,student_id) WHERE student_id IS NOT NULL AND deleted_at IS NULL;
