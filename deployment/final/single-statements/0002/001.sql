-- 已部署第一阶段的数据库仅执行本升级；全新数据库只需 0001（已包含修正）。
DROP TRIGGER IF EXISTS tenant_revoke;
