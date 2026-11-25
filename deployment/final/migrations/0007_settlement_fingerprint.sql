-- 第四阶段复核修复：已交付的 0005/0006 保持原样。一次执行。
ALTER TABLE settlements ADD COLUMN submitted_fingerprint TEXT;
-- 同批提交的 tenant_data_versions guard 也必须保护缺勤设置读取到写入间的竞态。
-- 此版本只用于请求内乐观锁；提交与批准之间改为比较月份指纹。
CREATE TRIGGER absence_revision_insert AFTER INSERT ON tenant_settings WHEN NEW.id='absence_policies'
BEGIN INSERT INTO tenant_data_versions(tenant_id,version) VALUES(NEW.tenant_id,1) ON CONFLICT(tenant_id) DO UPDATE SET version=version+1; END;
CREATE TRIGGER absence_revision_update AFTER UPDATE OF value ON tenant_settings WHEN NEW.id='absence_policies' AND NEW.value IS NOT OLD.value
BEGIN INSERT INTO tenant_data_versions(tenant_id,version) VALUES(NEW.tenant_id,1) ON CONFLICT(tenant_id) DO UPDATE SET version=version+1; END;
CREATE TRIGGER absence_revision_delete AFTER DELETE ON tenant_settings WHEN OLD.id='absence_policies'
BEGIN INSERT INTO tenant_data_versions(tenant_id,version) VALUES(OLD.tenant_id,1) ON CONFLICT(tenant_id) DO UPDATE SET version=version+1; END;
