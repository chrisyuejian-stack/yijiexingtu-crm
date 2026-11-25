-- 清除历史可委派账号权限；can() 仍会硬拒绝这些授权，即使绕过此迁移重新写入。
DELETE FROM tenant_role_rights WHERE module='accounts';
