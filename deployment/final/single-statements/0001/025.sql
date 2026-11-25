CREATE TRIGGER auth_no_update BEFORE UPDATE ON auth_log BEGIN SELECT RAISE(ABORT,'append only'); END;
