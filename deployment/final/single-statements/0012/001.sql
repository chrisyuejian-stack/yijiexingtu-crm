ALTER TABLE teachers ADD COLUMN show_in_timetable INTEGER NOT NULL DEFAULT 1 CHECK(show_in_timetable IN (0,1));
