ALTER TABLE users ADD COLUMN disabled_reason TEXT CHECK(disabled_reason IS NULL OR disabled_reason IN ('manual','no_children'));
