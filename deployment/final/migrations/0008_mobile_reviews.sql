-- 一次执行；先运行 scripts/sql/0008_precheck.sql。无历史业务数据回写。
ALTER TABLE lessons ADD COLUMN current_submission_id TEXT;
CREATE TABLE lesson_submissions (
 tenant_id TEXT NOT NULL REFERENCES tenants(id),id TEXT NOT NULL,lesson_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('attendance','comments')),status TEXT NOT NULL CHECK(status IN ('pending','returned','confirmed','superseded')),
 public_text TEXT NOT NULL DEFAULT '',homework TEXT NOT NULL DEFAULT '',base_fingerprint TEXT NOT NULL,comment_fingerprint TEXT NOT NULL,
 submitted_by TEXT NOT NULL,submitted_at INTEGER NOT NULL,reviewed_by TEXT,reviewed_at INTEGER,reason TEXT NOT NULL DEFAULT '',
 created_at INTEGER NOT NULL,created_by TEXT NOT NULL,updated_at INTEGER NOT NULL,updated_by TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,deleted_at INTEGER,
 PRIMARY KEY(tenant_id,id),FOREIGN KEY(tenant_id,lesson_id) REFERENCES lessons(tenant_id,id));
CREATE UNIQUE INDEX one_pending_submission ON lesson_submissions(tenant_id,lesson_id) WHERE status='pending' AND deleted_at IS NULL;
CREATE INDEX submissions_month ON lesson_submissions(tenant_id,status,lesson_id);
CREATE TABLE submission_people (
 tenant_id TEXT NOT NULL REFERENCES tenants(id),id TEXT NOT NULL,submission_id TEXT NOT NULL,participant_id TEXT NOT NULL,student_id TEXT NOT NULL,
 attendance TEXT NOT NULL CHECK(attendance IN ('planned','attended','student_leave','no_show','teacher_leave','cancelled')),comment TEXT NOT NULL DEFAULT '',
 created_at INTEGER NOT NULL,created_by TEXT NOT NULL,updated_at INTEGER NOT NULL,updated_by TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,deleted_at INTEGER,
 PRIMARY KEY(tenant_id,id),FOREIGN KEY(tenant_id,submission_id) REFERENCES lesson_submissions(tenant_id,id),FOREIGN KEY(tenant_id,participant_id) REFERENCES lesson_participants(tenant_id,id),FOREIGN KEY(tenant_id,student_id) REFERENCES students(tenant_id,id),UNIQUE(tenant_id,submission_id,participant_id));
CREATE TRIGGER submission_person_reference BEFORE INSERT ON submission_people BEGIN SELECT CASE WHEN NOT EXISTS (
 SELECT 1 FROM lesson_submissions r JOIN lesson_participants p ON p.tenant_id=r.tenant_id AND p.lesson_id=r.lesson_id WHERE r.tenant_id=NEW.tenant_id AND r.id=NEW.submission_id AND p.id=NEW.participant_id AND p.student_id=NEW.student_id AND p.deleted_at IS NULL
 ) THEN RAISE(ABORT,'invalid_submission_person') END; END;
CREATE TABLE lesson_comments (
 tenant_id TEXT NOT NULL REFERENCES tenants(id),id TEXT NOT NULL,lesson_id TEXT NOT NULL,student_id TEXT,
 text TEXT NOT NULL DEFAULT '',homework TEXT NOT NULL DEFAULT '',published_by TEXT NOT NULL,
 created_at INTEGER NOT NULL,created_by TEXT NOT NULL,updated_at INTEGER NOT NULL,updated_by TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,deleted_at INTEGER,
 PRIMARY KEY(tenant_id,id),FOREIGN KEY(tenant_id,lesson_id) REFERENCES lessons(tenant_id,id),FOREIGN KEY(tenant_id,student_id) REFERENCES students(tenant_id,id));
CREATE UNIQUE INDEX one_published_comment ON lesson_comments(tenant_id,lesson_id,COALESCE(student_id,''));
CREATE TRIGGER comment_person_reference BEFORE INSERT ON lesson_comments WHEN NEW.student_id IS NOT NULL BEGIN SELECT CASE WHEN NOT EXISTS (
 SELECT 1 FROM lesson_participants p WHERE p.tenant_id=NEW.tenant_id AND p.lesson_id=NEW.lesson_id AND p.student_id=NEW.student_id AND p.deleted_at IS NULL
 ) THEN RAISE(ABORT,'invalid_comment_person') END; END;
CREATE TRIGGER lesson_submission_reference BEFORE UPDATE OF current_submission_id ON lessons WHEN NEW.current_submission_id IS NOT NULL BEGIN SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM lesson_submissions r WHERE r.tenant_id=NEW.tenant_id AND r.id=NEW.current_submission_id AND r.lesson_id=NEW.id) THEN RAISE(ABORT,'invalid_lesson_submission') END; END;
