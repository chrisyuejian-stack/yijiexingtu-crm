CREATE TRIGGER precision_lessons_insert BEFORE INSERT ON lessons WHEN ABS(NEW.units*100-ROUND(NEW.units*100))>0.0000001 BEGIN SELECT RAISE(ABORT,'quantity_precision'); END;
