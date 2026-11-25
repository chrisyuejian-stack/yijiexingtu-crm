CREATE TRIGGER plan_style_version_immutable BEFORE UPDATE ON style_pack_versions BEGIN SELECT RAISE(ABORT,'style_version_immutable'); END;
