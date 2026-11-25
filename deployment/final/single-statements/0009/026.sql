CREATE TRIGGER ledger_no_delete BEFORE DELETE ON package_transactions WHEN NOT EXISTS(SELECT 1 FROM trusted_imports WHERE tenant_id=OLD.tenant_id) BEGIN SELECT RAISE(ABORT,'append only'); END;
