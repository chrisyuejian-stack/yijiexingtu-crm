CREATE TRIGGER ledger_no_delete BEFORE DELETE ON package_transactions BEGIN SELECT RAISE(ABORT,'append only'); END;
