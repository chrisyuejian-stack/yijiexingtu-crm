CREATE TRIGGER ledger_no_update BEFORE UPDATE ON package_transactions BEGIN SELECT RAISE(ABORT,'append only'); END;
