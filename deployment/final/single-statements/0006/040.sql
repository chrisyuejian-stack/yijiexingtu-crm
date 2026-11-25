CREATE TRIGGER snapshot_no_update BEFORE UPDATE ON payroll_snapshots BEGIN SELECT RAISE(ABORT,'append only'); END;
