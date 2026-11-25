CREATE INDEX lesson_occurrence_range ON lessons(tenant_id,occurrence_date,template_id) WHERE template_id IS NOT NULL AND deleted_at IS NULL;
