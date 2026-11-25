CREATE TRIGGER growth_revision_immutable BEFORE UPDATE ON growth_report_revisions BEGIN SELECT RAISE(ABORT,'growth_revision_immutable'); END;
