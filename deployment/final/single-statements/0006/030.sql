CREATE TRIGGER precision_package_transactions_insert BEFORE INSERT ON package_transactions WHEN ABS(NEW.delta*100-ROUND(NEW.delta*100))>0.0000001 BEGIN SELECT RAISE(ABORT,'quantity_precision'); END;
