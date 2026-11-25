CREATE TRIGGER ledger_no_update BEFORE UPDATE ON package_transactions WHEN NOT EXISTS(SELECT 1 FROM trusted_imports WHERE tenant_id=NEW.tenant_id) BEGIN SELECT RAISE(ABORT,'append only'); END;
