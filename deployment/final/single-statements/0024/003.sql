CREATE TRIGGER subject_version_immutable BEFORE UPDATE ON subject_pack_versions WHEN OLD.status='published' BEGIN SELECT RAISE(ABORT,'subject_version_immutable'); END;
