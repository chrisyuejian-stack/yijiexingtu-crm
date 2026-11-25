CREATE TABLE mutation_guards(tenant_id TEXT NOT NULL,id TEXT NOT NULL,expected INTEGER NOT NULL,actual INTEGER NOT NULL,CHECK(expected=actual),PRIMARY KEY(tenant_id,id));
