SELECT m.tenant_id,m.original_participant_id,COUNT(*) AS active_count,group_concat(m.target_lesson_id) AS target_lessons
FROM makeup_links m
JOIN lesson_participants p ON p.tenant_id=m.tenant_id AND p.id=m.target_participant_id
JOIN lessons l ON l.tenant_id=m.tenant_id AND l.id=m.target_lesson_id
WHERE m.deleted_at IS NULL AND p.deleted_at IS NULL AND l.deleted_at IS NULL
  AND p.attendance NOT IN ('student_leave','no_show','teacher_leave','cancelled')
  AND l.status NOT IN ('cancelled','rescheduled','teacher_leave')
GROUP BY m.tenant_id,m.original_participant_id HAVING COUNT(*)>1
ORDER BY m.tenant_id,m.original_participant_id;
