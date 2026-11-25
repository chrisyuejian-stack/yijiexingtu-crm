CREATE TRIGGER plan_v2_element_identity BEFORE UPDATE ON plan_v2_elements BEGIN SELECT RAISE(ABORT,'plan_v2_element_immutable'); END;
