CREATE UNIQUE INDEX lesson_occurrence ON lessons(tenant_id,template_id,occurrence_date) WHERE template_id IS NOT NULL AND deleted_at IS NULL;
