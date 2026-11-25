ALTER TABLE teachers ADD COLUMN show_in_timetable INTEGER NOT NULL DEFAULT 1 CHECK(show_in_timetable IN (0,1));

CREATE TABLE renewal_reminders (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  course_type_id TEXT NOT NULL,
  scope_kind TEXT NOT NULL CHECK(scope_kind IN ('type','category')),
  scope_id TEXT NOT NULL,
  package_ids_json TEXT NOT NULL CHECK(json_valid(package_ids_json) AND json_type(package_ids_json)='array'),
  channel TEXT NOT NULL CHECK(channel IN ('image','text')),
  sent_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  deleted_at INTEGER,
  PRIMARY KEY(tenant_id,id),
  FOREIGN KEY(tenant_id,student_id) REFERENCES students(tenant_id,id),
  FOREIGN KEY(tenant_id,course_type_id) REFERENCES course_types(tenant_id,id)
);
CREATE INDEX renewal_reminders_scope ON renewal_reminders(tenant_id,student_id,scope_kind,scope_id,sent_at) WHERE deleted_at IS NULL;
