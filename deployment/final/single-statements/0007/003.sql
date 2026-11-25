CREATE TRIGGER absence_revision_update AFTER UPDATE OF value ON tenant_settings WHEN NEW.id='absence_policies' AND NEW.value IS NOT OLD.value
BEGIN INSERT INTO tenant_data_versions(tenant_id,version) VALUES(NEW.tenant_id,1) ON CONFLICT(tenant_id) DO UPDATE SET version=version+1; END;
