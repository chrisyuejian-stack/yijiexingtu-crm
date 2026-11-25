CREATE UNIQUE INDEX template_student_period ON schedule_enrollments(tenant_id,template_id,student_id,date_from) WHERE deleted_at IS NULL;
