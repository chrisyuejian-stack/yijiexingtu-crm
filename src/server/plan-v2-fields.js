export function v2TeacherIds(doc){return [...new Set(doc.modules.teachers.groups.flatMap(g=>g.members.map(x=>x.teacher_id)).filter(Boolean))];}
export function v2Images(doc,visibleOnly=false){
    const m=doc.modules,ids=[];
    if(!visibleOnly||m.basic.visible&&m.basic.cover_visible)if(doc.style?.cover_image_id)ids.push(doc.style.cover_image_id);
    if(!visibleOnly||m.about.visible)ids.push(...m.about.image_ids);
    if(!visibleOnly||m.photos.visible)ids.push(...m.photos.pages.flatMap(x=>x.image_ids));
    if(!visibleOnly||m.teachers.visible)ids.push(...m.teachers.groups.flatMap(g=>g.members.map(t=>t.photo_image_id).filter(Boolean)));
    return [...new Set(ids)];
}
export function v2Sources(doc){return {courses:[...new Set(doc.modules.courses.lines.flatMap(l=>[l.course_id,l.origin_course_id]).filter(Boolean))],stages:[...new Set(doc.modules.path.stages.map(s=>s.stage_type_id).filter(Boolean))],teachers:v2TeacherIds(doc),images:v2Images(doc),student_id:doc.student_id??null,lead_id:doc.source_lead_id??null};}
export function v2Declarations(doc){const m=doc.modules,out=[],push=(row,field,kind)=>out.push({row,field,kind,id:row[field]});
    for(const s of m.path.stages){push(s,'key','stage');for(const n of s.nodes||[])push(n,'id','node');}
    for(const s of m.assessment.scores||[])push(s,'id','score');
    for(const t of m.timeline.items)push(t,'id','node');
    for(const g of m.courses.groups)push(g,'id','group');
    for(const l of m.courses.lines)push(l,'line_id','line');
    for(const g of m.teachers.groups){push(g,'id','teacher_group');for(const t of g.members)push(t,'id','teacher');}
    for(const g of m.goals.groups){push(g,'id','goal_group');for(const t of g.items)push(t,'id','goal');}
    for(const p of m.photos.pages)push(p,'id','photo');
    for(const f of [...m.fees.stage_extras,...m.fees.other_fees])push(f,'id','fee');
    for(const f of m.fees.fixed)push(f,'id','installment');return out;
}
