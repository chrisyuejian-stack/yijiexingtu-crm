CREATE TRIGGER auth_no_delete BEFORE DELETE ON auth_log BEGIN SELECT RAISE(ABORT,'append only'); END;
