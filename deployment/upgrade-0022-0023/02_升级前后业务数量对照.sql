-- 只读。仅在确认已完成0021的同一数据库执行，升级前保存结果，升级后再次对照。
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
