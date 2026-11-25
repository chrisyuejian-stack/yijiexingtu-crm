CREATE TABLE tenants (
 id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE COLLATE NOCASE,
 name TEXT NOT NULL, type TEXT NOT NULL DEFAULT '其他', city TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL CHECK(status IN ('active','paused')), expires_at TEXT,
 staff_seat_limit INTEGER NOT NULL CHECK(staff_seat_limit>=1), student_seat_limit INTEGER NOT NULL CHECK(student_seat_limit>=0),
 contact_enc TEXT, created_at INTEGER NOT NULL, created_by TEXT NOT NULL, updated_at INTEGER NOT NULL, updated_by TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1, deleted_at INTEGER
);
