-- 全部为只读。应有6张新表、2个命名索引、2个保护触发器；旧表行数应与停写前相同。
SELECT type,name,sql FROM sqlite_master WHERE name IN('plan_templates','plan_sample_templates','plan_reference_flags','plan_briefs','plan_v2_conversions','plan_v2_elements','plan_templates_list','plan_v2_elements_owner','plan_v2_element_identity','plan_v2_conversion_identity') ORDER BY type,name;
PRAGMA table_info(plan_templates);
PRAGMA table_info(plan_sample_templates);
PRAGMA table_info(plan_reference_flags);
PRAGMA table_info(plan_briefs);
PRAGMA table_info(plan_v2_conversions);
PRAGMA table_info(plan_v2_elements);
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

SELECT 'plan_templates' AS table_name,COUNT(*) AS row_count FROM plan_templates
UNION ALL
SELECT 'plan_sample_templates' AS table_name,COUNT(*) AS row_count FROM plan_sample_templates
UNION ALL
SELECT 'plan_reference_flags' AS table_name,COUNT(*) AS row_count FROM plan_reference_flags
UNION ALL
SELECT 'plan_briefs' AS table_name,COUNT(*) AS row_count FROM plan_briefs
UNION ALL
SELECT 'plan_v2_conversions' AS table_name,COUNT(*) AS row_count FROM plan_v2_conversions
UNION ALL
SELECT 'plan_v2_elements' AS table_name,COUNT(*) AS row_count FROM plan_v2_elements;
PRAGMA quick_check;
PRAGMA foreign_key_check;
