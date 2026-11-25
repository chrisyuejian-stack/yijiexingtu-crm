CREATE INDEX IF NOT EXISTS schedule_enrollments_student ON schedule_enrollments(tenant_id,student_id,date_from,date_to,template_id) WHERE deleted_at IS NULL;
