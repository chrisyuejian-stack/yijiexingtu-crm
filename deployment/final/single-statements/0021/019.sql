CREATE TRIGGER plan_context_immutable BEFORE UPDATE ON plan_contexts BEGIN SELECT RAISE(ABORT,'plan_context_immutable'); END;
