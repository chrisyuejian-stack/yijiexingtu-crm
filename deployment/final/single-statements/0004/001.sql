-- 第三阶段：在已完成 0003 的 CHANNEL_DB 中执行一次。
ALTER TABLE students ADD COLUMN billing_mode TEXT NOT NULL DEFAULT 'package';
