-- 只读：适用于已完整到0021及之后的数据库；保存升级前后结果。停写期间数量应一致。
SELECT 'tenants' entity,COUNT(*) row_count FROM tenants UNION ALL
SELECT 'users' entity,COUNT(*) row_count FROM users UNION ALL
SELECT 'students' entity,COUNT(*) row_count FROM students UNION ALL
SELECT 'teachers' entity,COUNT(*) row_count FROM teachers UNION ALL
SELECT 'course_types' entity,COUNT(*) row_count FROM course_types UNION ALL
SELECT 'lessons' entity,COUNT(*) row_count FROM lessons UNION ALL
SELECT 'lesson_submissions' entity,COUNT(*) row_count FROM lesson_submissions UNION ALL
SELECT 'submission_people' entity,COUNT(*) row_count FROM submission_people UNION ALL
SELECT 'lesson_comments' entity,COUNT(*) row_count FROM lesson_comments UNION ALL
SELECT 'plans' entity,COUNT(*) row_count FROM plans UNION ALL
SELECT 'plan_revisions' entity,COUNT(*) row_count FROM plan_revisions UNION ALL
SELECT 'packages' entity,COUNT(*) row_count FROM packages UNION ALL
SELECT 'package_transactions' entity,COUNT(*) row_count FROM package_transactions UNION ALL
SELECT 'student_payments' entity,COUNT(*) row_count FROM student_payments;
