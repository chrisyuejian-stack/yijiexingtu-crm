ALTER TABLE students ADD COLUMN parent_consent_media INTEGER NOT NULL DEFAULT 0 CHECK(parent_consent_media IN (0,1));
