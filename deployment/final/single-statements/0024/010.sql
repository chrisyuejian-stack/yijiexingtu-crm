CREATE TABLE style_defaults(doc_type TEXT PRIMARY KEY,pack_id TEXT NOT NULL REFERENCES style_packs(id));
