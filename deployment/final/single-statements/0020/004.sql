CREATE UNIQUE INDEX offer_courses_name ON offer_courses(tenant_id,subject,name) WHERE deleted_at IS NULL;
