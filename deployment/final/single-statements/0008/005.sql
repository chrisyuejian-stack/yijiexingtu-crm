CREATE TABLE submission_people (
 tenant_id TEXT NOT NULL REFERENCES tenants(id),id TEXT NOT NULL,submission_id TEXT NOT NULL,participant_id TEXT NOT NULL,student_id TEXT NOT NULL,
 attendance TEXT NOT NULL CHECK(attendance IN ('planned','attended','student_leave','no_show','teacher_leave','cancelled')),comment TEXT NOT NULL DEFAULT '',
 created_at INTEGER NOT NULL,created_by TEXT NOT NULL,updated_at INTEGER NOT NULL,updated_by TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,deleted_at INTEGER,
 PRIMARY KEY(tenant_id,id),FOREIGN KEY(tenant_id,submission_id) REFERENCES lesson_submissions(tenant_id,id),FOREIGN KEY(tenant_id,participant_id) REFERENCES lesson_participants(tenant_id,id),FOREIGN KEY(tenant_id,student_id) REFERENCES students(tenant_id,id),UNIQUE(tenant_id,submission_id,participant_id));
