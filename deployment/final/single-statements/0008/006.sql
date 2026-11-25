CREATE TRIGGER submission_person_reference BEFORE INSERT ON submission_people BEGIN SELECT CASE WHEN NOT EXISTS (
 SELECT 1 FROM lesson_submissions r JOIN lesson_participants p ON p.tenant_id=r.tenant_id AND p.lesson_id=r.lesson_id WHERE r.tenant_id=NEW.tenant_id AND r.id=NEW.submission_id AND p.id=NEW.participant_id AND p.student_id=NEW.student_id AND p.deleted_at IS NULL
 ) THEN RAISE(ABORT,'invalid_submission_person') END; END;
