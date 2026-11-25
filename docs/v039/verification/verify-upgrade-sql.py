from pathlib import Path
import sqlite3,json,hashlib
r=Path(__file__).resolve().parents[3];dep=r/'deployment/upgrade-0024-0025';raw=(r/'migrations/0025_article_metadata.sql').read_bytes()
assert raw==(dep/'原SQL/0025_article_metadata.sql').read_bytes()==(dep/'single-statements/01.sql').read_bytes()
text=raw.decode();assert text.count('ALTER TABLE')==1 and sqlite3.complete_statement(text);assert not any(x in text.upper() for x in ['DROP TABLE','CREATE TABLE','DELETE FROM','UPDATE CONTENT'])
db=sqlite3.connect(':memory:');db.execute('PRAGMA foreign_keys=ON')
for p in sorted((r/'migrations').glob('*.sql')):
 if int(p.name[:4])<=24:db.executescript(p.read_text())
db.executescript((dep/'01_升级前只读检查.sql').read_text());db.executescript(text)
for p in [dep/'02_升级后只读检查.sql',dep/'03_最近备份只读检查.sql']:db.executescript(p.read_text())
assert db.execute('PRAGMA quick_check').fetchall()==[('ok',)];assert not db.execute('PRAGMA foreign_key_check').fetchall()
print(json.dumps({'result':'pass','from':24,'to':25,'new_tables':0,'new_columns':['content_items.article_json'],'single_statements':1,'raw_and_step_bytes_equal':True,'migration_sha256':hashlib.sha256(raw).hexdigest(),'readonly_files_executed':3,'quick_check':'ok','foreign_key_check':[],'remote_execution':False},ensure_ascii=False,indent=2))
