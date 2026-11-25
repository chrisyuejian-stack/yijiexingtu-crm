CREATE UNIQUE INDEX partner_lesson_once ON lessons(tenant_id,source_session_id) WHERE source_session_id IS NOT NULL;
