-- 只读。article_json: TEXT，notnull=1，默认JSON文本'null'。
PRAGMA table_info('content_items');
SELECT COUNT(*) invalid_article_json FROM content_items WHERE article_json IS NULL OR json_valid(article_json)=0;
SELECT 'content_items' entity,COUNT(*) row_count FROM content_items UNION ALL SELECT 'content_revisions',COUNT(*) FROM content_revisions UNION ALL SELECT 'students',COUNT(*) FROM students UNION ALL SELECT 'lessons',COUNT(*) FROM lessons UNION ALL SELECT 'growth_reports',COUNT(*) FROM growth_reports;
PRAGMA quick_check;
PRAGMA foreign_key_check;
