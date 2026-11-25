-- v0.4.1 additive only. Zero bytes is unmeasured; NULL means verified missing.
ALTER TABLE gallery_images ADD COLUMN bytes INTEGER DEFAULT 0 CHECK(bytes IS NULL OR bytes>=0);
