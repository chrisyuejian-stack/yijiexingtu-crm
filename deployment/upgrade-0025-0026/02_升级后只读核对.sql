-- 只读。升级刚完成、尚未恢复业务写入时，旧表数量应与升级前相同。
PRAGMA table_info(plan_prospects);
SELECT name,sql FROM sqlite_master WHERE type='table' AND name IN ('plans','plan_prospects') ORDER BY name;
SELECT 'plans' AS table_name,COUNT(*) AS row_count FROM plans
UNION ALL SELECT 'students',COUNT(*) FROM students
UNION ALL SELECT 'leads',COUNT(*) FROM leads
UNION ALL SELECT 'plan_contexts',COUNT(*) FROM plan_contexts
UNION ALL SELECT 'plan_revisions',COUNT(*) FROM plan_revisions
UNION ALL SELECT 'share_links',COUNT(*) FROM share_links
UNION ALL SELECT 'content_items',COUNT(*) FROM content_items
UNION ALL SELECT 'content_revisions',COUNT(*) FROM content_revisions;
SELECT COUNT(*) AS prospect_count FROM plan_prospects;
-- 以下三项正常应为 0；不要输出解密电话或整个 data_enc。
SELECT COUNT(*) AS orphan_prospects FROM plan_prospects x LEFT JOIN plans p ON p.tenant_id=x.tenant_id AND p.id=x.id WHERE p.id IS NULL;
SELECT COUNT(*) AS missing_prospect_records FROM plans p LEFT JOIN plan_prospects x ON x.tenant_id=p.tenant_id AND x.id=p.id WHERE p.source_lead_id='prospect:'||p.id AND x.id IS NULL;
SELECT COUNT(*) AS missing_party FROM plans p WHERE p.student_id IS NULL AND p.source_lead_id IS NULL;
PRAGMA foreign_key_check;
