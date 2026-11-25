# coding: utf-8
"""第九阶段小改动二交付：Turnstile模式，保留Access及已验收备份部署文件。"""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import hashlib, json, shutil
root = Path(__file__).resolve().parent.parent
out = root/'outputs/第九阶段小改动二'
kit = root/'outputs/全新部署'
accepted = root/'outputs/第九阶段'
out.mkdir(parents=True, exist_ok=True)
def files(folder):
    return [p for p in folder.rglob('*') if p.is_file() and '__pycache__' not in p.parts]
def archive(target, entries):
    with ZipFile(target,'w',compression=ZIP_DEFLATED,compresslevel=9) as z:
        for p,name in sorted(entries,key=lambda x:x[1]):
            i=ZipInfo(name,date_time=(2026,11,3,0,0,0));i.compress_type=ZIP_DEFLATED;i.external_attr=0o100644<<16
            z.writestr(i,p.read_bytes())
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def manifest(folder):
    rows={p.relative_to(folder).as_posix():digest(p) for p in sorted(files(folder)) if p.name not in ['SHA256.txt','SHA256.json']}
    (folder/'SHA256.txt').write_text(''.join(f'{h}  {n}\n' for n,h in rows.items()))
    (folder/'SHA256.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n')
    return rows
# A fresh working checkout can use the accepted original deployment kit as the base.
if not kit.exists():
    kit.mkdir(parents=True)
    with ZipFile(root/'outputs/全新部署资料包.zip') as z:z.extractall(kit)
archive(out/'Pages最终上传包.zip',[(p,p.relative_to(root/'dist').as_posix()) for p in files(root/'dist')])
with ZipFile(out/'Pages最终上传包.zip') as z:
    assert len(z.namelist())==11 and '_worker.js' in z.namelist()
    for n in z.namelist():assert z.read(n)==(root/'dist'/n).read_bytes()
with ZipFile(accepted/'第九阶段源码.zip') as z:
    allowed={'src/server/core.js','src/server/auth.js','src/server/worker.js','src/tenant/app.js','src/tenant/index.html'}
    immutable=[]
    for n in z.namelist():
        if n.startswith(('src/','migrations/')) and n not in allowed:
            assert z.read(n)==(root/n).read_bytes(),n
            immutable.append(n)
    old_auth=z.read('src/server/auth.js').decode()
    new_auth=(root/'src/server/auth.js').read_text()
    assert old_auth.split('export async function changeTenantPassword',1)[1]==new_auth.split('export async function changeTenantPassword',1)[1]
    old_core=z.read('src/server/core.js').decode()
    new_core=(root/'src/server/core.js').read_text()
    assert old_core.split('export function secureResponse',1)[1]==new_core.split('export function secureResponse',1)[1]
    old_worker=z.read('src/server/worker.js').decode()
    new_worker=(root/'src/server/worker.js').read_text()
    extract=lambda v:v.split('async function dispatch',1)[1].split('// 在进行机构识别前',1)[0]
    assert extract(old_worker)==extract(new_worker)
with ZipFile(root/'outputs/第八阶段收尾/备份Worker网页部署包.zip') as z:
    assert z.read('backup-worker.js')==(kit/'backup-worker.js').read_bytes()
shutil.copyfile(out/'Pages最终上传包.zip',kit/'Pages最终上传包.zip')
shutil.copyfile(root/'docs/全新部署手册.md',kit/'全新部署手册.md')
reports={
    'stage9b-build.txt':'生产构建输出.txt','stage9b-all.txt':'源码测试结果.txt','stage9b-bundle.txt':'构建产物测试结果.txt',
    'stage9b-http-budget.json':'全部HTTP查询预算.json','stage9b-http-budget-bundle.json':'打包全部HTTP查询预算.json',
    'isolation-stage8-source.json':'隔离HTTP结果.json','isolation-stage8-bundle.json':'打包隔离HTTP结果.json',
}
for suffix,label in [('source.txt','独立解压源码测试.txt'),('bundle.txt','独立重建Worker测试.txt'),('build.txt','独立构建输出.txt'),('verification.json','独立重建一致性.json')]:
    name='stage9b-artifact-'+suffix
    if (root/'work/reports'/name).exists():reports[name]=label
for name,label in reports.items():shutil.copyfile(root/'work/reports'/name,out/label)
for name in ['全新部署手册.md','第九阶段小改动二交付说明.md']:shutil.copyfile(root/'docs'/name,out/name)
verification=json.loads((kit/'部署资料核验.json').read_text())
verification.update({'business_code_changed':True,'change_scope':'TURNSTILE_MODE，保留既有ACCESS_MODE，其他业务不变','production_pages_equal_accepted':False,'production_pages_sha256':digest(kit/'Pages最终上传包.zip'),'production_pages_files':11,'backup_worker_equal_accepted':True,'migrations_equal_accepted':11,'protected_files_unchanged':immutable,'source_tests':116,'built_worker_tests':116,'isolation_passed':41,'access_mode_values':{'undefined/empty/on':'on','off':'off','other':'503 CONFIG_INVALID'},'turnstile_mode_values':{'undefined/empty/on':'on','off':'off','other':'503 CONFIG_INVALID'},'backup_release_sha256':digest(kit/'backup-worker.js'),'backup_rebuild_sha256':digest(root/'backup-dist/backup-worker.js'),'backup_rebuild_equals_release':(kit/'backup-worker.js').read_bytes()==(root/'backup-dist/backup-worker.js').read_bytes(),'backup_deployment_required':False,'real_cloud_deployment_performed':False})
verification.pop('cloud_deployment_performed',None)
verification.pop('independent_rebuild',None)
independent=root/'work/reports/stage9b-artifact-verification.json'
if independent.exists():verification['independent_rebuild']=json.loads(independent.read_text())
(kit/'部署资料核验.json').write_text(json.dumps(verification,ensure_ascii=False,indent=2)+'\n')
shutil.copyfile(kit/'部署资料核验.json',out/'部署资料核验.json')
kit_manifest=manifest(kit)
archive(root/'outputs/全新部署资料包.zip',[(p,p.relative_to(kit).as_posix()) for p in files(kit)])
(root/'outputs/全新部署资料包.SHA256.txt').write_text(digest(root/'outputs/全新部署资料包.zip')+'  全新部署资料包.zip\n')
source=[]
for folder in ['src','scripts','tests','migrations','docs','tools']:
    source.extend((p,p.relative_to(root).as_posix()) for p in files(root/folder))
source.extend((root/n,n) for n in ['README.md','package.json'])
source.extend((out/label,'验收结果/'+label) for label in reports.values())
source.append((out/'部署资料核验.json','验收结果/部署资料核验.json'))
archive(out/'第九阶段小改动二源码.zip',source)
rows=manifest(out)
print(json.dumps({'output':str(out),'pages_files':11,'source_files':len(source),'archives':{k:v for k,v in rows.items() if k.endswith('.zip')},'deployment_kit_sha256':digest(root/'outputs/全新部署资料包.zip')},ensure_ascii=False,indent=2))
