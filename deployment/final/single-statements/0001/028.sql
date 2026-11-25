CREATE TRIGGER platform_audit_no_delete BEFORE DELETE ON platform_audit BEGIN SELECT RAISE(ABORT,'append only'); END;
