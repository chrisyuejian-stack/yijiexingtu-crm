-- 只读。先看现有对象，不能据单个对象存在就认定整份迁移完成。
SELECT type,name FROM sqlite_master WHERE name IN('tenants','plans','lesson_submissions','lesson_comments','content_items','content_revisions','ai_settings','ai_quota_daily','ai_requests','ai_quota_holds','ai_usage','growth_repertoire','growth_feedback_copies','growth_batches','growth_reports','growth_report_revisions','growth_notifications','growth_feedback') ORDER BY name;
PRAGMA table_info('lesson_submissions');
PRAGMA table_info('lesson_comments');
