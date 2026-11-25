-- 只读：对象名不足以证明整份迁移已完成，应同时对照升级记录和最后成功步骤。
SELECT type,name FROM sqlite_master WHERE name IN('plans','content_items','content_revisions','ai_requests','ai_settings','ai_quota_daily','growth_reports','growth_feedback','growth_batches','subject_packs','subject_pack_versions','style_assets','style_version_meta','style_version_tenants','style_defaults','setting_template_refs','platform_ops_guards') ORDER BY name;
PRAGMA table_info('lesson_submissions');
PRAGMA table_info('lesson_comments');
