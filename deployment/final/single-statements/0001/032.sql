CREATE TRIGGER slug_alias AFTER UPDATE OF slug ON tenants WHEN OLD.slug<>NEW.slug BEGIN
 INSERT INTO tenant_slug_aliases(slug,tenant_id,expires_at) VALUES(OLD.slug,NEW.id,CAST(unixepoch('now') AS INTEGER)*1000+2592000000)
 ON CONFLICT(slug) DO UPDATE SET tenant_id=NEW.id,expires_at=excluded.expires_at;
END;
