CREATE TRIGGER stage_packages_guard BEFORE UPDATE OF deleted_at ON student_stages
WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL
  AND EXISTS(SELECT 1 FROM packages p WHERE p.tenant_id=OLD.tenant_id AND p.stage_id=OLD.id AND p.deleted_at IS NULL)
BEGIN SELECT RAISE(ABORT,'stage_has_packages'); END;
