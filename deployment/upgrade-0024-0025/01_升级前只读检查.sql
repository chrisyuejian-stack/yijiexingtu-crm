-- 只读。确认选中艺界星途自己的完整0024数据库。article_json不存在才执行0025。
PRAGMA table_info('content_items');
SELECT name,type FROM sqlite_master WHERE name IN('content_items','content_revisions','subject_packs','style_version_meta','style_assets','setting_template_refs') ORDER BY name;
SELECT 'content_items' entity,COUNT(*) row_count FROM content_items UNION ALL SELECT 'content_revisions',COUNT(*) FROM content_revisions UNION ALL SELECT 'students',COUNT(*) FROM students UNION ALL SELECT 'lessons',COUNT(*) FROM lessons UNION ALL SELECT 'growth_reports',COUNT(*) FROM growth_reports;
