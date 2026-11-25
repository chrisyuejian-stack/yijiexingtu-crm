CREATE INDEX IF NOT EXISTS class_members_student ON class_members(tenant_id,student_id,class_id) WHERE deleted_at IS NULL;
