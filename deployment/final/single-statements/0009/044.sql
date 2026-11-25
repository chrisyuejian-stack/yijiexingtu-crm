CREATE UNIQUE INDEX one_running_backup ON backup_snapshots(status) WHERE status='running';
