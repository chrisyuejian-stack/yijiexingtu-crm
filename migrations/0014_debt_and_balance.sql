-- 新账本为空。旧缴费仍按原 package_id 计算已收，保留原行及版本。
CREATE TABLE credit_debts (
  tenant_id TEXT NOT NULL, id TEXT NOT NULL,
  student_id TEXT NOT NULL, lesson_id TEXT NOT NULL, participant_id TEXT NOT NULL,
  course_type_id TEXT NOT NULL, category_id TEXT NOT NULL,
  units REAL NOT NULL CHECK(units>0 AND ABS(units*100-ROUND(units*100))<0.0000001),
  remaining_units REAL NOT NULL CHECK(remaining_units>=0 AND remaining_units<=units AND ABS(remaining_units*100-ROUND(remaining_units*100))<0.0000001),
  settled_at INTEGER,
  created_at INTEGER NOT NULL, created_by TEXT NOT NULL,
  updated_at INTEGER NOT NULL, updated_by TEXT NOT NULL,
  version INTEGER NOT NULL, deleted_at INTEGER,
  PRIMARY KEY(tenant_id,id),
  FOREIGN KEY(tenant_id,student_id) REFERENCES students(tenant_id,id),
  FOREIGN KEY(tenant_id,lesson_id) REFERENCES lessons(tenant_id,id),
  FOREIGN KEY(tenant_id,participant_id) REFERENCES lesson_participants(tenant_id,id),
  FOREIGN KEY(tenant_id,course_type_id) REFERENCES course_types(tenant_id,id),
  FOREIGN KEY(tenant_id,category_id) REFERENCES course_categories(tenant_id,id)
);
CREATE UNIQUE INDEX credit_debt_active_part ON credit_debts(tenant_id,participant_id) WHERE deleted_at IS NULL;
CREATE INDEX credit_debt_student_fifo ON credit_debts(tenant_id,student_id,created_at,id) WHERE deleted_at IS NULL AND remaining_units>0;

CREATE TABLE student_payment_resolutions (
  tenant_id TEXT NOT NULL, id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('tuition','other_income')),
  stage_id TEXT, other_category TEXT CHECK(other_category IN ('报名费','教材费','其他')),
  other_note TEXT NOT NULL,
  recognized_date TEXT,
  created_at INTEGER NOT NULL, created_by TEXT NOT NULL,
  updated_at INTEGER NOT NULL, updated_by TEXT NOT NULL,
  version INTEGER NOT NULL, deleted_at INTEGER,
  PRIMARY KEY(tenant_id,id),
  FOREIGN KEY(tenant_id,id) REFERENCES student_payments(tenant_id,id),
  FOREIGN KEY(tenant_id,student_id) REFERENCES students(tenant_id,id),
  FOREIGN KEY(tenant_id,stage_id) REFERENCES student_stages(tenant_id,id),
  CHECK((kind='other_income' AND other_category IS NOT NULL AND recognized_date IS NOT NULL)
    OR (kind='tuition' AND other_category IS NULL AND recognized_date IS NULL))
);

CREATE TABLE student_balances_ledger (
  tenant_id TEXT NOT NULL, id TEXT NOT NULL, student_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('deposit','redeem','refund','adjust')),
  amount INTEGER NOT NULL CHECK(amount<>0 AND typeof(amount)='integer'),
  payment_id TEXT, package_id TEXT,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL, created_by TEXT NOT NULL,
  updated_at INTEGER NOT NULL, updated_by TEXT NOT NULL,
  version INTEGER NOT NULL, deleted_at INTEGER,
  PRIMARY KEY(tenant_id,id),
  FOREIGN KEY(tenant_id,student_id) REFERENCES students(tenant_id,id),
  FOREIGN KEY(tenant_id,payment_id) REFERENCES student_payments(tenant_id,id),
  FOREIGN KEY(tenant_id,package_id) REFERENCES packages(tenant_id,id),
  CHECK((type='deposit' AND amount>0 AND payment_id IS NOT NULL)
    OR (type='redeem' AND amount<0 AND package_id IS NOT NULL)
    OR (type='refund' AND amount<0) OR type='adjust')
);
CREATE INDEX student_balance_student ON student_balances_ledger(tenant_id,student_id,created_at,id) WHERE deleted_at IS NULL;

CREATE TABLE student_payment_allocations (
  tenant_id TEXT NOT NULL, id TEXT NOT NULL, student_id TEXT NOT NULL,
  package_id TEXT NOT NULL, payment_id TEXT, ledger_id TEXT,
  amount INTEGER NOT NULL CHECK(amount>0 AND typeof(amount)='integer'),
  created_at INTEGER NOT NULL, created_by TEXT NOT NULL,
  updated_at INTEGER NOT NULL, updated_by TEXT NOT NULL,
  version INTEGER NOT NULL, deleted_at INTEGER,
  PRIMARY KEY(tenant_id,id),
  FOREIGN KEY(tenant_id,student_id) REFERENCES students(tenant_id,id),
  FOREIGN KEY(tenant_id,package_id) REFERENCES packages(tenant_id,id),
  FOREIGN KEY(tenant_id,payment_id) REFERENCES student_payments(tenant_id,id),
  FOREIGN KEY(tenant_id,ledger_id) REFERENCES student_balances_ledger(tenant_id,id),
  CHECK((payment_id IS NOT NULL)<>(ledger_id IS NOT NULL))
);
CREATE INDEX payment_allocation_package ON student_payment_allocations(tenant_id,package_id) WHERE deleted_at IS NULL;
CREATE INDEX payment_allocation_payment ON student_payment_allocations(tenant_id,payment_id) WHERE deleted_at IS NULL;

CREATE VIEW package_receipt_lines AS
SELECT tenant_id,student_id,package_id,amount FROM student_payments
WHERE package_id IS NOT NULL AND deleted_at IS NULL
UNION ALL
SELECT tenant_id,student_id,package_id,amount FROM student_payment_allocations WHERE deleted_at IS NULL;

CREATE VIEW pending_student_payments AS
SELECT p.* FROM student_payments p
WHERE p.package_id IS NULL AND p.deleted_at IS NULL AND NOT EXISTS (
  SELECT 1 FROM student_payment_resolutions r
  WHERE r.tenant_id=p.tenant_id AND r.id=p.id AND r.deleted_at IS NULL
);

CREATE TRIGGER credit_debt_participant_owner BEFORE INSERT ON credit_debts
WHEN NOT EXISTS (
  SELECT 1 FROM lesson_participants p
  WHERE p.tenant_id=NEW.tenant_id AND p.id=NEW.participant_id
    AND p.student_id=NEW.student_id AND p.lesson_id=NEW.lesson_id
)
BEGIN SELECT RAISE(ABORT,'credit_debt_participant_owner'); END;

CREATE TRIGGER payment_resolution_owner BEFORE INSERT ON student_payment_resolutions
WHEN NOT EXISTS (
  SELECT 1 FROM student_payments p
  WHERE p.tenant_id=NEW.tenant_id AND p.id=NEW.id AND p.student_id=NEW.student_id
) OR (NEW.stage_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM student_stages s
  WHERE s.tenant_id=NEW.tenant_id AND s.id=NEW.stage_id AND s.student_id=NEW.student_id
))
BEGIN SELECT RAISE(ABORT,'payment_resolution_owner'); END;

CREATE TRIGGER balance_ledger_owner BEFORE INSERT ON student_balances_ledger
WHEN (NEW.payment_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM student_payments p
  WHERE p.tenant_id=NEW.tenant_id AND p.id=NEW.payment_id AND p.student_id=NEW.student_id
)) OR (NEW.package_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM packages p
  WHERE p.tenant_id=NEW.tenant_id AND p.id=NEW.package_id AND p.student_id=NEW.student_id
))
BEGIN SELECT RAISE(ABORT,'balance_ledger_owner'); END;

CREATE TRIGGER payment_allocation_owner BEFORE INSERT ON student_payment_allocations
WHEN NOT EXISTS (
  SELECT 1 FROM packages p
  WHERE p.tenant_id=NEW.tenant_id AND p.id=NEW.package_id AND p.student_id=NEW.student_id
) OR (NEW.payment_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM student_payments p
  WHERE p.tenant_id=NEW.tenant_id AND p.id=NEW.payment_id AND p.student_id=NEW.student_id
)) OR (NEW.ledger_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM student_balances_ledger l
  WHERE l.tenant_id=NEW.tenant_id AND l.id=NEW.ledger_id AND l.student_id=NEW.student_id
    AND l.package_id=NEW.package_id AND l.type='redeem' AND l.amount=-NEW.amount
))
BEGIN SELECT RAISE(ABORT,'payment_allocation_owner'); END;
