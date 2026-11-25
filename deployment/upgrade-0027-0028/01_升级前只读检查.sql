-- 全部为只读。确认当前数据库已完成0027；保存本结果再升级。
PRAGMA table_info(gallery_images);
PRAGMA table_info(tenants);
SELECT type,name FROM sqlite_master WHERE name IN('plan_templates','plan_sample_templates','plan_reference_flags','plan_briefs','plan_v2_conversions','plan_v2_elements') ORDER BY name;
SELECT 'plans' AS table_name,COUNT(*) AS row_count FROM plans
UNION ALL
SELECT 'plan_contexts' AS table_name,COUNT(*) AS row_count FROM plan_contexts
UNION ALL
SELECT 'plan_revisions' AS table_name,COUNT(*) AS row_count FROM plan_revisions
UNION ALL
SELECT 'plan_elements' AS table_name,COUNT(*) AS row_count FROM plan_elements
UNION ALL
SELECT 'students' AS table_name,COUNT(*) AS row_count FROM students
UNION ALL
SELECT 'users' AS table_name,COUNT(*) AS row_count FROM users
UNION ALL
SELECT 'sessions' AS table_name,COUNT(*) AS row_count FROM sessions
UNION ALL
SELECT 'content_items' AS table_name,COUNT(*) AS row_count FROM content_items
UNION ALL
SELECT 'gallery_images' AS table_name,COUNT(*) AS row_count FROM gallery_images
UNION ALL
SELECT 'offer_courses' AS table_name,COUNT(*) AS row_count FROM offer_courses
UNION ALL
SELECT 'stage_types' AS table_name,COUNT(*) AS row_count FROM stage_types;
PRAGMA quick_check;
PRAGMA foreign_key_check;
