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

CREATE INDEX credit_income_month ON credit_income_entries(tenant_id,booked_on) WHERE deleted_at IS NULL;
CREATE INDEX credit_income_reversal ON credit_income_entries(tenant_id,reversed_by) WHERE reversed_by IS NOT NULL;
CREATE INDEX credit_txn_participant_package ON package_transactions(tenant_id,participant_id,package_id) WHERE participant_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX lesson_occurrence_range ON lessons(tenant_id,occurrence_date,template_id) WHERE template_id IS NOT NULL AND deleted_at IS NULL;

CREATE VIEW credit_income_legacy_estimates AS
SELECT x.tenant_id,x.id,x.date AS booked_on,
  CASE WHEN s.billing_mode='overall' OR p.unit_price IS NULL THEN 0
    ELSE CASE WHEN x.delta>0 THEN -1 ELSE 1 END *
      ((CAST(ROUND(ABS(x.delta)*100) AS INTEGER)*p.unit_price+50)/100) END AS amount,
  CASE WHEN s.billing_mode<>'overall' AND p.unit_price IS NULL THEN -x.delta ELSE 0 END AS unpriced_units,
  CASE WHEN s.billing_mode='overall' THEN 'legacy_overall'
    WHEN p.unit_price IS NULL THEN 'legacy_no_price' ELSE 'legacy_estimate' END AS source,
  NULL AS reversed_by,x.created_at,x.created_by,x.updated_at,x.updated_by,1 AS version,NULL AS deleted_at
FROM package_transactions x
JOIN packages p ON p.tenant_id=x.tenant_id AND p.id=x.package_id
JOIN students s ON s.tenant_id=x.tenant_id AND s.id=x.student_id
WHERE x.deleted_at IS NULL AND x.type IN ('consume','reversal');

INSERT INTO credit_income_entries(tenant_id,id,booked_on,amount,unpriced_units,source,reversed_by,created_at,created_by,updated_at,updated_by,version,deleted_at)
SELECT e.* FROM credit_income_legacy_estimates e;

CREATE TRIGGER credit_income_consume AFTER INSERT ON package_transactions
WHEN NEW.type='consume' AND NEW.deleted_at IS NULL
 AND NOT EXISTS(SELECT 1 FROM trusted_imports WHERE tenant_id=NEW.tenant_id)
BEGIN
  INSERT INTO credit_income_entries(tenant_id,id,booked_on,amount,unpriced_units,source,created_at,created_by,updated_at,updated_by,version)
  SELECT NEW.tenant_id,NEW.id,NEW.date,
    CASE WHEN p.unit_price IS NULL THEN 0 ELSE (CAST(ROUND(-NEW.delta*100) AS INTEGER)*p.unit_price+50)/100 END,
    CASE WHEN p.unit_price IS NULL THEN -NEW.delta ELSE 0 END,
    CASE WHEN p.unit_price IS NULL THEN 'unpriced' WHEN NEW.note='补扣欠课时' THEN 'debt_repayment' ELSE 'checkout' END,
    NEW.created_at,NEW.created_by,NEW.updated_at,NEW.updated_by,1
  FROM packages p WHERE p.tenant_id=NEW.tenant_id AND p.id=NEW.package_id;
END;

CREATE TRIGGER credit_income_reverse AFTER INSERT ON package_transactions
WHEN NEW.type='reversal' AND NEW.deleted_at IS NULL
 AND NOT EXISTS(SELECT 1 FROM trusted_imports WHERE tenant_id=NEW.tenant_id)
BEGIN
  UPDATE credit_income_entries SET reversed_by=NEW.id,updated_at=NEW.updated_at,updated_by=NEW.updated_by,version=version+1
  WHERE tenant_id=NEW.tenant_id AND reversed_by IS NULL AND deleted_at IS NULL AND id IN (
    SELECT x.id FROM package_transactions x WHERE x.tenant_id=NEW.tenant_id AND x.participant_id=NEW.participant_id
      AND x.package_id=NEW.package_id AND x.deleted_at IS NULL AND x.id<>NEW.id
  );
  INSERT INTO credit_income_entries(tenant_id,id,booked_on,amount,unpriced_units,source,reversed_by,created_at,created_by,updated_at,updated_by,version)
  SELECT NEW.tenant_id,NEW.id,NEW.date,-COALESCE(SUM(e.amount),0),ROUND(-COALESCE(SUM(e.unpriced_units),0),2),
    'reversal',NEW.id,NEW.created_at,NEW.created_by,NEW.updated_at,NEW.updated_by,1
  FROM credit_income_entries e WHERE e.tenant_id=NEW.tenant_id AND e.reversed_by=NEW.id AND e.deleted_at IS NULL;
END;

CREATE TRIGGER credit_income_price_completion AFTER UPDATE OF unit_price ON packages
WHEN OLD.unit_price IS NULL AND NEW.unit_price IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM trusted_imports WHERE tenant_id=NEW.tenant_id)
 AND EXISTS(
   SELECT 1 FROM credit_income_entries e JOIN package_transactions x ON x.tenant_id=e.tenant_id AND x.id=e.id
   WHERE e.tenant_id=NEW.tenant_id AND x.package_id=NEW.id AND e.reversed_by IS NULL AND e.unpriced_units<>0 AND e.deleted_at IS NULL
 )
BEGIN
  SELECT RAISE(ABORT,'credit_price_locked') WHERE EXISTS(
    SELECT 1 FROM settlements WHERE tenant_id=NEW.tenant_id AND month=substr(date(NEW.updated_at/1000,'unixepoch','+8 hours'),1,7)
      AND locked=1 AND deleted_at IS NULL
  );
  UPDATE credit_income_entries
    SET amount=CASE WHEN unpriced_units<0 THEN -1 ELSE 1 END *
      ((CAST(ROUND(ABS(unpriced_units)*100) AS INTEGER)*NEW.unit_price+50)/100),
      unpriced_units=0,booked_on=date(NEW.updated_at/1000,'unixepoch','+8 hours'),source='price_completion',
      updated_at=NEW.updated_at,updated_by=NEW.updated_by,version=version+1
    WHERE tenant_id=NEW.tenant_id AND reversed_by IS NULL AND unpriced_units<>0 AND deleted_at IS NULL
      AND id IN (SELECT id FROM package_transactions WHERE tenant_id=NEW.tenant_id AND package_id=NEW.id);
  INSERT INTO audit_log(tenant_id,id,at,actor_id,actor_label,module,action,entity_id,summary,before_json,after_json,money_version)
  VALUES(NEW.tenant_id,'aud_'||lower(hex(randomblob(12))),NEW.updated_at,NEW.updated_by,
    COALESCE((SELECT name FROM users WHERE tenant_id=NEW.tenant_id AND id=NEW.updated_by),'系统维护'),
    'tuition','price_completion',NEW.id,'补录课时单价并确认收入 '||changes()||' 笔',NULL,
    json_object('unit_price',NEW.unit_price,'booked_on',date(NEW.updated_at/1000,'unixepoch','+8 hours')),1);
END;

CREATE TRIGGER stage_has_payment_resolution BEFORE UPDATE OF deleted_at ON student_stages
WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL AND EXISTS(
  SELECT 1 FROM student_payment_resolutions r JOIN student_payments p ON p.tenant_id=r.tenant_id AND p.id=r.id
  WHERE r.tenant_id=NEW.tenant_id AND r.stage_id=NEW.id AND r.deleted_at IS NULL AND p.deleted_at IS NULL
)
BEGIN SELECT RAISE(ABORT,'stage_has_payment_resolution'); END;
