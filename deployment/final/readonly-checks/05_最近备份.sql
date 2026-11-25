-- 只读；按实际列名展示最近备份日志，查找成功记录并与备份桶manifest.enc对应。
SELECT id,at,status,detail FROM backup_runs ORDER BY at DESC LIMIT 10;
