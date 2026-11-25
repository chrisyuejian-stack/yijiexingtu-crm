CREATE TRIGGER snapshot_no_delete BEFORE DELETE ON payroll_snapshots WHEN NOT EXISTS(SELECT 1 FROM trusted_imports WHERE tenant_id=OLD.tenant_id) BEGIN SELECT RAISE(ABORT,'append only'); END;
