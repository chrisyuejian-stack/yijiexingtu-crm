-- Stage7 append-only platform management, immutable versions and tenant template mappings.
CREATE TABLE subject_packs(key TEXT PRIMARY KEY,name TEXT NOT NULL,current_published_version TEXT,created_at INTEGER NOT NULL);
