CREATE UNIQUE INDEX lesson_student ON lesson_participants(tenant_id,lesson_id,student_id) WHERE deleted_at IS NULL;
