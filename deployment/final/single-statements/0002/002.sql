CREATE TRIGGER tenant_revoke AFTER UPDATE OF slug,status,expires_at ON tenants
WHEN OLD.slug IS NOT NEW.slug OR OLD.status IS NOT NEW.status OR OLD.expires_at IS NOT NEW.expires_at
BEGIN DELETE FROM sessions WHERE tenant_id=NEW.id; END;
