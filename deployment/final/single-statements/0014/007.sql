CREATE TABLE student_payment_allocations (
  tenant_id TEXT NOT NULL, id TEXT NOT NULL, student_id TEXT NOT NULL,
  package_id TEXT NOT NULL, payment_id TEXT, ledger_id TEXT,
  amount INTEGER NOT NULL CHECK(amount>0 AND typeof(amount)='integer'),
  created_at INTEGER NOT NULL, created_by TEXT NOT NULL,
  updated_at INTEGER NOT NULL, updated_by TEXT NOT NULL,
  version INTEGER NOT NULL, deleted_at INTEGER,
  PRIMARY KEY(tenant_id,id),
  FOREIGN KEY(tenant_id,student_id) REFERENCES students(tenant_id,id),
  FOREIGN KEY(tenant_id,package_id) REFERENCES packages(tenant_id,id),
  FOREIGN KEY(tenant_id,payment_id) REFERENCES student_payments(tenant_id,id),
  FOREIGN KEY(tenant_id,ledger_id) REFERENCES student_balances_ledger(tenant_id,id),
  CHECK((payment_id IS NOT NULL)<>(ledger_id IS NOT NULL))
);
