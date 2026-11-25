ALTER TABLE platform_admins ADD COLUMN role TEXT NOT NULL DEFAULT 'owner' CHECK(role IN ('owner','consultant'));
