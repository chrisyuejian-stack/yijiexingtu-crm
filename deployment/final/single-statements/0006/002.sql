UPDATE lessons SET format=COALESCE((SELECT c.format FROM course_types c WHERE c.tenant_id=lessons.tenant_id AND c.id=lessons.course_type_id),'individual');
