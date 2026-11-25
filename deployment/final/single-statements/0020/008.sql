CREATE UNIQUE INDEX report_classes_name ON report_classes(tenant_id,subject,name) WHERE deleted_at IS NULL;
