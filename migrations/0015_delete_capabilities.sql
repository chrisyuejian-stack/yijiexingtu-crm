ALTER TABLE tenants ADD COLUMN disabled_at INTEGER;
ALTER TABLE tenants ADD COLUMN disabled_by TEXT;
ALTER TABLE tenants ADD COLUMN disabled_reason TEXT;
ALTER TABLE platform_announcements ADD COLUMN withdrawn_at INTEGER;
ALTER TABLE platform_announcements ADD COLUMN withdrawn_by TEXT;
ALTER TABLE platform_announcements ADD COLUMN withdrawal_reason TEXT;

CREATE TABLE tenant_export_runs (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
  id TEXT NOT NULL UNIQUE,
  admin_id TEXT NOT NULL,
  tenant_version INTEGER NOT NULL,
  data_version INTEGER NOT NULL,
  table_index INTEGER NOT NULL DEFAULT 0,
  next_offset INTEGER NOT NULL DEFAULT 0,
  completed_at INTEGER
);

CREATE TABLE tenant_purge_jobs (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
  id TEXT NOT NULL UNIQUE,
  admin_id TEXT NOT NULL,
  tenant_name TEXT NOT NULL,
  reason TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  ip TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  phase INTEGER NOT NULL DEFAULT -1,
  counts TEXT NOT NULL DEFAULT '{}'
);

CREATE TRIGGER tenant_disable_guard BEFORE UPDATE OF status,slug ON tenants
WHEN (NEW.status='active' AND OLD.disabled_at IS NOT NULL AND NEW.disabled_at IS NOT NULL)
  OR (EXISTS(SELECT 1 FROM tenant_purge_jobs j WHERE j.tenant_id=OLD.id)
      AND (NEW.status IS NOT OLD.status OR NEW.slug IS NOT OLD.slug))
BEGIN SELECT RAISE(ABORT,'tenant_disabled'); END;

CREATE TRIGGER stage_packages_guard BEFORE UPDATE OF deleted_at ON student_stages
WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL
  AND EXISTS(SELECT 1 FROM packages p WHERE p.tenant_id=OLD.tenant_id AND p.stage_id=OLD.id AND p.deleted_at IS NULL)
BEGIN SELECT RAISE(ABORT,'stage_has_packages'); END;

DROP TRIGGER audit_no_delete;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_log
WHEN NOT EXISTS(SELECT 1 FROM tenant_purge_jobs j WHERE j.tenant_id=OLD.tenant_id)
BEGIN SELECT RAISE(ABORT,'append only'); END;

DROP TRIGGER auth_no_delete;
CREATE TRIGGER auth_no_delete BEFORE DELETE ON auth_log
WHEN NOT EXISTS(SELECT 1 FROM tenant_purge_jobs j WHERE j.tenant_id=OLD.tenant_id)
BEGIN SELECT RAISE(ABORT,'append only'); END;

DROP TRIGGER platform_audit_no_delete;
CREATE TRIGGER platform_audit_no_delete BEFORE DELETE ON platform_audit
WHEN NOT EXISTS(SELECT 1 FROM tenant_purge_jobs j WHERE j.tenant_id=OLD.tenant_id)
BEGIN SELECT RAISE(ABORT,'append only'); END;

-- A request that was already in flight must not recreate tenant records
-- after the final scan on tables that have no tenant foreign key.
CREATE TRIGGER purged_auth_insert_guard BEFORE INSERT ON auth_log
WHEN NEW.tenant_id GLOB 'ten_*'
  AND NOT EXISTS(SELECT 1 FROM tenants WHERE id=NEW.tenant_id)
BEGIN SELECT RAISE(ABORT,'tenant_disabled'); END;

CREATE TRIGGER purged_audit_insert_guard BEFORE INSERT ON audit_log
WHEN NEW.tenant_id GLOB 'ten_*'
  AND NOT EXISTS(SELECT 1 FROM tenants WHERE id=NEW.tenant_id)
BEGIN SELECT RAISE(ABORT,'tenant_disabled'); END;

CREATE TRIGGER purged_platform_audit_insert_guard BEFORE INSERT ON platform_audit
WHEN NEW.action<>'purge_tenant' AND NEW.tenant_id GLOB 'ten_*'
  AND NOT EXISTS(SELECT 1 FROM tenants WHERE id=NEW.tenant_id)
BEGIN SELECT RAISE(ABORT,'tenant_disabled'); END;

CREATE TRIGGER purged_promo_image_insert_guard BEFORE INSERT ON promo_images
WHEN NEW.tenant_id GLOB 'ten_*' AND (
  NOT EXISTS(SELECT 1 FROM tenants WHERE id=NEW.tenant_id)
  OR EXISTS(SELECT 1 FROM tenant_purge_jobs WHERE tenant_id=NEW.tenant_id)
)
BEGIN SELECT RAISE(ABORT,'tenant_disabled'); END;

CREATE TRIGGER purged_security_limit_insert_guard BEFORE INSERT ON security_limits
WHEN (NEW.key GLOB 'login:ten_*' OR NEW.key GLOB 'read:ten_*'
   OR NEW.key GLOB 'request:ten_*' OR NEW.key GLOB 'city:ten_*')
  AND NOT EXISTS(
    SELECT 1 FROM tenants WHERE id=substr(NEW.key,instr(NEW.key,':')+1,28)
  )
BEGIN SELECT RAISE(ABORT,'tenant_disabled'); END;
