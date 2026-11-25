ALTER TABLE partner_courses ADD COLUMN format TEXT NOT NULL DEFAULT 'course' CHECK(format IN ('course','lecture'));
