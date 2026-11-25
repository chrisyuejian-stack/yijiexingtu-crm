CREATE TRIGGER ai_usage_immutable BEFORE UPDATE ON ai_usage BEGIN SELECT RAISE(ABORT,'ai_usage_immutable'); END;
