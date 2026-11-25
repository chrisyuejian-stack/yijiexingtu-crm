-- 已部署第一阶段的数据库仅执行本升级；全新数据库只需 0001（已包含修正）。
DROP TRIGGER IF EXISTS tenant_revoke;
CREATE TRIGGER tenant_revoke AFTER UPDATE OF slug,status,expires_at ON tenants
WHEN OLD.slug IS NOT NEW.slug OR OLD.status IS NOT NEW.status OR OLD.expires_at IS NOT NEW.expires_at
BEGIN DELETE FROM sessions WHERE tenant_id=NEW.id; END;
-- 清除历史可委派账号权限；can() 仍会硬拒绝这些授权，即使绕过此迁移重新写入。
DELETE FROM tenant_role_rights WHERE module='accounts';
-- 升级时所有机构会话失效，要求重新认证。
DELETE FROM sessions;
