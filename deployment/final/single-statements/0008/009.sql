CREATE TRIGGER comment_person_reference BEFORE INSERT ON lesson_comments WHEN NEW.student_id IS NOT NULL BEGIN SELECT CASE WHEN NOT EXISTS (
 SELECT 1 FROM lesson_participants p WHERE p.tenant_id=NEW.tenant_id AND p.lesson_id=NEW.lesson_id AND p.student_id=NEW.student_id AND p.deleted_at IS NULL
 ) THEN RAISE(ABORT,'invalid_comment_person') END; END;
