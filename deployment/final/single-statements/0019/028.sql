-- 教师、家长不占管理席位；学生账号仍沿用旧独立上限。
CREATE TRIGGER identity_staff_insert BEFORE INSERT ON users WHEN NEW.active=1 AND NEW.deleted_at IS NULL
 AND EXISTS(SELECT 1 FROM json_each(NEW.roles) WHERE value IN ('supervisor','consultant','academic','finance')) BEGIN
 SELECT CASE WHEN (SELECT COUNT(*) FROM users WHERE tenant_id=NEW.tenant_id AND active=1 AND deleted_at IS NULL
 AND EXISTS(SELECT 1 FROM json_each(users.roles) WHERE value IN ('supervisor','consultant','academic','finance')))>=(SELECT staff_seat_limit FROM tenants WHERE id=NEW.tenant_id)
 THEN RAISE(ABORT,'staff_seat_limit') END;
END;
