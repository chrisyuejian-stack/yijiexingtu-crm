CREATE TRIGGER identity_tenant_index AFTER UPDATE OF status,deleted_at ON tenants BEGIN
 DELETE FROM platform_phone_index WHERE tenant_id=NEW.id;
 INSERT INTO platform_phone_index(tenant_id,user_id,phone_hmac_platform)
 SELECT tenant_id,id,platform_phone_hmac FROM users WHERE tenant_id=NEW.id AND active=1 AND deleted_at IS NULL AND platform_phone_hmac IS NOT NULL
 AND NEW.status='active' AND NEW.deleted_at IS NULL
 AND EXISTS(SELECT 1 FROM json_each(users.roles) WHERE value IN ('supervisor','consultant','academic','finance'));
 DELETE FROM login_choices WHERE tenant_id=NEW.id;
END;
