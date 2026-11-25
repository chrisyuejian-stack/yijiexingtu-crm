-- 艺界星途阶段2；0001–0018保持原样。在全新/已完成0018的数据库执行一次。
DROP TRIGGER IF EXISTS tenant_revoke;
CREATE TRIGGER tenant_revoke AFTER UPDATE OF slug ON tenants
WHEN OLD.slug IS NOT NEW.slug BEGIN DELETE FROM sessions WHERE tenant_id=NEW.id; END;

ALTER TABLE users ADD COLUMN platform_phone_hmac TEXT;
ALTER TABLE users ADD COLUMN disabled_reason TEXT CHECK(disabled_reason IS NULL OR disabled_reason IN ('manual','no_children'));
ALTER TABLE sessions ADD COLUMN kind TEXT NOT NULL DEFAULT 'path' CHECK(kind IN ('root','path'));
CREATE UNIQUE INDEX identity_session_hash ON sessions(token_hash);
ALTER TABLE students ADD COLUMN report_class_id TEXT;
ALTER TABLE students ADD COLUMN source_lead_id TEXT;
ALTER TABLE students ADD COLUMN nickname TEXT NOT NULL DEFAULT 'X 同学';
ALTER TABLE students ADD COLUMN parent_consent_media INTEGER NOT NULL DEFAULT 0 CHECK(parent_consent_media IN (0,1));

CREATE TABLE platform_phone_index (
 tenant_id TEXT NOT NULL REFERENCES tenants(id),user_id TEXT NOT NULL,phone_hmac_platform TEXT NOT NULL,
 PRIMARY KEY(tenant_id,user_id),FOREIGN KEY(tenant_id,user_id) REFERENCES users(tenant_id,id)
);
CREATE INDEX platform_phone_lookup ON platform_phone_index(phone_hmac_platform,tenant_id,user_id);
CREATE INDEX identity_login_history ON auth_log(tenant_id,user_id,event,at);
CREATE TABLE login_choices (
 tenant_id TEXT NOT NULL REFERENCES tenants(id),id TEXT NOT NULL,token_hash TEXT NOT NULL UNIQUE,
 user_id TEXT NOT NULL,user_version INTEGER NOT NULL,tenant_version INTEGER NOT NULL,
 group_id TEXT NOT NULL,expires_at INTEGER NOT NULL,created_at INTEGER NOT NULL,
 PRIMARY KEY(tenant_id,id),FOREIGN KEY(tenant_id,user_id) REFERENCES users(tenant_id,id)
);
CREATE INDEX login_choices_expiry ON login_choices(expires_at);
CREATE TABLE guardian_links (
 tenant_id TEXT NOT NULL REFERENCES tenants(id),id TEXT NOT NULL,parent_user_id TEXT NOT NULL,student_id TEXT NOT NULL,
 relation TEXT NOT NULL CHECK(relation IN ('mother','father','grandparent','other')),
 created_by TEXT NOT NULL,created_at INTEGER NOT NULL,updated_by TEXT NOT NULL,updated_at INTEGER NOT NULL,
 version INTEGER NOT NULL DEFAULT 1,revoked_at INTEGER,
 PRIMARY KEY(tenant_id,id),FOREIGN KEY(tenant_id,parent_user_id) REFERENCES users(tenant_id,id),
 FOREIGN KEY(tenant_id,student_id) REFERENCES students(tenant_id,id)
);
CREATE UNIQUE INDEX guardian_pair_active ON guardian_links(tenant_id,parent_user_id,student_id) WHERE revoked_at IS NULL;
CREATE INDEX guardian_student ON guardian_links(tenant_id,student_id,revoked_at);
CREATE TABLE tenant_subjects (
 tenant_id TEXT NOT NULL REFERENCES tenants(id),id TEXT NOT NULL,pack_version TEXT NOT NULL DEFAULT '0.1',
 created_at INTEGER NOT NULL,created_by TEXT NOT NULL,PRIMARY KEY(tenant_id,id)
);
CREATE TABLE tenant_ai_overrides (
 tenant_id TEXT NOT NULL REFERENCES tenants(id),id TEXT NOT NULL DEFAULT 'limits',fast_daily_limit INTEGER,deep_daily_limit INTEGER,
 PRIMARY KEY(tenant_id,id),CHECK(fast_daily_limit IS NULL OR fast_daily_limit>=0),CHECK(deep_daily_limit IS NULL OR deep_daily_limit>=0)
);

CREATE TRIGGER identity_user_insert AFTER INSERT ON users BEGIN
 INSERT INTO platform_phone_index(tenant_id,user_id,phone_hmac_platform)
 SELECT NEW.tenant_id,NEW.id,NEW.platform_phone_hmac WHERE NEW.platform_phone_hmac IS NOT NULL AND NEW.active=1 AND NEW.deleted_at IS NULL
 AND EXISTS(SELECT 1 FROM tenants WHERE id=NEW.tenant_id AND status='active' AND deleted_at IS NULL)
 AND EXISTS(SELECT 1 FROM json_each(NEW.roles) WHERE value IN ('supervisor','consultant','academic','finance'));
END;
CREATE TRIGGER identity_user_update AFTER UPDATE OF platform_phone_hmac,roles,active,deleted_at ON users BEGIN
 DELETE FROM platform_phone_index WHERE tenant_id=NEW.tenant_id AND user_id=NEW.id;
 INSERT INTO platform_phone_index(tenant_id,user_id,phone_hmac_platform)
 SELECT NEW.tenant_id,NEW.id,NEW.platform_phone_hmac WHERE NEW.platform_phone_hmac IS NOT NULL AND NEW.active=1 AND NEW.deleted_at IS NULL
 AND EXISTS(SELECT 1 FROM tenants WHERE id=NEW.tenant_id AND status='active' AND deleted_at IS NULL)
 AND EXISTS(SELECT 1 FROM json_each(NEW.roles) WHERE value IN ('supervisor','consultant','academic','finance'));
 DELETE FROM login_choices WHERE tenant_id=NEW.tenant_id AND user_id=NEW.id;
END;
CREATE TRIGGER identity_tenant_index AFTER UPDATE OF status,deleted_at ON tenants BEGIN
 DELETE FROM platform_phone_index WHERE tenant_id=NEW.id;
 INSERT INTO platform_phone_index(tenant_id,user_id,phone_hmac_platform)
 SELECT tenant_id,id,platform_phone_hmac FROM users WHERE tenant_id=NEW.id AND active=1 AND deleted_at IS NULL AND platform_phone_hmac IS NOT NULL
 AND NEW.status='active' AND NEW.deleted_at IS NULL
 AND EXISTS(SELECT 1 FROM json_each(users.roles) WHERE value IN ('supervisor','consultant','academic','finance'));
 DELETE FROM login_choices WHERE tenant_id=NEW.id;
END;
CREATE TRIGGER identity_phone_revoke AFTER UPDATE OF phone_hmac ON users WHEN NEW.phone_hmac IS NOT OLD.phone_hmac BEGIN
 DELETE FROM sessions WHERE tenant_id=NEW.tenant_id AND user_id=NEW.id;
 DELETE FROM login_choices WHERE tenant_id=NEW.tenant_id AND user_id=NEW.id;
END;
CREATE TRIGGER identity_password_choice AFTER UPDATE OF digest ON users BEGIN
 DELETE FROM login_choices WHERE tenant_id=NEW.tenant_id AND user_id=NEW.id;
END;

CREATE TRIGGER guardian_capacity BEFORE INSERT ON guardian_links WHEN NEW.revoked_at IS NULL BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM users WHERE tenant_id=NEW.tenant_id AND id=NEW.parent_user_id AND roles='["parent"]' AND deleted_at IS NULL)
 THEN RAISE(ABORT,'guardian_parent_invalid') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM students WHERE tenant_id=NEW.tenant_id AND id=NEW.student_id AND deleted_at IS NULL)
 THEN RAISE(ABORT,'guardian_student_invalid') END;
 SELECT CASE WHEN (SELECT COUNT(*) FROM guardian_links WHERE tenant_id=NEW.tenant_id AND student_id=NEW.student_id AND revoked_at IS NULL)>=4
 OR (SELECT COUNT(*) FROM guardian_links WHERE tenant_id=NEW.tenant_id AND parent_user_id=NEW.parent_user_id AND revoked_at IS NULL)>=10
 THEN RAISE(ABORT,'guardian_limit') END;
END;
CREATE TRIGGER guardian_last_child AFTER UPDATE OF revoked_at ON guardian_links WHEN OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL BEGIN
 UPDATE users SET active=0,disabled_reason='no_children',version=version+1,updated_at=NEW.updated_at,updated_by=NEW.updated_by
 WHERE tenant_id=NEW.tenant_id AND id=NEW.parent_user_id AND active=1
 AND NOT EXISTS(SELECT 1 FROM guardian_links WHERE tenant_id=NEW.tenant_id AND parent_user_id=NEW.parent_user_id AND revoked_at IS NULL);
END;
-- 教师、家长不占管理席位；学生账号仍沿用旧独立上限。
CREATE TRIGGER identity_staff_insert BEFORE INSERT ON users WHEN NEW.active=1 AND NEW.deleted_at IS NULL
 AND EXISTS(SELECT 1 FROM json_each(NEW.roles) WHERE value IN ('supervisor','consultant','academic','finance')) BEGIN
 SELECT CASE WHEN (SELECT COUNT(*) FROM users WHERE tenant_id=NEW.tenant_id AND active=1 AND deleted_at IS NULL
 AND EXISTS(SELECT 1 FROM json_each(users.roles) WHERE value IN ('supervisor','consultant','academic','finance')))>=(SELECT staff_seat_limit FROM tenants WHERE id=NEW.tenant_id)
 THEN RAISE(ABORT,'staff_seat_limit') END;
END;
CREATE TRIGGER identity_staff_update BEFORE UPDATE OF active,roles ON users WHEN NEW.active=1 AND NEW.deleted_at IS NULL
 AND EXISTS(SELECT 1 FROM json_each(NEW.roles) WHERE value IN ('supervisor','consultant','academic','finance')) BEGIN
 SELECT CASE WHEN (SELECT COUNT(*) FROM users WHERE tenant_id=NEW.tenant_id AND id<>NEW.id AND active=1 AND deleted_at IS NULL
 AND EXISTS(SELECT 1 FROM json_each(users.roles) WHERE value IN ('supervisor','consultant','academic','finance')))>=(SELECT staff_seat_limit FROM tenants WHERE id=NEW.tenant_id)
 THEN RAISE(ABORT,'staff_seat_limit') END;
END;
INSERT INTO tenant_modules(tenant_id,id,enabled,created_at,created_by,updated_at,updated_by)
 SELECT t.id,j.value,CASE WHEN j.value='school_db' THEN 0 ELSE 1 END,t.updated_at,'system',t.updated_at,'system'
 FROM tenants t CROSS JOIN json_each('["content","plans","growth_reports","school_db","prices","feedback","parents","ai","usage"]') j;
