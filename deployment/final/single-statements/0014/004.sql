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
