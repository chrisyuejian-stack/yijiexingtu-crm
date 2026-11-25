CREATE INDEX IF NOT EXISTS schedule_templates_class ON schedule_templates(tenant_id,class_id,id) WHERE deleted_at IS NULL AND class_id IS NOT NULL;
