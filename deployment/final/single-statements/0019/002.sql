CREATE TRIGGER tenant_revoke AFTER UPDATE OF slug ON tenants
WHEN OLD.slug IS NOT NEW.slug BEGIN DELETE FROM sessions WHERE tenant_id=NEW.id; END;
