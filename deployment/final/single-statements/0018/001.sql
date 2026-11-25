CREATE TABLE credit_income_entries (
  tenant_id TEXT NOT NULL, id TEXT NOT NULL,
  booked_on TEXT NOT NULL, amount INTEGER NOT NULL CHECK(typeof(amount)='integer'),
  unpriced_units REAL NOT NULL, source TEXT NOT NULL,
  reversed_by TEXT,
  created_at INTEGER NOT NULL, created_by TEXT NOT NULL,
  updated_at INTEGER NOT NULL, updated_by TEXT NOT NULL,
  version INTEGER NOT NULL, deleted_at INTEGER,
  PRIMARY KEY(tenant_id,id),
  FOREIGN KEY(tenant_id,id) REFERENCES package_transactions(tenant_id,id),
  FOREIGN KEY(tenant_id,reversed_by) REFERENCES package_transactions(tenant_id,id)
);
