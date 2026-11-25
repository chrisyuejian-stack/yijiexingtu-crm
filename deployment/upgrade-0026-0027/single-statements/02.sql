ALTER TABLE tenants ADD COLUMN gallery_storage_limit INTEGER NOT NULL DEFAULT 524288000 CHECK(gallery_storage_limit>=0);
