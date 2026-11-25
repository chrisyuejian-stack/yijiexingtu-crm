CREATE TRIGGER guardian_last_child AFTER UPDATE OF revoked_at ON guardian_links WHEN OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL BEGIN
 UPDATE users SET active=0,disabled_reason='no_children',version=version+1,updated_at=NEW.updated_at,updated_by=NEW.updated_by
 WHERE tenant_id=NEW.tenant_id AND id=NEW.parent_user_id AND active=1
 AND NOT EXISTS(SELECT 1 FROM guardian_links WHERE tenant_id=NEW.tenant_id AND parent_user_id=NEW.parent_user_id AND revoked_at IS NULL);
END;
