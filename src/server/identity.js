import {platformOps} from './platform-ops.js';
import { aiOps } from './ai.js';
import { repo } from './repo.js';
import { authenticateAdmin, requireAccess, readCookie } from './auth.js';
import { platformPhoneIndex, digestPassword, phoneIndex, encrypt, temporaryPassword, newPassword } from './crypto.js';
import { body, json, fail, string, integer, version, randomId, now, sha, b64, bytes, equal, clientInfo, turnstileMode, accessMode, HttpError } from './core.js';
import { publicUser, modules } from './permissions.js';
import { requireCan } from './accounts.js';
import { validSlug } from './tenant.js';
import { platformCommand } from './tenant-lifecycle.js';

export const ROOT_COOKIE='__Host-yx_session';
export const identityLabels={plan_templates:'方案模版',plan_references:'参考方案',content:'招生内容',plans:'课程方案',growth_reports:'成长报告',school_db:'院校库',prices:'报价价格',feedback:'课后反馈',parents:'家长管理',ai:'AI工具',usage:'AI用量'};
export function identityPath(path) {
  return /^\/api\/(?:auth\/(?:login(?:\/choose)?|status)|parent\/children|parents\/[^/]+\/(?:disable|reset-password)|students\/[^/]+\/guardians(?:\/[^/]+)?)$/.test(path);
}
export function identityErrorCode(error) {
  const map={REQUEST_REJECTED:'bad_request',SESSION_INVALID:'unauthenticated',LOGIN_FAILED:'unauthenticated',PERMISSION_DENIED:'forbidden',PASSWORD_CHANGE_REQUIRED:'forbidden',ACCESS_DENIED:'forbidden',CONFLICT:'version_conflict'};
  return map[error.code] || (error.code && /^[a-z_]+$/.test(error.code) ? error.code : ({400:'bad_request',401:'unauthenticated',403:'forbidden',404:'not_found',409:'version_conflict',422:'validation_failed',429:'rate_limited',503:'configuration_missing'}[error.status]||'internal_error'));
}
function checkTenant(t) {
  if(t.deleted_at) fail(404,'不存在','not_found');
  if(t.status!=='active'||(t.expires_at&&Date.parse(t.expires_at+'T23:59:59+08:00')<=now()))
    fail(403,'机构已到期或停用，请联系机构负责人','tenant_expired');
}
export async function identityRoot(req,env,url,authenticatedRoute) {
  if(url.hostname!==env.TENANT_HOST||!url.pathname.startsWith('/api/')) return null;
  env.__identityContract=true;
  const path=url.pathname,p=repo(env,null);
  if(path==='/api/login') return {response:json({error:'not_found',message:'不存在'},404)};
  if(path==='/api/public/tenant-brand'&&req.method==='GET') {
    const row=await p.identityPublicBrand(url.searchParams.get('slug')||'');
    return {response:json(row?{name:row.name,logo_url:row.logo_url,login_bg_url:row.login_bg_url,primary_color:row.primary_color}:{name:'机构登录',logo_url:null,login_bg_url:null,primary_color:'#6A35B8'})};
  }
  if(path==='/api/auth/login'&&req.method==='POST') return {response:await rootLogin(req,env,await body(req))};
  if(path==='/api/auth/login/choose'&&req.method==='POST') {
    const d=await body(req);string(d.choice_token,'机构选择凭据',200);
    const hash=await sha(d.choice_token),choice=await p.identityChoice(hash);
    if(!choice) fail(401,'机构选择已过期，请重新登录','unauthenticated');
    const token=b64(bytes(32));await p.identityConsumeChoice(hash,await sha(token),clientInfo(req));
    await repo(env,choice.tenant_id).authEvent(choice.user_id,choice.phone_last4,'login_success',clientInfo(req));
    return {response:json({user:publicUser({...choice,id:choice.user_id}),must_change:!!choice.must_change,api_base:'/api'},200,{'Set-Cookie':rootCookie(token)})};
  }
  if(path.startsWith('/api/public/')||path.startsWith('/api/share/')) return {response:json({error:'not_found',message:'不存在'},404)};
  if(!authenticatedRoute(path)) return {response:json({error:'not_found',message:'不存在'},404)};
  const token=readCookie(req,ROOT_COOKIE),hash=/^[A-Za-z0-9+/]{43}=$/.test(token)?await sha(token):null;
  const owner=hash?await p.identitySessionOwner(hash,'root'):null;
  if(!owner) {
    if(path==='/api/auth/status'&&req.method==='GET') return {response:json({authenticated:false,api_base:'/api'})};
    fail(401,'请重新登录','unauthenticated');
  }
  const r=repo(env,owner.tenant_id),t=await r.tenant();
  if(!t||t.deleted_at) fail(404,'不存在','not_found');
  const resolved={tenant:t,base:'/',relative:path,hash,auth:await r.authenticateRequest(hash),root:true};
  if(path==='/api/auth/status') env.__identityStatus=true;
  return {resolved};
}
function rootCookie(token) {return `${ROOT_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=43200`;}
export function clearRootCookie() {return `${ROOT_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;}
async function rootLogin(req,env,d) {
  string(d.phone,'手机号',64);string(d.password,'密码',256);
  const valid=/^1[3-9]\d{9}$/.test(d.phone),index=await platformPhoneIndex(env,valid?d.phone:'13800000000');
  const r=repo(env,null),candidates=await r.identityCandidates(index),info=clientInfo(req),matches=[];
  // Exactly five PBKDF2 invocations, including invalid numbers and throttled requests.
  for(let slot=0;slot<5;slot++) {
    const candidate=candidates[slot];
    const hash=await digestPassword(env,d.password,candidate?.salt||'AAAAAAAAAAAAAAAAAAAAAA==');
    if(candidate&&equal(hash,candidate.digest)) matches.push(candidate);
  }
  const off=turnstileMode(env)==='off',phoneMax=off?3:5,ipMax=off?10:20;
  let verified=off;
  if(!verified) try {
    const out=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',body:new URLSearchParams({secret:env.TURNSTILE_SECRET,response:String(d.turnstile||'').slice(0,4096),remoteip:info.ip}),signal:AbortSignal.timeout(10000)});
    const result=await out.json();verified=!!d.turnstile&&result.success===true&&result.hostname===new URL(req.url).hostname&&result.action==='login';
  } catch {}
  const phoneKey='root-login:'+index,ipKey='root-login-ip:'+info.ip;
  const locked=await r.tenantLoginLimited(phoneKey,ipKey,phoneMax,ipMax);
  if(candidates[0]?.candidate_count>5) await r.platformLog('system','平台手机号候选告警',null,'根登录候选超过5个，仅校验最近登录的5个',info.ip);
  if(!valid||!verified||locked||!matches.length) {
    await r.tenantLoginLimited(phoneKey,ipKey,phoneMax,ipMax,true);
    await r.platformLog('system',locked?'登录限流告警':'根登录失败',null,'根地址登录失败（手机号不入日志）',info.ip);
    fail(401,'手机号或密码不正确','unauthenticated');
  }
  await r.clearLimit(phoneKey);
  if(matches.length===1) {
    const u=matches[0],tr=repo(env,u.tenant_id),tenant=await tr.tenant();checkTenant(tenant);
    const token=b64(bytes(32));await tr.createSession(await sha(token),u,info,tenant.version,'root');
    await tr.authEvent(u.id,u.phone_last4,'login_success',info);
    return json({user:publicUser(u),must_change:!!u.must_change,api_base:'/api'},200,{'Set-Cookie':rootCookie(token)});
  }
  const choices=[],stored=[],until=now()+120000;
  for(const u of matches) {
    const token=b64(bytes(32));stored.push({...u,choice_hash:await sha(token)});
    choices.push({choice_token:token,name:u.tenant_name,logo_url:u.logo||null});
  }
  await r.identityChoices(stored,randomId('choice'),until);
  return json({need_tenant_choice:true,choices,ttl:120});
}
export async function identityTenant(req,env,resolved,user,policy,url) {
  const path=resolved.relative,r=repo(env,resolved.tenant.id);
  const apiBase=resolved.root?'/api':resolved.base.replace(/\/$/,'')+'/api';
  if(path==='/api/auth/status'&&req.method==='GET') return json({authenticated:true,user:publicUser(user),api_base:apiBase,tenant_status:resolved.tenant.status!=='active'?'paused':(resolved.tenant.expires_at&&Date.parse(resolved.tenant.expires_at+'T23:59:59+08:00')<=now()?'expired':'active')});
  if(path==='/api/me' && user.roles.includes('parent')) {
    const brand=await r.brand();
    return json({user:publicUser(user),api_base:apiBase,brand:{name:brand.display_name,logo_url:brand.logo,primary_color:brand.theme_color},children:await r.identityChildren(user.id)});
  }
  if(path==='/api/parent/children'&&req.method==='GET') {
    if(user.roles.includes('parent')) return json({items:await r.identityChildren(user.id)});
    if(user.roles.includes('student')) {const s=await r.businessGet('students',user.student_id);return json({items:s?[{id:s.id,name:s.name,nickname:s.nickname,grade:s.grade,direction:s.direction}]:[]});}
    fail(403,'没有权限','forbidden');
  }
  const guardian=/^\/api\/students\/([^/]+)\/guardians(?:\/([^/]+))?$/.exec(path);
  if(guardian) {
    requireCan(user,policy,'parents','manage');
    const student=await r.businessGet('students',guardian[1]);if(!student) fail(404,'不存在','not_found');
    if(!guardian[2]&&req.method==='GET') return json({items:await r.identityGuardians(student.id)});
    const d=await body(req);
    if(!guardian[2]&&req.method==='POST') {
      const relation=relationValue(d.relation);string(d.name,'家长姓名',50);
      const pi=await phoneIndex(env,resolved.tenant.id,d.phone),existing=await r.userByPhone(pi);
      if(existing&&!JSON.parse(existing.roles).includes('parent')) fail(409,'该手机号已被其他类型账号使用','phone_in_use');
      if(existing&&!existing.active&&existing.disabled_reason!=='no_children') fail(409,'家长账号已被停用，请先手动启用','account_disabled');
      let newUser=null,password,parent=existing;
      if(!parent) {
        password=temporaryPassword();parent={id:randomId('usr')};
        newUser={name:d.name,phone_hmac:pi,phone_enc:await encrypt(env,d.phone,resolved.tenant.id+':phone'),phone_last4:d.phone.slice(-4),...await newPassword(env,password)};
      }
      let link;
      try { link=await r.identityBindGuardian(student.id,parent,relation,user,newUser); }
      catch (e) {
        if (versionRace(e)) throw conflictError({guardians:await r.identityGuardians(student.id)});
        throw e;
      }
      return json({link:guardianDto(link),user:publicUser(await r.user(parent.id)),...(password?{temporary_password:password}:{})},201);
    }
    const link=await r.identityGuardian(student.id,guardian[2]);if(!link) fail(404,'不存在','not_found');
    if(!['PATCH','DELETE'].includes(req.method)) fail(404,'不存在','not_found');
    const v=req.method==='PATCH'?version(d.version):d.version===undefined?link.version:version(d.version);
    if(v!==link.version) throw conflictError(guardianDto(link));
    try { await r.identityChangeGuardian(link,req.method==='PATCH'?relationValue(d.relation):link.relation,req.method==='DELETE',v,user); }
    catch (e) {
      if (e.code==='version_conflict' || versionRace(e)) throw conflictError(guardianDto(await r.identityGuardian(student.id,link.id)));
      throw e;
    }
    return json(req.method==='DELETE'?{ok:true}:{link:guardianDto(await r.identityGuardian(student.id,link.id))});
  }
  const parent=/^\/api\/parents\/([^/]+)\/(reset-password|disable)$/.exec(path);
  if(parent&&req.method==='POST') {
    requireCan(user,policy,'parents','manage');const target=await r.user(parent[1]);
    if(!target||target.roles!=='["parent"]') fail(404,'不存在','not_found');
    await body(req);
    if(parent[2]==='disable') {await r.identityDisableParent(target,user);return json({ok:true});}
    const password=temporaryPassword();await r.password(target.id,target.version,await newPassword(env,password),user,1);
    return json({id:target.id,temporary_password:password});
  }
  return undefined;
}
function guardianDto(row) {
  if (!row) return null;
  const {tenant_id,...result}=row;
  for (const key of ['created_at','updated_at','revoked_at'])
    if (typeof result[key]==='number') result[key]=new Date(result[key]+8*3600000).toISOString().replace('Z','+08:00');
  return result;
}
function relationValue(v) {if(!['mother','father','grandparent','other'].includes(v)) fail(422,'家长关系不正确','validation_failed');return v;}
function versionRace(e) {return /CHECK constraint failed: expected=actual/.test(String(e?.message));}
function conflictError(latest) {const e=new HttpError(409,'记录已被修改，请刷新','version_conflict');e.details={latest};return e;}
export async function identityParentScope(user,r,path,url) {
  if(!user.roles.includes('parent')||['/api/me','/api/logout','/api/password','/api/sessions'].includes(path)||path.startsWith('/api/sessions/')) return user;
  const children=await r.identityChildren(user.id);
  const explicit=/^\/api\/data\/students\/([^/]+)(?:\/contact)?$/.exec(path)?.[1]||url.searchParams.get('student_id');
  const id=explicit||(children.length===1?children[0].id:null);
  if(!id||!children.some(s=>s.id===id)) fail(404,'不存在','not_found');
  // Legacy services already enforce student-level ownership and DTO filtering.
  return {...user,roles:['student'],student_id:id};
}
export async function identityOps(req,env,url) {
  env.__identityContract=true;
  if(accessMode(env)==='on') await requireAccess(req,env);
  const admin=await authenticateAdmin(req,env);if(admin.role!=='owner') fail(403,'没有权限','forbidden');
  const aiResult=await aiOps(req,env,url,admin);if(aiResult!==undefined)return aiResult;
  const opsResult=await platformOps(req,env,url,admin);if(opsResult!==undefined)return opsResult;
  const path=url.pathname,p=repo(env,null),match=/^\/api\/ops\/tenants(?:\/([^/]+)(?:\/(suspend|resume|revoke-sessions))?)?$/.exec(path);
  if(!match) fail(404,'不存在','not_found');
  if(!match[1]&&req.method==='GET') {
    const offset=integer(Number(url.searchParams.get('offset')||0),'offset',0,1000000),limit=integer(Number(url.searchParams.get('limit')||50),'limit',1,200);
    const page=await p.identityOpsTenants(offset,limit),items=(await p.identityOpsPage(page.ids)).map(opsDto);
    return json({items,total:page.total,next_offset:offset+limit<page.total?offset+limit:null});
  }
  if(!match[2]&&((!match[1]&&['POST','PUT'].includes(req.method))||(match[1]&&['GET','PUT'].includes(req.method)))) {
    if(req.method==='GET') {const c=await repo(env,match[1]).identityOpsConfig();if(!c)fail(404,'不存在','not_found');return json(opsDto(c));}
    const d=await body(req),id=match[1]||d.id||(req.method==='POST'?randomId('ten'):null);
    if(!id) fail(400,'缺少机构编号','bad_request');
    const old=req.method==='POST'?null:await repo(env,id).identityOpsConfig();if(req.method!=='POST'&&!old)fail(404,'不存在','not_found');
    if(old&&version(d.version)!==old.tenant.version) throw conflictError(opsDto(old));
    const next=opsInput(d,old,id);
    if(await p.slugTaken(next.slug,id)) fail(409,'机构代号已被使用','duplicate');
    try { await p.identityOpsSave(next,old,admin,modules); }
    catch (e) {
      if (old && versionRace(e)) throw conflictError(opsDto(await repo(env,id).identityOpsConfig()));
      throw e;
    }
    return json(opsDto(await repo(env,id).identityOpsConfig()),old?200:201);
  }
  if(match[1]&&match[2]&&req.method==='POST') {
    const r=repo(env,match[1]),t=await r.tenant();if(!t||t.deleted_at)fail(404,'不存在','not_found');
    const d=await body(req);if(version(d.version)!==t.version) throw conflictError(opsDto(await r.identityOpsConfig()));
    const reason=string(d.reason,'原因',1000);
    if(match[2]==='revoke-sessions') {
      if(d.confirm_name!==t.name) fail(422,'请再次确认机构全名','validation_failed');
      await r.identityRevokeSessions({id:admin.id,name:admin.username},reason);
      await p.platformLog(admin.id,'revoke_sessions',t.id,reason,clientInfo(req).ip);return json({ok:true});
    }
    const enable=match[2]==='resume';
    if(enable&&t.expires_at&&Date.parse(t.expires_at+'T23:59:59+08:00')<=now()) fail(409,'请先延长机构有效期','invalid_state');
    const row=await p.lifecycleState(t.id),op=await platformCommand(admin,d.operation_id||randomId('op'),match[2],[t.id,t.version,reason]);
    const result=await p.changeTenantLifecycle(t.id,row,enable,op,{...admin,ip:clientInfo(req).ip},reason);
    return json({...result,version:t.version+1});
  }
  fail(404,'不存在','not_found');
}
function opsDto(c) {
  const t=c.tenant;
  return {id:t.id,version:t.version,name:t.name,slug:t.slug,status:t.status,expires_at:t.expires_at,staff_seat_limit:t.staff_seat_limit,
    logo:c.brand.logo,login_bg:c.brand.login_bg,primary_color:c.brand.theme_color,
    modules:Object.fromEntries(c.modules.map(m=>[m.id,!!m.enabled])),module_labels:{...identityLabels,reports:'统计报表'},subjects:c.subjects.map(s=>({key:s.id,pack_version:s.pack_version})),ai_override:c.ai_override?{fast_daily_limit:c.ai_override.fast_daily_limit,deep_daily_limit:c.ai_override.deep_daily_limit}:null};
}
function opsInput(d,old,id) {
  const current=old?opsDto(old):{};
  const slug=d.slug??current.slug;if(!validSlug(slug)) fail(422,'机构代号格式不正确','validation_failed');
  const date=d.expires_at===undefined?(current.expires_at??null):d.expires_at;
  if(date!==null&&(!/^\d{4}-\d{2}-\d{2}$/.test(date)||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)) fail(422,'到期日期不正确','validation_failed');
  const selected=d.subjects===undefined?undefined:d.subjects;
  if(selected!==undefined&&(!Array.isArray(selected)||selected.some(x=>!['music_interest','music_exam','art_interest','art_exam'].includes(x))||new Set(selected).size!==selected.length)) fail(422,'学科包不正确','validation_failed');
  if(d.modules&&(typeof d.modules!=='object'||Array.isArray(d.modules)||Object.entries(d.modules).some(([k,v])=>!['content','plans','growth_reports','school_db'].includes(k)||typeof v!=='boolean'))) fail(422,'模块格式不正确','validation_failed');
  const override=d.ai_override;
  if(override) for(const key of ['fast_daily_limit','deep_daily_limit']) if(override[key]!==null) integer(override[key],key,0,1000000);
  if(d.status!==undefined&&!['active','paused'].includes(d.status)) fail(422,'机构状态不正确','validation_failed');
  const color=d.primary_color??current.primary_color??'#6A35B8';if(!/^#[a-f0-9]{6}$/i.test(color))fail(422,'主色格式不正确','validation_failed');
  return {id,version:d.version,slug,name:string(d.name??current.name,'机构名称',100),expires_at:date,staff_seat_limit:integer(d.staff_seat_limit??current.staff_seat_limit??3,'管理席位',1,10000),
    logo:image(d.logo===undefined?current.logo:d.logo),login_bg:image(d.login_bg===undefined?current.login_bg:d.login_bg),primary_color:color,
    modules:d.modules,subjects:selected,ai_override:override,status:d.status};
}
function image(v) {
  if(v==null||v==='')return null;
  if(typeof v!=='string'||v.length>180000||!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v))fail(422,'品牌图片须为压缩后的PNG/JPEG/WebP','validation_failed');
  let bytes;try {bytes=Uint8Array.from(atob(v.split(',')[1]),c=>c.charCodeAt(0));}catch {fail(422,'图片编码不正确','validation_failed');}
  const type=/^data:image\/(png|jpeg|webp);/.exec(v)[1];
  const valid=type==='png' ? [137,80,78,71,13,10,26,10].every((x,i)=>bytes[i]===x) && String.fromCharCode(...bytes.slice(12,16))==='IHDR'
    : type==='jpeg' ? bytes[0]===255 && bytes[1]===216 && bytes.at(-2)===255 && bytes.at(-1)===217
    : String.fromCharCode(...bytes.slice(0,4))==='RIFF' && String.fromCharCode(...bytes.slice(8,12))==='WEBP';
  if(!valid) fail(422,'图片真实格式不正确','validation_failed');
  return v;
}
