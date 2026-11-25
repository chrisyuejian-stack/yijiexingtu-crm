import { createScenario } from '../../scripts/e2e/scenario.mjs';
import { writeFile } from 'node:fs/promises';
const s=await createScenario(),m=s.manifest;
try{
 async function call(path,role='supervisor',data){const res=await s.f.request(`http://localhost/${m.slug}/api/${path}`,{method:data===undefined?'GET':'POST',headers:{Origin:'http://localhost',Cookie:'channel_session='+s.tokens[role],'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})});return {status:res.status,body:await res.json()}}
 const tid=s.f.db.raw.prepare('SELECT id FROM tenants WHERE slug=?').get(m.slug).id;
 s.f.db.raw.prepare("UPDATE tenant_branding SET login_bg=?,logo=?,version=7 WHERE tenant_id=?").run('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB','data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB',tid);
 const request={paths:['c2/students/counts','c2/students?offset=bad']};
 const result={note:'真实本地API返回；机构及数据全为虚构，不是线上信息',read_batch:{request,response:await call('read-batch','supervisor',request)},personal_denial:await call('read-batch','student',{paths:['c2/students/counts']}),counts:await call('c2/students/counts'),brand_lite:await call('public/brand?lite=1')};
 await writeFile('docs/p4/API实测示例.json',JSON.stringify(result,null,2));
}finally{s.f.restore()}
