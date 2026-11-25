CREATE TRIGGER guardian_capacity BEFORE INSERT ON guardian_links WHEN NEW.revoked_at IS NULL BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM users WHERE tenant_id=NEW.tenant_id AND id=NEW.parent_user_id AND roles='["parent"]' AND deleted_at IS NULL)
 THEN RAISE(ABORT,'guardian_parent_invalid') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM students WHERE tenant_id=NEW.tenant_id AND id=NEW.student_id AND deleted_at IS NULL)
 THEN RAISE(ABORT,'guardian_student_invalid') END;
 SELECT CASE WHEN (SELECT COUNT(*) FROM guardian_links WHERE tenant_id=NEW.tenant_id AND student_id=NEW.student_id AND revoked_at IS NULL)>=4
 OR (SELECT COUNT(*) FROM guardian_links WHERE tenant_id=NEW.tenant_id AND parent_user_id=NEW.parent_user_id AND revoked_at IS NULL)>=10
 THEN RAISE(ABORT,'guardian_limit') END;
END;
