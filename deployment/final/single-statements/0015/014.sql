CREATE TRIGGER auth_no_delete BEFORE DELETE ON auth_log
WHEN NOT EXISTS(SELECT 1 FROM tenant_purge_jobs j WHERE j.tenant_id=OLD.tenant_id)
BEGIN SELECT RAISE(ABORT,'append only'); END;
