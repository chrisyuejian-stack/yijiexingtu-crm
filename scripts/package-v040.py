from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
import json,hashlib,re
r=Path(__file__).resolve().parents[1];out=r.parent/'交付_v0.4.0';out.mkdir(exist_ok=True)
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
logs={}
for mode,name in [('source','npm-test.log'),('bundle','bundle-test.log')]:
 s=(r/'validation'/name).read_text()
 counts={k:int(re.search(r'ℹ '+k+r' (\d+)',s).group(1)) for k in ['tests','pass','fail','skipped']}
 assert counts=={'tests':526,'pass':526,'fail':0,'skipped':0},counts
 logs[mode]=counts
worker=r/'dist/_worker.js';backup=r/'backup-dist/backup-worker.js'
manifest={str(p.relative_to(r/'dist')):sha(p) for p in sorted((r/'dist').rglob('*')) if p.is_file()}
assert len(manifest)==12 and '_worker.js' in manifest
assert not any(k.endswith('.map') or k.startswith(('src/','tests/','migrations/')) for k in manifest)
report={'version':'0.4.0','sourceTests':logs['source'],'bundleTests':logs['bundle'],'workerSha256':sha(worker),'backupWorkerSha256':sha(backup),'migration':'0026_plan_prospects.sql (CREATE TABLE only)','newCloudflareSettings':False,'newDeepSeekSettings':False,'liveDeploymentPerformed':False,'realProviderCalled':False,'pagesFiles':manifest}
(r/'validation/验证结果.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
upload=out/'艺界星途_v0.4.0_Pages上传包_20261117.zip'
with ZipFile(upload,'w',ZIP_DEFLATED) as z:
 for n in manifest:z.write(r/'dist'/n,n)
with ZipFile(upload) as z:
 assert z.testzip() is None and set(z.namelist())==set(manifest)
 for n,h in manifest.items():assert hashlib.sha256(z.read(n)).hexdigest()==h
(out/'_worker.js').write_bytes(worker.read_bytes());(out/'backup-worker.js').write_bytes(backup.read_bytes())
(out/'交付说明_v0.4.0.md').write_bytes((r/'交付说明_v0.4.0.md').read_bytes())
migration=out/'艺界星途_v0.4.0_0026增量迁移及只读核对.zip'
with ZipFile(migration,'w',ZIP_DEFLATED) as z:
 for p in sorted((r/'deployment/upgrade-0025-0026').glob('*')):
  if p.is_file():z.write(p,p.name)
checks=[(sha(worker),'dist/_worker.js'),(sha(backup),'backup-dist/backup-worker.js'),(sha(upload),upload.name),(sha(migration),migration.name)]
(r/'SHA256SUMS.txt').write_text(''.join(h+'  '+n+'\n' for h,n in checks))
source=out/'艺界星途_v0.4.0_完整源码_20261117.zip'
with ZipFile(source,'w',ZIP_DEFLATED) as z:
 for p in sorted(r.rglob('*')):
  rel=p.relative_to(r)
  if p.is_file() and not any(n in {'.git','node_modules','__pycache__','.DS_Store'} for n in rel.parts):z.write(p,str(rel))
with ZipFile(source) as z:
 assert z.testzip() is None
 assert hashlib.sha256(z.read('dist/_worker.js')).hexdigest()==sha(worker)
 assert hashlib.sha256(z.read('backup-dist/backup-worker.js')).hexdigest()==sha(backup)
(out/'SHA256SUMS.txt').write_text((r/'SHA256SUMS.txt').read_text()+sha(source)+'  '+source.name+'\n')
print(json.dumps({'workerSha256':sha(worker),'files':{p.name:p.stat().st_size for p in out.iterdir() if p.is_file()}},ensure_ascii=False,indent=2))
