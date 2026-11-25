ALTER TABLE sessions ADD COLUMN kind TEXT NOT NULL DEFAULT 'path' CHECK(kind IN ('root','path'));
