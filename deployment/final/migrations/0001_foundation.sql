PRAGMA foreign_keys = ON;
CREATE TABLE tenants (
 id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE COLLATE NOCASE,
 name TEXT NOT NULL, type TEXT NOT NULL DEFAULT '其他', city TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL CHECK(status IN ('active','paused')), expires_at TEXT,
 staff_seat_limit INTEGER NOT NULL CHECK(staff_seat_limit>=1), student_seat_limit INTEGER NOT NULL CHECK(student_seat_limit>=0),
 contact_enc TEXT, created_at INTEGER NOT NULL, created_by TEXT NOT NULL, updated_at INTEGER NOT NULL, updated_by TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1, deleted_at INTEGER
);
CREATE TABLE tenant_slug_aliases (slug TEXT PRIMARY KEY COLLATE NOCASE,tenant_id TEXT NOT NULL REFERENCES tenants(id),expires_at INTEGER NOT NULL);
CREATE INDEX aliases_tenant ON tenant_slug_aliases(tenant_id,expires_at);
CREATE TABLE tenant_domains (domain TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id),kind TEXT NOT NULL,verified INTEGER NOT NULL DEFAULT 0);
CREATE INDEX domains_tenant ON tenant_domains(tenant_id,verified);
CREATE TABLE tenant_branding (
 tenant_id TEXT NOT NULL REFERENCES tenants(id), id TEXT NOT NULL DEFAULT 'brand', display_name TEXT NOT NULL, logo TEXT, login_bg TEXT,
 theme_color TEXT NOT NULL DEFAULT '#2B4C7E',welcome_text TEXT NOT NULL DEFAULT '',consultant_qr TEXT,
 created_at INTEGER NOT NULL,created_by TEXT NOT NULL,updated_at INTEGER NOT NULL,updated_by TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,deleted_at INTEGER,
 PRIMARY KEY(tenant_id,id)
);
CREATE TABLE tenant_modules(tenant_id TEXT NOT NULL REFERENCES tenants(id),id TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,
 created_at INTEGER NOT NULL,created_by TEXT NOT NULL,updated_at INTEGER NOT NULL,updated_by TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,deleted_at INTEGER,PRIMARY KEY(tenant_id,id));
CREATE TABLE tenant_settings(tenant_id TEXT NOT NULL REFERENCES tenants(id),id TEXT NOT NULL,value TEXT NOT NULL,
 created_at INTEGER NOT NULL,created_by TEXT NOT NULL,updated_at INTEGER NOT NULL,updated_by TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,deleted_at INTEGER,PRIMARY KEY(tenant_id,id));
CREATE TABLE tenant_role_rights(tenant_id TEXT NOT NULL REFERENCES tenants(id),id TEXT NOT NULL,role TEXT NOT NULL,module TEXT NOT NULL,action TEXT NOT NULL,allowed INTEGER NOT NULL,
 created_at INTEGER NOT NULL,created_by TEXT NOT NULL,updated_at INTEGER NOT NULL,updated_by TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,deleted_at INTEGER,PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,role,module,action));
CREATE TABLE users (
 tenant_id TEXT NOT NULL REFERENCES tenants(id), id TEXT NOT NULL,phone_hmac TEXT NOT NULL,phone_enc TEXT NOT NULL,phone_last4 TEXT NOT NULL,name TEXT NOT NULL,
 roles TEXT NOT NULL,teacher_id TEXT,student_id TEXT,salt TEXT NOT NULL,digest TEXT NOT NULL,iterations INTEGER NOT NULL DEFAULT 100000,
 must_change INTEGER NOT NULL DEFAULT 1,active INTEGER NOT NULL DEFAULT 1,
 created_at INTEGER NOT NULL,created_by TEXT NOT NULL,updated_at INTEGER NOT NULL,updated_by TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,deleted_at INTEGER,
 PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,phone_hmac)
);
CREATE TABLE sessions (
 tenant_id TEXT NOT NULL,id TEXT NOT NULL,token_hash TEXT NOT NULL,user_id TEXT NOT NULL,expires_at INTEGER NOT NULL,last_seen_at INTEGER NOT NULL,idle_ms INTEGER,
 ip TEXT NOT NULL,ua TEXT NOT NULL,created_at INTEGER NOT NULL,created_by TEXT NOT NULL,updated_at INTEGER NOT NULL,updated_by TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,deleted_at INTEGER,
 PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,token_hash),FOREIGN KEY(tenant_id,user_id) REFERENCES users(tenant_id,id)
);
CREATE INDEX sessions_user ON sessions(tenant_id,user_id);
-- IP 限流跨机构生效，属于平台安全数据，不保存明文手机号。
CREATE TABLE security_limits(key TEXT PRIMARY KEY,count INTEGER NOT NULL,window_start INTEGER NOT NULL,locked_until INTEGER NOT NULL DEFAULT 0);
CREATE TABLE auth_log (
 tenant_id TEXT NOT NULL,id TEXT NOT NULL,at INTEGER NOT NULL,user_id TEXT,phone_last4 TEXT,event TEXT NOT NULL,ip TEXT NOT NULL,ua TEXT NOT NULL,
 PRIMARY KEY(tenant_id,id)
);
CREATE INDEX auth_log_at ON auth_log(tenant_id,at);
CREATE TABLE audit_log (
 tenant_id TEXT NOT NULL,id TEXT NOT NULL,at INTEGER NOT NULL,actor_id TEXT NOT NULL,actor_label TEXT NOT NULL,module TEXT NOT NULL,action TEXT NOT NULL,
 entity_id TEXT,summary TEXT NOT NULL,before_json TEXT,after_json TEXT,PRIMARY KEY(tenant_id,id)
);
CREATE INDEX audit_log_at ON audit_log(tenant_id,at);
CREATE TABLE platform_admins(id TEXT PRIMARY KEY,username TEXT NOT NULL UNIQUE,salt TEXT NOT NULL,digest TEXT NOT NULL,totp_enc TEXT NOT NULL,last_totp_step INTEGER NOT NULL DEFAULT -1,active INTEGER NOT NULL DEFAULT 1,created_at INTEGER NOT NULL);
CREATE TABLE platform_sessions(token_hash TEXT PRIMARY KEY,admin_id TEXT NOT NULL REFERENCES platform_admins(id),expires_at INTEGER NOT NULL,last_seen_at INTEGER NOT NULL,ip TEXT NOT NULL,ua TEXT NOT NULL);
CREATE TABLE platform_audit(id TEXT PRIMARY KEY,at INTEGER NOT NULL,admin_id TEXT NOT NULL,action TEXT NOT NULL,tenant_id TEXT,target TEXT,detail TEXT NOT NULL,reason TEXT,ip TEXT NOT NULL);
CREATE TABLE platform_state(id TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT,'append only'); END;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT,'append only'); END;
CREATE TRIGGER auth_no_update BEFORE UPDATE ON auth_log BEGIN SELECT RAISE(ABORT,'append only'); END;
CREATE TRIGGER auth_no_delete BEFORE DELETE ON auth_log BEGIN SELECT RAISE(ABORT,'append only'); END;
CREATE TRIGGER platform_audit_no_update BEFORE UPDATE ON platform_audit BEGIN SELECT RAISE(ABORT,'append only'); END;
CREATE TRIGGER platform_audit_no_delete BEFORE DELETE ON platform_audit BEGIN SELECT RAISE(ABORT,'append only'); END;
CREATE TRIGGER setup_permanent AFTER INSERT ON platform_admins BEGIN INSERT OR IGNORE INTO platform_state(id,value) VALUES('initialized','1'); END;
CREATE TRIGGER user_revoke AFTER UPDATE OF digest,roles,active ON users BEGIN DELETE FROM sessions WHERE tenant_id=NEW.tenant_id AND user_id=NEW.id; END;
CREATE TRIGGER tenant_revoke AFTER UPDATE OF slug,status,expires_at ON tenants WHEN OLD.slug IS NOT NEW.slug OR OLD.status IS NOT NEW.status OR OLD.expires_at IS NOT NEW.expires_at BEGIN DELETE FROM sessions WHERE tenant_id=NEW.id; END;
CREATE TRIGGER slug_alias AFTER UPDATE OF slug ON tenants WHEN OLD.slug<>NEW.slug BEGIN
 INSERT INTO tenant_slug_aliases(slug,tenant_id,expires_at) VALUES(OLD.slug,NEW.id,CAST(unixepoch('now') AS INTEGER)*1000+2592000000)
 ON CONFLICT(slug) DO UPDATE SET tenant_id=NEW.id,expires_at=excluded.expires_at;
END;
CREATE TRIGGER slug_reserve_insert BEFORE INSERT ON tenants WHEN EXISTS(SELECT 1 FROM tenant_slug_aliases WHERE slug=NEW.slug AND expires_at>CAST(unixepoch('now') AS INTEGER)*1000) BEGIN SELECT RAISE(ABORT,'slug_reserved'); END;
CREATE TRIGGER slug_reserve_update BEFORE UPDATE OF slug ON tenants WHEN OLD.slug<>NEW.slug AND EXISTS(SELECT 1 FROM tenant_slug_aliases WHERE slug=NEW.slug AND expires_at>CAST(unixepoch('now') AS INTEGER)*1000) BEGIN SELECT RAISE(ABORT,'slug_reserved'); END;
