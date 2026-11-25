CREATE UNIQUE INDEX one_published_comment ON lesson_comments(tenant_id,lesson_id,COALESCE(student_id,''));
