-- 对象计数为0，foreign_key_check无结果。配额异常仅列明细人工确认，不自动删除。
SELECT COUNT(*) existing_objects FROM sqlite_master WHERE name IN('promo_image_cleanup','promo_image_pending_limit','promo_image_ready_insert_limit','promo_image_ready_update_limit');
SELECT tenant_id,SUM(ready=1) completed_count,SUM(CASE WHEN ready=1 THEN bytes ELSE 0 END) completed_bytes,SUM(ready=0) pending_count FROM promo_images WHERE tenant_id<>'platform' GROUP BY tenant_id HAVING SUM(ready=1)>50 OR SUM(CASE WHEN ready=1 THEN bytes ELSE 0 END)>104857600 OR SUM(ready=0)>5;
PRAGMA foreign_key_check;
