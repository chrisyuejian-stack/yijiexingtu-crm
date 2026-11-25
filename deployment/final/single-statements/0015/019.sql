CREATE TRIGGER purged_platform_audit_insert_guard BEFORE INSERT ON platform_audit
WHEN NEW.action<>'purge_tenant' AND NEW.tenant_id GLOB 'ten_*'
  AND NOT EXISTS(SELECT 1 FROM tenants WHERE id=NEW.tenant_id)
BEGIN SELECT RAISE(ABORT,'tenant_disabled'); END;
