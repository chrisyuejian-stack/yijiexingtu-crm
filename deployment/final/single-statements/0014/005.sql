CREATE TABLE student_balances_ledger (
  tenant_id TEXT NOT NULL, id TEXT NOT NULL, student_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('deposit','redeem','refund','adjust')),
  amount INTEGER NOT NULL CHECK(amount<>0 AND typeof(amount)='integer'),
  payment_id TEXT, package_id TEXT,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL, created_by TEXT NOT NULL,
  updated_at INTEGER NOT NULL, updated_by TEXT NOT NULL,
  version INTEGER NOT NULL, deleted_at INTEGER,
  PRIMARY KEY(tenant_id,id),
  FOREIGN KEY(tenant_id,student_id) REFERENCES students(tenant_id,id),
  FOREIGN KEY(tenant_id,payment_id) REFERENCES student_payments(tenant_id,id),
  FOREIGN KEY(tenant_id,package_id) REFERENCES packages(tenant_id,id),
  CHECK((type='deposit' AND amount>0 AND payment_id IS NOT NULL)
    OR (type='redeem' AND amount<0 AND package_id IS NOT NULL)
    OR (type='refund' AND amount<0) OR type='adjust')
);
