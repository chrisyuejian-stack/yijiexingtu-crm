-- 第四阶段：在 0005 之后执行一次。所有金额列均为整数分。
ALTER TABLE lessons ADD COLUMN format TEXT NOT NULL DEFAULT 'individual';
