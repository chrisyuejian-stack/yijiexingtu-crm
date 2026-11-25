# coding: utf-8
"""第九阶段可复现交付；业务代码只改Access开关，保留已验收备份Worker与全部迁移。"""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import hashlib, json, shutil
root = Path(__file__).resolve().parent.parent
out = root/'outputs/第九阶段'
kit = root/'outputs/全新部署'
accepted = root/'outputs/第八阶段收尾'
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
with ZipFile(accepted/'第八阶段收尾源码.zip') as z:
    protected=['migrations/','src/tenant/']
    immutable=[]
    for n in z.namelist():
        if n.startswith(tuple(protected)) or n in ['src/server/auth.js','src/server/security.js','src/server/permissions.js','src/server/backup.js','src/server/promo.js','src/server/crypto.js','src/server/repo.js']:
            assert z.read(n)==(root/n).read_bytes(),n
            immutable.append(n)
with ZipFile(accepted/'备份Worker网页部署包.zip') as z:
    assert z.read('backup-worker.js')==(kit/'backup-worker.js').read_bytes()
shutil.copyfile(out/'Pages最终上传包.zip',kit/'Pages最终上传包.zip')
shutil.copyfile(root/'docs/全新部署手册.md',kit/'全新部署手册.md')
reports={
    'stage9-build.txt':'生产构建输出.txt','stage9-all.txt':'源码测试结果.txt','stage9-bundle.txt':'构建产物测试结果.txt',
    'stage9-http-budget.json':'全部HTTP查询预算.json','stage9-http-budget-bundle.json':'打包全部HTTP查询预算.json',
    'isolation-stage8-source.json':'隔离HTTP结果.json','isolation-stage8-bundle.json':'打包隔离HTTP结果.json',
}
for suffix,label in [('source.txt','独立解压源码测试.txt'),('bundle.txt','独立重建Worker测试.txt'),('build.txt','独立构建输出.txt'),('verification.json','独立重建一致性.json')]:
    name='stage9-artifact-'+suffix
    if (root/'work/reports'/name).exists():reports[name]=label
for name,label in reports.items():shutil.copyfile(root/'work/reports'/name,out/label)
for name in ['全新部署手册.md','第九阶段交付说明.md']:shutil.copyfile(root/'docs'/name,out/name)
verification=json.loads((kit/'部署资料核验.json').read_text())
verification.update({'business_code_changed':True,'change_scope':'ACCESS_MODE与控制台提示，其他业务不变','production_pages_equal_accepted':False,'production_pages_sha256':digest(kit/'Pages最终上传包.zip'),'production_pages_files':11,'backup_worker_equal_accepted':True,'migrations_equal_accepted':11,'protected_files_unchanged':immutable,'source_tests':107,'built_worker_tests':107,'isolation_passed':41,'access_mode_values':{'undefined/empty/on':'on','off':'off','other':'503 CONFIG_INVALID'},'real_cloud_deployment_performed':False})
verification.pop('cloud_deployment_performed',None)
independent=root/'work/reports/stage9-artifact-verification.json'
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
archive(out/'第九阶段源码.zip',source)
rows=manifest(out)
print(json.dumps({'output':str(out),'pages_files':11,'source_files':len(source),'archives':{k:v for k,v in rows.items() if k.endswith('.zip')},'deployment_kit_sha256':digest(root/'outputs/全新部署资料包.zip')},ensure_ascii=False,indent=2))
