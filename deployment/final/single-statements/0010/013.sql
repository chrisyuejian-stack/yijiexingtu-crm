ALTER TABLE lessons ADD COLUMN source_course_id TEXT REFERENCES partner_courses(id);
