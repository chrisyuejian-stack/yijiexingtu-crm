CREATE INDEX IF NOT EXISTS schedule_enrollments_student ON schedule_enrollments(tenant_id,student_id,date_from,date_to,template_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS lesson_participants_student ON lesson_participants(tenant_id,student_id,lesson_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS class_members_student ON class_members(tenant_id,student_id,class_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS schedule_templates_class ON schedule_templates(tenant_id,class_id,id) WHERE deleted_at IS NULL AND class_id IS NOT NULL;
