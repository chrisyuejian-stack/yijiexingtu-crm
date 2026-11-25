ALTER TABLE lessons ADD COLUMN source_session_id TEXT REFERENCES partner_sessions(id);
