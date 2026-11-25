CREATE UNIQUE INDEX class_member_once ON class_members(tenant_id,class_id,student_id) WHERE deleted_at IS NULL;
