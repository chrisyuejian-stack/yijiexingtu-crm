CREATE TRIGGER content_revision_immutable BEFORE UPDATE ON content_revisions BEGIN SELECT RAISE(ABORT,'content_revision_immutable'); END;
