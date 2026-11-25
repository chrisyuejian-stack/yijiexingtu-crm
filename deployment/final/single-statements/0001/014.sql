-- IP 限流跨机构生效，属于平台安全数据，不保存明文手机号。
CREATE TABLE security_limits(key TEXT PRIMARY KEY,count INTEGER NOT NULL,window_start INTEGER NOT NULL,locked_until INTEGER NOT NULL DEFAULT 0);
