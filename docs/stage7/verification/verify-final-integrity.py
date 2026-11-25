from pathlib import Path
import sqlite3,hashlib,json,subprocess
root=Path('.');base=json.loads((root/'docs/reference/stage7-implementation-baseline-sha256.json').read_text())['files'];old=[x for x in base if x['path'].startswith('migrations/')];assert len(old)==23
for x in old:assert hashlib.sha256((root/x['path']).read_bytes()).hexdigest()==x['sha256'],x['path']
db=sqlite3.connect(':memory:');db.execute('PRAGMA foreign_keys=ON');paths=sorted(root.glob('migrations/*.sql'))
for p in paths:db.executescript(p.read_text())
assert len(paths)==24;assert db.execute('PRAGMA integrity_check').fetchall()==[('ok',)];assert not db.execute('PRAGMA foreign_key_check').fetchall();files=sorted([*root.glob('dist/**/*.js'),*root.glob('backup-dist/*.js')]);assert len(files)==5
for p in files:subprocess.run(['node','--check',str(p)],check=True,capture_output=True);assert 'sourceMappingURL' not in p.read_text()
assert len([p for p in root.glob('dist/**/*') if p.is_file()])==12;assert not list(root.glob('dist/**/*.map'))
print(json.dumps({'result':'pass','migrations':24,'old_migrations_unchanged':23,'foreign_key_check':[],'integrity_check':'ok','built_js_checked':[str(p) for p in files],'dist_files':12,'frontend_hash_lock':False},ensure_ascii=False,indent=2))
