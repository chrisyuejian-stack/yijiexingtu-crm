-- 新排课程限定时长与最低课时；已有历史记录在未改动这些字段时保留原值。
CREATE TRIGGER course_limits_course_types_insert BEFORE INSERT ON course_types WHEN (NEW.units_per_lesson<1 OR NEW.default_minutes NOT IN (30,45,60)) BEGIN SELECT RAISE(ABORT,'course_duration_or_units'); END;
