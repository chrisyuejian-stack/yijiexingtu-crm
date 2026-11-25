-- v0.4.1 additive only. Zero bytes is unmeasured; NULL means verified missing.
ALTER TABLE gallery_images ADD COLUMN bytes INTEGER DEFAULT 0 CHECK(bytes IS NULL OR bytes>=0);
ALTER TABLE tenants ADD COLUMN gallery_storage_limit INTEGER NOT NULL DEFAULT 524288000 CHECK(gallery_storage_limit>=0);
