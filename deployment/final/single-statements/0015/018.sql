CREATE TRIGGER purged_audit_insert_guard BEFORE INSERT ON audit_log
WHEN NEW.tenant_id GLOB 'ten_*'
  AND NOT EXISTS(SELECT 1 FROM tenants WHERE id=NEW.tenant_id)
BEGIN SELECT RAISE(ABORT,'tenant_disabled'); END;
