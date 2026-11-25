CREATE TABLE platform_ops_guards(id TEXT PRIMARY KEY,expected INTEGER NOT NULL,actual INTEGER NOT NULL,CHECK(expected=actual));
