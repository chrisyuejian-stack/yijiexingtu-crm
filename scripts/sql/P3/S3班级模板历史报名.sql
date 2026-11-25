SELECT e.tenant_id,e.id AS enrollment_id,e.template_id,t.class_id,e.student_id,e.date_from,e.date_to
FROM schedule_enrollments e JOIN schedule_templates t ON t.tenant_id=e.tenant_id AND t.id=e.template_id
WHERE e.deleted_at IS NULL AND t.deleted_at IS NULL AND t.class_id IS NOT NULL
ORDER BY e.tenant_id,e.template_id,e.student_id,e.id;
