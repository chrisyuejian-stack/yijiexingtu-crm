CREATE TRIGGER plan_v2_conversion_identity BEFORE UPDATE ON plan_v2_conversions BEGIN SELECT RAISE(ABORT,'plan_v2_conversion_immutable'); END;
