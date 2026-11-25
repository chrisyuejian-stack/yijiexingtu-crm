-- 同批提交的 tenant_data_versions guard 也必须保护缺勤设置读取到写入间的竞态。
-- 此版本只用于请求内乐观锁；提交与批准之间改为比较月份指纹。
CREATE TRIGGER absence_revision_insert AFTER INSERT ON tenant_settings WHEN NEW.id='absence_policies'
BEGIN INSERT INTO tenant_data_versions(tenant_id,version) VALUES(NEW.tenant_id,1) ON CONFLICT(tenant_id) DO UPDATE SET version=version+1; END;
