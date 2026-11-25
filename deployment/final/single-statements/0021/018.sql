CREATE TRIGGER plan_revision_immutable BEFORE UPDATE ON plan_revisions BEGIN SELECT RAISE(ABORT,'plan_revision_immutable'); END;
