CREATE TRIGGER identity_phone_revoke AFTER UPDATE OF phone_hmac ON users WHEN NEW.phone_hmac IS NOT OLD.phone_hmac BEGIN
 DELETE FROM sessions WHERE tenant_id=NEW.tenant_id AND user_id=NEW.id;
 DELETE FROM login_choices WHERE tenant_id=NEW.tenant_id AND user_id=NEW.id;
END;
