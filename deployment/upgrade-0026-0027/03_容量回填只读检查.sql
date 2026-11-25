-- 0表示待测；NULL表示对象已核对为不存在；used按R2实际存储字节。
SELECT t.id,t.gallery_storage_limit,COALESCE(SUM(g.bytes),0) used,COALESCE(SUM(CASE WHEN g.bytes=0 THEN 1 ELSE 0 END),0) pending FROM tenants t LEFT JOIN gallery_images g ON g.tenant_id=t.id GROUP BY t.id ORDER BY t.id;
SELECT id,at,status,detail FROM backup_runs ORDER BY at DESC LIMIT 10;
