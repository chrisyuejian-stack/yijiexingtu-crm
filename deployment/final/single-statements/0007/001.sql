-- 第四阶段复核修复：已交付的 0005/0006 保持原样。一次执行。
ALTER TABLE settlements ADD COLUMN submitted_fingerprint TEXT;
