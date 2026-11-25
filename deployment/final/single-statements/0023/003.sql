-- Structured personal snapshots extend the existing submission/comment rows.
-- growth_feedback is only a repo compatibility VIEW, never a separate feedback table/workflow.
ALTER TABLE lesson_submissions ADD COLUMN personal_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(personal_json));
