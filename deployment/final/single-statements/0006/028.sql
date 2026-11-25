CREATE TRIGGER precision_packages_insert BEFORE INSERT ON packages WHEN ABS(NEW.units_total*100-ROUND(NEW.units_total*100))>0.0000001 BEGIN SELECT RAISE(ABORT,'quantity_precision'); END;
