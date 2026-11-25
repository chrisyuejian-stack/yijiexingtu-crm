CREATE TRIGGER identity_user_insert AFTER INSERT ON users BEGIN
 INSERT INTO platform_phone_index(tenant_id,user_id,phone_hmac_platform)
 SELECT NEW.tenant_id,NEW.id,NEW.platform_phone_hmac WHERE NEW.platform_phone_hmac IS NOT NULL AND NEW.active=1 AND NEW.deleted_at IS NULL
 AND EXISTS(SELECT 1 FROM tenants WHERE id=NEW.tenant_id AND status='active' AND deleted_at IS NULL)
 AND EXISTS(SELECT 1 FROM json_each(NEW.roles) WHERE value IN ('supervisor','consultant','academic','finance'));
END;
