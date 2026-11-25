CREATE TRIGGER snapshot_no_delete BEFORE DELETE ON payroll_snapshots BEGIN SELECT RAISE(ABORT,'append only'); END;
