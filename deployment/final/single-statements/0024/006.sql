CREATE TRIGGER style_meta_immutable BEFORE UPDATE ON style_version_meta WHEN OLD.status='published' BEGIN SELECT RAISE(ABORT,'style_meta_immutable'); END;
