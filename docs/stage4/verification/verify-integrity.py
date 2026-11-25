# Local developer verification. Frontend hashes are not locked by this check.
from pathlib import Path
import sqlite3,json,hashlib,subprocess
root=Path('.')
base=json.loads((root/'docs/reference/stage4-start-baseline-sha256.json').read_text())['files']
old=[f for f in base if f['path'].startswith('migrations/')]
assert len(old)==20
changed=[f['path'] for f in old if hashlib.sha256((root/f['path']).read_bytes()).hexdigest()!=f['sha256']]
assert not changed,changed
db=sqlite3.connect(':memory:');db.execute('PRAGMA foreign_keys=ON')
ms=sorted(root.glob('migrations/*.sql'))
for file in ms:db.executescript(file.read_text())
fk=db.execute('PRAGMA foreign_key_check').fetchall();integrity=db.execute('PRAGMA integrity_check').fetchall();assert not fk;assert integrity==[('ok',)]
artifacts=sorted([*root.glob('dist/**/*.js'),*root.glob('backup-dist/*.js')])
for file in artifacts:
 subprocess.run(['node','--check',str(file)],check=True,capture_output=True)
 assert 'sourceMappingURL' not in file.read_text()
assert not list(root.glob('dist/**/*.map'))
print(json.dumps({'result':'pass','migration_count':len(ms),'old_migrations_unchanged':20,'foreign_key_check':fk,'integrity_check':integrity,'built_js_syntax_checked':[str(f) for f in artifacts],'source_maps':0,'frontend_hash_lock':False},ensure_ascii=False,indent=2))
