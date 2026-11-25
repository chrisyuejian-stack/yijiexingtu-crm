CREATE UNIQUE INDEX one_pending_submission ON lesson_submissions(tenant_id,lesson_id) WHERE status='pending' AND deleted_at IS NULL;
