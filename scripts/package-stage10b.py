from pathlib import Path
from zipfile import ZipFile,ZipInfo,ZIP_DEFLATED
import hashlib,json,shutil,gzip
r=Path(__file__).resolve().parent.parent;o=r/'outputs/第十阶段B';o.mkdir(parents=True,exist_ok=True)
def files(p):return sorted(x for x in p.rglob('*') if x.is_file() and '__pycache__' not in x.parts)
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def zipto(dest,entries):
 with ZipFile(dest,'w',ZIP_DEFLATED,compresslevel=9) as z:
  for p,n in sorted(entries,key=lambda x:x[1]):
   i=ZipInfo(n,(2026,11,4,0,0,0));i.compress_type=ZIP_DEFLATED;i.external_attr=0o100644<<16;z.writestr(i,p.read_bytes())
source=[(p,p.relative_to(r).as_posix()) for folder in ['src','scripts','tests','migrations','docs','tools','dev'] for p in files(r/folder)]+[(r/n,n)for n in ['README.md','package.json']]
current={n:p.read_bytes()for p,n in source}
with ZipFile(r/'outputs/第十阶段A/第十阶段A源码.zip') as z:
 prior={n:z.read(n)for n in z.namelist()if not n.startswith('验收结果/')}
 protected=[n for n in prior if n.startswith(('src/server/','src/console/','migrations/'))]
 for n in protected:assert prior[n]==current[n],n
 changes={'modified':sorted(n for n in prior if n in current and prior[n]!=current[n]),'added':sorted(n for n in current if n not in prior),'removed':sorted(n for n in prior if n not in current)}
(o/'修改文件清单.json').write_text(json.dumps(changes,ensure_ascii=False,indent=2)+'\n')
zipto(o/'Pages最终上传包.zip',[(p,p.relative_to(r/'dist').as_posix())for p in files(r/'dist')]);assert len(files(r/'dist'))==11
with ZipFile(r/'outputs/第十阶段A/Pages最终上传包.zip') as z:
 assert z.read('_worker.js')==(r/'dist/_worker.js').read_bytes()
 footprint={n:{'before':len(z.read(n)),'after':len((r/'dist'/n).read_bytes()),'before_gzip':len(gzip.compress(z.read(n),mtime=0)),'after_gzip':len(gzip.compress((r/'dist'/n).read_bytes(),mtime=0))}for n in ['assets/tenant.js','assets/tenant.css']}
assert sha(r/'backup-dist/backup-worker.js')==sha(r/'outputs/第九阶段小改动三/backup-worker.js')
report=r/'work/reports/stage10b';
assert json.loads((report/'browser.json').read_text())['failed']==0, '浏览器回归尚未全部通过'
for n in ['source.txt','bundle.txt','artifact-source.txt','artifact-bundle.txt']:
 assert 'ℹ pass 132' in (report/n).read_text() and 'ℹ fail 0' in (report/n).read_text(), n
mapping={'source.txt':'源码测试结果.txt','bundle.txt':'打包测试结果.txt','build.txt':'构建输出.txt','browser-release.txt':'浏览器测试结果.txt','browser.json':'浏览器结果.json','roles.txt':'角色测试结果.txt','roles.json':'角色结果.json','query-source.json':'全部接口查询预算.json','query-bundle.json':'打包接口查询预算.json','calendar-performance.json':'calendar-performance.json'}
for n in ['artifact-source.txt','artifact-bundle.txt','artifact-build.txt','artifact-proof.json']:
 if(report/n).exists():mapping[n]=n
for n,label in mapping.items():shutil.copyfile(report/n,o/label)
for n,label in [('isolation-stage8-source.json','隔离HTTP.json'),('isolation-stage8-bundle.json','打包隔离HTTP.json')]:shutil.copyfile(r/'work/reports'/n,o/label)
for p in (r/'docs').glob('第十阶段B*.md'):shutil.copyfile(p,o/p.name)
shutil.copyfile(r/'docs/全新部署手册.md',o/'全新部署手册.md')
proof={'phase':'第十阶段B','pages_files':11,'pages_sha256':sha(o/'Pages最终上传包.zip'),'backend_console_migrations_unchanged':protected,'worker_unchanged':True,'backup_worker_changed':False,'new_api':0,'new_migrations':0,'deployment_required':True,'source_tests':132,'bundle_tests':132,'query_maximum':25,'assets_bytes':footprint,'wechat_real_device':False,'cloud_deployed':False}
(o/'部署资料核验.json').write_text(json.dumps(proof,ensure_ascii=False,indent=2)+'\n')
shots=r/'work/screenshots/stage10b';entries=[(p,p.name)for p in shots.iterdir()if p.is_file()and not p.name.startswith('failure-')]
zipto(o/'逐页截图与画板对照.zip',entries)
source.extend((p,'验收结果/'+p.name)for p in files(o)if p.suffix in ['.txt','.json'] and not p.name.startswith('SHA256'))
zipto(o/'第十阶段B源码.zip',source)
manifest={p.name:sha(p)for p in files(o)if p.name not in ['SHA256.txt','SHA256.json']};(o/'SHA256.txt').write_text(''.join(h+'  '+n+'\n'for n,h in sorted(manifest.items())));(o/'SHA256.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'output':str(o),'archives':{n:h for n,h in manifest.items()if n.endswith('.zip')},'footprint':footprint},ensure_ascii=False,indent=2))
