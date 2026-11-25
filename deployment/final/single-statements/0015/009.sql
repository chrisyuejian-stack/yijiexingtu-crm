CREATE TRIGGER tenant_disable_guard BEFORE UPDATE OF status,slug ON tenants
WHEN (NEW.status='active' AND OLD.disabled_at IS NOT NULL AND NEW.disabled_at IS NOT NULL)
  OR (EXISTS(SELECT 1 FROM tenant_purge_jobs j WHERE j.tenant_id=OLD.id)
      AND (NEW.status IS NOT OLD.status OR NEW.slug IS NOT OLD.slug))
BEGIN SELECT RAISE(ABORT,'tenant_disabled'); END;
