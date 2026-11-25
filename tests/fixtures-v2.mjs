import {blankV2} from '../src/server/plan-v2-convert.js';
import {ok,call} from './fixtures-plans.mjs';
export const coreKeys=['doc_version','student_id','source_lead_id','subject','title','style','meta','module_order','modules','applied_suggestion_ids','computed'];
export const writeDoc=p=>Object.fromEntries(coreKeys.filter(k=>Object.hasOwn(p,k)).map(k=>[k,structuredClone(p[k])]));
export function manualDoc(s,price=200,tbd=false){const d=blankV2({student_id:s.students[0],subject:'music_interest',title:'新版学习方案',style:{pack_id:'stp_folio'},date:'2026-11-17'});d.modules.path.stages=[{key:'tmp_stage',name:'基础巩固',stage_type_id:null,start_month:'2027-01',end_month:'2027-06',goals:[],nodes:[]}];d.modules.courses.lines=[{line_id:'tmp_line',stage_key:'tmp_stage',group_id:null,pricing_source:'manual',course_id:null,name:'手填演奏课',qty:{units:2},manual_unit_price:price,price_tbd:tbd}];return d;}
export const createV2=async(s,d=manualDoc(s))=>ok(await call(s,'plans','POST',{doc:d}),201);
