-- 只读。在已有 0025 的正式库执行；保存结果以便升级后对照。
SELECT name,sql FROM sqlite_master WHERE type='table' AND name IN ('plans','plan_prospects','students','leads','content_items') ORDER BY name;
PRAGMA table_info(plans);
PRAGMA table_info(content_items);
SELECT 'plans' AS table_name,COUNT(*) AS row_count FROM plans
UNION ALL SELECT 'students',COUNT(*) FROM students
UNION ALL SELECT 'leads',COUNT(*) FROM leads
UNION ALL SELECT 'plan_contexts',COUNT(*) FROM plan_contexts
UNION ALL SELECT 'plan_revisions',COUNT(*) FROM plan_revisions
UNION ALL SELECT 'share_links',COUNT(*) FROM share_links
UNION ALL SELECT 'content_items',COUNT(*) FROM content_items
UNION ALL SELECT 'content_revisions',COUNT(*) FROM content_revisions;
PRAGMA foreign_key_check;
