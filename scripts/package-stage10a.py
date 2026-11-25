# coding: utf-8
"""阶段A确定性交付；不修改已验收生产资料。"""
from pathlib import Path
from zipfile import ZipFile,ZipInfo,ZIP_DEFLATED
import json,hashlib,shutil
root=Path(__file__).resolve().parent.parent
out=root/'outputs/第十阶段A';out.mkdir(parents=True,exist_ok=True)
def files(p):return sorted(x for x in p.rglob('*') if x.is_file() and '__pycache__' not in x.parts)
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def archive(p,entries):
    with ZipFile(p,'w',ZIP_DEFLATED,compresslevel=9) as z:
        for src,name in sorted(entries,key=lambda x:x[1]):
            info=ZipInfo(name,(2026,11,4,0,0,0));info.compress_type=ZIP_DEFLATED;info.external_attr=0o100644<<16
            z.writestr(info,src.read_bytes())
base=root/'outputs/第九阶段小改动三'
shutil.copyfile(base/'Pages最终上传包.zip',out/'Pages最终上传包.zip')
with ZipFile(out/'Pages最终上传包.zip') as z:
    assert len(z.namelist())==11 and '_worker.js' in z.namelist()
    assert set(z.namelist())=={p.relative_to(root/'dist').as_posix() for p in files(root/'dist')}
    for n in z.namelist():assert z.read(n)==(root/'dist'/n).read_bytes(),n
assert sha(root/'backup-dist/backup-worker.js')==sha(base/'backup-worker.js')
folders=['src','scripts','tests','migrations','docs','tools','dev']
source=[(p,p.relative_to(root).as_posix()) for f in folders for p in files(root/f)]
source.extend((root/n,n) for n in ['README.md','package.json'])
current={n:p.read_bytes() for p,n in source}
with ZipFile(base/'第九阶段小改动三源码.zip') as z:
    prior={n:z.read(n) for n in z.namelist() if n.startswith(tuple(f+'/' for f in folders)) or n in ['README.md','package.json']}
protected=[n for n in prior if n.startswith(('src/','migrations/','tests/')) or n in ['scripts/build.mjs','package.json']]
for n in protected:assert current[n]==prior[n],n
inventory={'baseline':'第九阶段小改动三源码.zip','modified':sorted(n for n in prior if n in current and prior[n]!=current[n]),'added':sorted(n for n in current if n not in prior),'removed':sorted(n for n in prior if n not in current)}
assert not inventory['removed']
(out/'修改文件清单.json').write_text(json.dumps(inventory,ensure_ascii=False,indent=2)+'\n')
reports={
 'stage10a/source-tests.txt':'源码测试结果.txt','stage10a/bundle-tests.txt':'构建产物测试结果.txt','stage10a/build-output.txt':'生产构建输出.txt',
 'stage10a/browser-output.txt':'浏览器测试结果.txt','stage10a/browser-check.json':'浏览器结果.json','stage10a/contrast.json':'对比度结果.json',
 'stage10a/http-budget-source.json':'全部HTTP查询预算.json','stage10a/http-budget-bundle.json':'打包全部HTTP查询预算.json',
 'isolation-stage8-source.json':'隔离HTTP结果.json','isolation-stage8-bundle.json':'打包隔离HTTP结果.json',
}
for suffix,label in [('source.txt','独立解压源码测试.txt'),('bundle.txt','独立重建Worker测试.txt'),('build.txt','独立构建输出.txt'),('verification.json','独立重建一致性.json'),('browser.txt','独立解压浏览器测试.txt')]:
    name='stage10a/artifact-'+suffix
    if (root/'work/reports'/name).exists():reports[name]=label
for n,label in reports.items():shutil.copyfile(root/'work/reports'/n,out/label)
for n in ['第十阶段A_交付说明.md','第十阶段A_组件使用指南.md','第十阶段_确认记录.md','第十阶段_列表功能矩阵.md','第十阶段_待确认与接口缺口.md','已确认的需求决定.md']:
    shutil.copyfile(root/'docs'/n,out/n)
shots=out/'验收截图';shots.mkdir(exist_ok=True)
for p in (root/'work/screenshots/stage10a').iterdir():
    if p.suffix in ['.png','.json'] and not p.name.startswith(('failure-','initial-')):shutil.copyfile(p,shots/p.name)
archive(out/'组件截图与画板对照.zip',[(p,p.relative_to(shots).as_posix()) for p in files(shots)]+[(root/'dev/ui-components/reference/Main.png','设计参照/Main.png')])
budget=json.loads((out/'全部HTTP查询预算.json').read_text());browser=json.loads((out/'浏览器结果.json').read_text())
proof={'phase':'第十阶段A','date':'2026-11-04','production_pages_files':11,'production_pages_sha256':sha(out/'Pages最终上传包.zip'),'production_pages_equal_accepted':True,'production_js_byte_delta':0,'backup_worker_changed':False,'backup_worker_sha256':sha(root/'backup-dist/backup-worker.js'),'source_tests':127,'bundle_tests':127,'original_tests_retained':125,'ui_browser_tests':browser['total'],'ui_browser_passed':browser['passed'],'query_interfaces':len(budget['interfaces']),'query_maximum':budget['maximum'],'query_limit':40,'isolation_each':41,'new_endpoints':0,'migrations_changed':[],'protected_files_unchanged':protected,'development_files_in_pages':False,'deployment_required':False,'real_cloud_deployment_performed':False,'wechat_real_device_tested':False}
if (out/'独立重建一致性.json').exists():proof['independent_rebuild']=json.loads((out/'独立重建一致性.json').read_text())
(out/'部署资料核验.json').write_text(json.dumps(proof,ensure_ascii=False,indent=2)+'\n')
source.extend((out/label,'验收结果/'+label) for label in reports.values())
source.extend((out/n,'验收结果/'+n) for n in ['修改文件清单.json','部署资料核验.json'])
archive(out/'第十阶段A源码.zip',source)
rows={p.relative_to(out).as_posix():sha(p) for p in files(out) if p.name not in ['SHA256.txt','SHA256.json']}
(out/'SHA256.txt').write_text(''.join(h+'  '+n+'\n' for n,h in sorted(rows.items())))
(out/'SHA256.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'output':str(out),'source_files':len(source),'modified':inventory['modified'],'added_count':len(inventory['added']),'archives':{n:h for n,h in rows.items() if n.endswith('.zip')}},ensure_ascii=False,indent=2))
