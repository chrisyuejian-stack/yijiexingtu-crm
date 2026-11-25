CREATE TRIGGER user_revoke AFTER UPDATE OF digest,roles,active ON users BEGIN DELETE FROM sessions WHERE tenant_id=NEW.tenant_id AND user_id=NEW.id; END;
