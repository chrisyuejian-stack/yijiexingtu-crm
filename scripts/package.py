# coding: utf-8
"""第八阶段交付打包；源码、Pages直传、独立备份Worker和离线工具分别交付。"""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import hashlib, json, shutil
root = Path(__file__).resolve().parent.parent
out = root / 'outputs' / '第八阶段收尾'
out.mkdir(parents=True, exist_ok=True)
reports = {
 'stage8-final-build.txt':'生产构建输出.txt','stage8-final-build-sizes.json':'生产压缩前后大小.json',

 'stage8-final-all.txt':'源码测试结果.txt', 'stage8-final-bundle.txt':'打包Worker测试结果.txt',
 'stage8-final-http-budget.json':'全部HTTP查询预算.json', 'stage8-final-http-budget-bundle.json':'打包全部HTTP查询预算.json',
 'promo-budget.json':'推广中心规模查询预算.json','promo-budget-bundle.json':'打包推广中心规模查询预算.json',
 'tools-budget.json':'第六阶段规模查询预算.json','tools-budget-bundle.json':'打包第六阶段规模查询预算.json',
 'isolation-stage8-final-source.json':'隔离HTTP结果.json','isolation-stage8-final-bundle.json':'打包隔离HTTP结果.json',
 'stage8-final-migration-preservation.json':'原迁移文件一致性.json','stage8-final-screenshots.json':'窄屏截图核验.json',
 'query-budget.json':'排课查询预算.json','query-budget-bundle.json':'打包排课查询预算.json',
 'credits-budget.json':'课时查询预算.json','credits-budget-bundle.json':'打包课时查询预算.json',
 'finance-budget.json':'财务查询预算.json','finance-budget-bundle.json':'打包财务查询预算.json',
 'mobile-budget.json':'手机接口查询预算.json','mobile-budget-bundle.json':'打包手机接口查询预算.json',
 'legacy-finance-comparison.json':'旧版财务函数对照结果.json','money-schema.json':'金额字段类型检查.json',
 'stage4-review-budget.json':'月结竞态回归查询预算.json','stage4-review-budget-bundle.json':'打包月结竞态回归查询预算.json',
 'stage4-review-xlsx.json':'Excel结构与数字格式检查.json',
}
for a,b in {'stage8-final-artifact-source.txt':'交付解压源码独立测试.txt','stage8-final-artifact-bundle.txt':'交付解压重建Worker独立测试.txt','stage8-final-artifact-build.txt':'交付独立构建输出.txt','stage8-final-artifact-verification.json':'交付重建一致性.json'}.items():
 if (root/'work/reports'/a).exists(): reports[a]=b
for a,b in reports.items():
 p=root/'work'/'reports'/a
 if not p.exists():p=root/'验收结果'/b
 shutil.copyfile(p,out/b)
for p in (root/'docs').glob('第八阶段收尾*.md'):shutil.copyfile(p,out/p.name)
for name in ['已确认的需求决定.md','Claude安全审查交接.md','部署说明.md','第六阶段网页升级步骤.md']:
 shutil.copyfile(root/'docs'/name,out/name)

def archive(target, entries):
 with ZipFile(target,'w',compression=ZIP_DEFLATED,compresslevel=9) as z:
  for p,name in sorted(entries,key=lambda x:x[1]):
   entry=ZipInfo(name,date_time=(2026,11,3,0,0,0));entry.compress_type=ZIP_DEFLATED;entry.external_attr=0o100644<<16
   z.writestr(entry,p.read_bytes())

def files(directory):return [p for p in directory.rglob('*') if p.is_file() and '__pycache__' not in p.parts]
dist=[(p,p.relative_to(root/'dist').as_posix()) for p in files(root/'dist')]
archive(out/'Pages第八阶段收尾上传包.zip',dist)
archive(out/'备份Worker网页部署包.zip',[(root/'backup-dist/backup-worker.js','backup-worker.js'),(root/'docs/第八阶段收尾升级步骤.md','中文部署步骤.md')])
archive(out/'离线密钥生成器.zip',[(p,p.relative_to(root/'tools').as_posix()) for p in files(root/'tools')])
source=[]
shots=root/'work/screenshots/stage8-final'
if not shots.exists():shots=root/'验收截图'
(out/'验收截图').mkdir(exist_ok=True)
for p in files(shots):
 shutil.copyfile(p,out/'验收截图'/p.name);source.append((p,'验收截图/'+p.name))
for directory in ['src','scripts','tests','migrations','docs','tools']:
 source.extend((p,p.relative_to(root).as_posix()) for p in files(root/directory))
source.extend((root/n,n) for n in ['README.md','package.json'])
source.extend((out/n,'验收结果/'+n) for n in reports.values())
archive(out/'第八阶段收尾源码.zip',source)
with ZipFile(out/'Pages第八阶段收尾上传包.zip') as z:
 assert set(z.namelist())=={n for _,n in dist}
 for p,n in dist:assert z.read(n)==p.read_bytes(),n
manifest={p.relative_to(out).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(out.rglob('*')) if p.is_file() and p.name not in ['SHA256.json','SHA256.txt']}
(out/'SHA256.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
(out/'SHA256.txt').write_text(''.join(f'{v}  {k}\n' for k,v in manifest.items()))
print(json.dumps({'output':str(out),'upload_files':len(dist),'source_files':len(source),'upload_matches_dist':True,'archives':{k:v for k,v in manifest.items() if k.endswith('.zip')}},ensure_ascii=False,indent=2))
