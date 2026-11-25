-- 只读：missing_object应无结果；两列新增字段见PRAGMA；quick_check为ok；foreign_key_check无结果。
WITH expected(type,name) AS(VALUES
('index','ai_live_holds'),
('index','ai_pending_user'),
('index','ai_request_retention'),
('index','ai_usage_stats'),
('index','content_author'),
('index','content_list'),
('index','growth_publication_order'),
('index','growth_repertoire_student'),
('index','growth_report_student'),
('table','ai_quota_daily'),
('table','ai_quota_holds'),
('table','ai_requests'),
('table','ai_settings'),
('table','ai_suggestions'),
('table','ai_usage'),
('table','content_items'),
('table','content_revisions'),
('table','growth_batches'),
('table','growth_feedback_copies'),
('table','growth_notifications'),
('table','growth_repertoire'),
('table','growth_report_revisions'),
('table','growth_reports'),
('trigger','ai_usage_immutable'),
('trigger','content_revision_immutable'),
('trigger','growth_feedback_insert'),
('trigger','growth_feedback_update'),
('trigger','growth_revision_immutable'),
('trigger','plan_style_version_immutable'),
('view','growth_feedback')) SELECT e.type,e.name missing_object FROM expected e LEFT JOIN sqlite_master s ON s.type=e.type AND s.name=e.name WHERE s.name IS NULL;
PRAGMA table_info('lesson_submissions');
PRAGMA table_info('lesson_comments');
PRAGMA quick_check;
PRAGMA foreign_key_check;
