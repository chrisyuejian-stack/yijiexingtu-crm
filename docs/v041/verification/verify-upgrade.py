from pathlib import Path
import sqlite3,hashlib,json
r=Path(__file__).resolve().parents[3];d=r/'deployment/upgrade-0026-0027';d.mkdir(parents=True,exist_ok=True)
sql=(r/'migrations/0027_gallery_storage.sql').read_bytes();(d/'0027_gallery_storage.sql').write_bytes(sql);(d/'single-statements').mkdir(exist_ok=True)
buffer='';steps=[]
for c in sql.decode():
 buffer+=c
 if c==';' and sqlite3.complete_statement(buffer):steps.append(buffer.strip()+'\n');buffer=''
assert not buffer.strip();assert len(steps)==2
for i,s in enumerate(steps,1):(d/'single-statements'/f'{i:02}.sql').write_text(s)
(d/'01_升级前只读检查.sql').write_text("-- 只读，确认完整0026。新列不存在才执行对应ADD COLUMN。\nPRAGMA table_info('gallery_images');\nPRAGMA table_info('tenants');\nSELECT 'tenants' entity,COUNT(*) n FROM tenants UNION ALL SELECT 'gallery_images',COUNT(*) FROM gallery_images UNION ALL SELECT 'plans',COUNT(*) FROM plans UNION ALL SELECT 'students',COUNT(*) FROM students UNION ALL SELECT 'lessons',COUNT(*) FROM lessons;\n")
(d/'02_升级后只读检查.sql').write_text("-- 两新列存在，业务行数不变，quick_check=ok，foreign_key_check无结果。\nPRAGMA table_info('gallery_images');\nPRAGMA table_info('tenants');\nSELECT 'tenants' entity,COUNT(*) n FROM tenants UNION ALL SELECT 'gallery_images',COUNT(*) FROM gallery_images UNION ALL SELECT 'plans',COUNT(*) FROM plans UNION ALL SELECT 'students',COUNT(*) FROM students UNION ALL SELECT 'lessons',COUNT(*) FROM lessons;\nSELECT COUNT(*) invalid_limit FROM tenants WHERE gallery_storage_limit<0;\nSELECT COUNT(*) invalid_bytes FROM gallery_images WHERE bytes<0;\nPRAGMA quick_check;\nPRAGMA foreign_key_check;\n")
(d/'03_容量回填只读检查.sql').write_text("-- 0表示待测；NULL表示对象已核对为不存在；used按R2实际存储字节。\nSELECT t.id,t.gallery_storage_limit,COALESCE(SUM(g.bytes),0) used,COALESCE(SUM(CASE WHEN g.bytes=0 THEN 1 ELSE 0 END),0) pending FROM tenants t LEFT JOIN gallery_images g ON g.tenant_id=t.id GROUP BY t.id ORDER BY t.id;\nSELECT id,at,status,detail FROM backup_runs ORDER BY at DESC LIMIT 10;\n")
a=sqlite3.connect(':memory:');b=sqlite3.connect(':memory:')
for db in [a,b]:
 db.execute('PRAGMA foreign_keys=ON')
 for p in sorted((r/'migrations').glob('*.sql')):
  if int(p.name[:4])<=26:db.executescript(p.read_text())
 db.executescript((d/'01_升级前只读检查.sql').read_text())
a.executescript(sql.decode())
for s in steps:b.execute(s)
schema=lambda db:db.execute("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").fetchall()
assert schema(a)==schema(b)
for db in [a,b]:
 for name in ['02_升级后只读检查.sql','03_容量回填只读检查.sql']:db.executescript((d/name).read_text())
 assert db.execute('PRAGMA quick_check').fetchall()==[('ok',)];assert not db.execute('PRAGMA foreign_key_check').fetchall()
manifest={'from':26,'to':27,'new_tables':0,'columns':['gallery_images.bytes','tenants.gallery_storage_limit'],'steps':[{'file':f'single-statements/{i:02}.sql','sha256':hashlib.sha256(s.encode()).hexdigest()} for i,s in enumerate(steps,1)],'raw_sha256':hashlib.sha256(sql).hexdigest(),'real_backfill_executed':False};(d/'步骤清单.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'result':'pass','migrations_total':27,'incremental_complete_statements':2,'whole_and_split_schema_equal':True,'readonly_files_executed':3,'new_tables':0,'new_columns':manifest['columns'],'quick_check':'ok','foreign_key_check':[],'remote_execution':False},ensure_ascii=False,indent=2))
