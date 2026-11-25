CREATE TRIGGER absence_revision_delete AFTER DELETE ON tenant_settings WHEN OLD.id='absence_policies'
BEGIN INSERT INTO tenant_data_versions(tenant_id,version) VALUES(OLD.tenant_id,1) ON CONFLICT(tenant_id) DO UPDATE SET version=version+1; END;
