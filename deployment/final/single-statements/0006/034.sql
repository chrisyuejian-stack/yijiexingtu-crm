CREATE TRIGGER precision_schedule_templates_insert BEFORE INSERT ON schedule_templates WHEN ABS(NEW.units*100-ROUND(NEW.units*100))>0.0000001 BEGIN SELECT RAISE(ABORT,'quantity_precision'); END;
