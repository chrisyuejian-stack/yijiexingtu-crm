CREATE INDEX IF NOT EXISTS lesson_participants_student ON lesson_participants(tenant_id,student_id,lesson_id) WHERE deleted_at IS NULL;
