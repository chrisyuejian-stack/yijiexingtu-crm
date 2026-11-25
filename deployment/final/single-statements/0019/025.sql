CREATE TRIGGER identity_password_choice AFTER UPDATE OF digest ON users BEGIN
 DELETE FROM login_choices WHERE tenant_id=NEW.tenant_id AND user_id=NEW.id;
END;
