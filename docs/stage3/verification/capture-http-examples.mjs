// Developer-only local HTTP walkthrough. AI proposal records are explicit test fixtures;
// no model endpoint or production service is called.
import assert from 'node:assert/strict';
import {fixture} from '../../../tests/support.mjs';
import {setup} from '../../../tests/fixtures-credit.mjs';
import {workbook} from '../../../src/server/xlsx.js';
import {mkdir,writeFile} from 'node:fs/promises';
const f=await fixture(),examples=[];
try {
 const s=await setup(f,1,'handoff');
 const base='/'+s.t.slug+'/api';
 async function call(key,path,method='GET',data,form,status=200) {
  const headers={Origin:'https://school.test',Cookie:'channel_session='+s.token};if(!form)headers['Content-Type']='application/json';
  const res=await f.request('https://school.test'+base+'/'+path,{method,headers,body:form||(data===undefined?undefined:JSON.stringify(data))});
  const bytes=new Uint8Array(await res.arrayBuffer());let value;try{value=JSON.parse(new TextDecoder().decode(bytes));}catch{value={binary_bytes:bytes.length,content_type:res.headers.get('content-type')};}
  assert.equal(res.status,status,JSON.stringify({path,value}));
  examples.push({key,request:{method,path:base+'/'+path,body:form?{multipart:[...form].map(([key,v])=>[key,typeof v==='string'?v:{file:v.name,bytes:v.size,type:v.type}])}:data??null,actor:'supervisor_session'},response:{status:res.status,body:value}});return value;
 }
 await call('subjects_empty','settings/subjects');await call('subjects_import','settings/subjects','POST',{key:'music_interest'});await call('subjects_list','settings/subjects');
 const courses=await call('courses_list','settings/courses?subject=music_interest&limit=2');
 const created=await call('course_create','settings/courses','POST',{subject:'music_interest',group:'主修',name:'对接报价示例',form:'one_to_one',minutes:45,pricing:{mode:'per_unit',amount:200},optional:false},null,201);
 const updated=await call('course_put','settings/courses/'+created.id,'PUT',{...created,pricing:{mode:'per_unit',amount:220.5}});await call('course_detail','settings/courses/'+created.id);await call('course_delete','settings/courses/'+created.id,'DELETE',{version:updated.version});
 const stages=await call('stage_types_list','settings/stage-types?limit=2');
 const st=await call('stage_type_create','settings/stage-types','POST',{subject:'music_interest',name:'对接阶段示例',default_months:{min:2,max:3},anchor:'normal',anchor_node:null,offset_months:0,order:20},null,201);
 const st2=await call('stage_type_put','settings/stage-types','PUT',{...st,name:'对接阶段更新'});await call('stage_type_delete','settings/stage-types','DELETE',{id:st2.id,version:st2.version});
 const rules=await call('stage_rules_get','settings/stage-rules');await call('stage_rules_put','settings/stage-rules','PUT',{...rules,rules:{...rules.rules,insert_holiday_camp:false}});
 const calendar=await call('calendar_get','settings/calendar');const cal2=await call('calendar_put','settings/calendar','PUT',{...calendar,region:'上海',items:calendar.items.map(x=>x.key==='grade_exam'?{...x,months:[11]}:x)});
 await call('calendar_conflict','settings/calendar','PUT',calendar,null,409);
 const cr=await call('course_rules_get','settings/course-rules');await call('course_rules_put','settings/course-rules','PUT',{version:cr.version,items:[{stage_type_id:stages.items[0].id,required:[courses.items[0].id],recommended:[],exclusive:[],units:{min:6,max:20}}]});
 await call('report_classes_list','settings/report-classes?limit=2');
 const rc=await call('report_class_create','settings/report-classes','POST',{subject:'music_interest',name:'对接声乐班',dimensions:[{key:'pitch',name:'音准',order:1,feedback_tags:['音准稳']}],options:{compare_previous:true,mock_exam:false,require_artwork:false,renewal_suggestion:false}},null,201);
 const rc2=await call('report_class_put','settings/report-classes','PUT',{...rc,dimensions:[{...rc.dimensions[0],name:'音准表现'}]});await call('report_class_delete','settings/report-classes','DELETE',{id:rc2.id,version:rc2.version});
 const profile=await call('profile_get','settings/profile');await call('profile_put','settings/profile','PUT',{...profile,introduction:'本地模拟机构介绍',features:['小班教学'],address:'测试地址',class_hours:'周末',contact_phone:'13800000000',selling_points:['按学员情况制定练习安排'],teachers:[{teacher_id:s.teacher,introduction:'本地模拟老师介绍'}]});
 const brand=await call('brand_get','settings/brand');await call('brand_invalid','settings/brand','PATCH',{version:brand.version,name:'不允许改名'},null,422);
 const png=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jw1kAAAAASUVORK5CYII='),c=>c.charCodeAt(0));
 await mkdir('work/stage3',{recursive:true});await writeFile('work/stage3/gallery-example.png',png);
 const imageForm=new FormData();imageForm.set('file',new Blob([png],{type:'image/png'}),'gallery-example.png');imageForm.set('tags',JSON.stringify(['作品']));
 const image=await call('gallery_upload','gallery','POST',undefined,imageForm,201);await call('gallery_list','gallery?tag=作品');const tagged=await call('gallery_patch','gallery/'+image.id,'PATCH',{version:image.version,tags:['作品','家长已同意展示']});await call('gallery_file','gallery/'+image.id+'/file');await call('brand_patch','settings/brand','PATCH',{version:brand.version,primary_color:'#123456',qr_image_id:image.id});await call('gallery_delete','gallery/'+image.id,'DELETE',{version:tagged.version});const keptBrand=await call('brand_after_image_hidden','settings/brand');await call('brand_color_keep_hidden_qr','settings/brand','PATCH',{version:keptBrand.version,primary_color:'#654321'});
 const sheet=workbook([['学科','课程组','课程名称','形式','时长分钟','时长说明','计价方式','金额','每包课时'],['music_interest','主修','对接Excel课程','one_to_one',45,'','per_unit',199.99,'']]);await writeFile('work/stage3/course-import-example.xlsx',sheet);
 const importForm=new FormData();importForm.set('file',new Blob([sheet],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),'course-import-example.xlsx');const preview=await call('courses_import_preview','settings/courses/import','POST',undefined,importForm);const commit=new FormData();commit.set('preview_id',preview.preview_id);commit.set('confirm','true');await call('courses_import_confirm','settings/courses/import','POST',undefined,commit);
 const payload={ops:[{op:'update',entity:'calendar',key:'grade_exam',field:'months',from:[11],to:[1,11]}],side_effects:[],affected:{plans_in_progress:0}};
 // Trusted local suggestion fixture, not an implemented AI HTTP request.
 await s.r.settingsSuggestion('sg_handoff',s.user,payload);
 const card=await call('change_submit','settings/changes','POST',{suggestion_id:'sg_handoff',payload},null,201);await call('changes_list','settings/changes?status=pending');await call('change_approve','settings/changes/'+card.id+'/approve','POST',{});await call('change_revert','settings/changes/'+card.id+'/revert','POST',{});
 await s.r.settingsSuggestion('sg_handoff_reject',s.user,payload);const rejected=await call('change_submit_reject','settings/changes','POST',{suggestion_id:'sg_handoff_reject',payload},null,201);await call('change_reject','settings/changes/'+rejected.id+'/reject','POST',{});
 await call('guardian_no_tenant_id','students/'+s.students[0]+'/guardians','POST',{phone:'13800001111',name:'本地模拟家长',relation:'mother'},null,201);
 await writeFile('work/stage3/http-walkthrough.json',JSON.stringify({contract:'v0.3.4',notice:'本地真实HTTP处理响应；同一演示场景。Cookie未导出。multipart用字段和文件元数据表示，图片响应是二进制而非JSON。修改卡片的AI建议是本地前置夹具，未调用模型接口。',examples},null,2)+'\n');
 console.log(JSON.stringify({result:'pass',examples:examples.length,all_stage3_http_methods_exercised:true,remote_calls:0}));
}finally{f.restore();}
