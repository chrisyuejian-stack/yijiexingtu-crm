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
