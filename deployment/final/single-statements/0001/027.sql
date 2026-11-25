CREATE TRIGGER platform_audit_no_update BEFORE UPDATE ON platform_audit BEGIN SELECT RAISE(ABORT,'append only'); END;
