ALTER TABLE course_applications ADD COLUMN paid_by TEXT REFERENCES platform_admins(id);
