-- 只读；两个计数均为 0 且 foreign_key_check 无结果才继续。异常由人工核对，不自动修复。
SELECT COUNT(*) invalid_participants FROM lesson_participants p WHERE NOT EXISTS(SELECT 1 FROM lessons l WHERE l.tenant_id=p.tenant_id AND l.id=p.lesson_id) OR NOT EXISTS(SELECT 1 FROM students s WHERE s.tenant_id=p.tenant_id AND s.id=p.student_id);
SELECT COUNT(*) invalid_lesson_times FROM lessons WHERE deleted_at IS NULL AND (datetime(start_at) IS NULL OR duration IS NULL OR duration<=0);
PRAGMA foreign_key_check;
