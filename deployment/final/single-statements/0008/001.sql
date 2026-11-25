-- 一次执行；先运行 scripts/sql/0008_precheck.sql。无历史业务数据回写。
ALTER TABLE lessons ADD COLUMN current_submission_id TEXT;
