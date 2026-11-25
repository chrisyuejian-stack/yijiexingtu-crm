# Developer-only local verification; run from project root after npm run build.
from pathlib import Path
import sqlite3,json,hashlib,subprocess
root=Path('.')
baseline=json.loads((root/'docs/reference/fusion-stage2-baseline-sha256.json').read_text())['files']
checks={}
for name,predicate in [('fusion_migrations_0001_0019',lambda p:p.startswith('migrations/')),('fusion_frontend',lambda p:p.startswith(('src/tenant/','src/console/','src/ui/','src/shared/'))),('access_mode_test',lambda p:p=='tests/access-mode.test.mjs')]:
 files=[f for f in baseline if predicate(f['path'])]
 changed=[f['path'] for f in files if hashlib.sha256((root/f['path']).read_bytes()).hexdigest()!=f['sha256']]
 assert not changed,changed
 checks[name]={'count':len(files),'changed':changed}
db=sqlite3.connect(':memory:');db.execute('PRAGMA foreign_keys=ON')
ms=sorted(root.glob('migrations/*.sql'))
for f in ms:db.executescript(f.read_text())
fk=db.execute('PRAGMA foreign_key_check').fetchall();integrity=db.execute('PRAGMA integrity_check').fetchall()
assert fk==[];assert integrity==[('ok',)]
artifacts=sorted([*root.glob('dist/**/*.js'),*root.glob('backup-dist/*.js')])
for f in artifacts:
 subprocess.run(['node','--check',str(f)],check=True,capture_output=True)
 assert 'sourceMappingURL' not in f.read_text()
assert not list(root.glob('dist/**/*.map'))
print(json.dumps({'migration_count':len(ms),'foreign_key_check':fk,'integrity_check':integrity,'baseline_checks':checks,'built_js_syntax_checked':[str(f) for f in artifacts],'source_maps':0},ensure_ascii=False,indent=2))
