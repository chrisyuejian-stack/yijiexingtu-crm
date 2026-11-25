ALTER TABLE lesson_comments ADD COLUMN feedback_versions_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(feedback_versions_json));
