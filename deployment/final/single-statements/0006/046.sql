CREATE TRIGGER course_limits_lessons_insert BEFORE INSERT ON lessons WHEN (NEW.units<1 OR NEW.duration NOT IN (30,45,60)) BEGIN SELECT RAISE(ABORT,'course_duration_or_units'); END;
