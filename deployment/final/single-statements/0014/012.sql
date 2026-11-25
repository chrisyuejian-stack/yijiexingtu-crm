CREATE TRIGGER credit_debt_participant_owner BEFORE INSERT ON credit_debts
WHEN NOT EXISTS (
  SELECT 1 FROM lesson_participants p
  WHERE p.tenant_id=NEW.tenant_id AND p.id=NEW.participant_id
    AND p.student_id=NEW.student_id AND p.lesson_id=NEW.lesson_id
)
BEGIN SELECT RAISE(ABORT,'credit_debt_participant_owner'); END;
