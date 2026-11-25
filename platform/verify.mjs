import {DatabaseSync} from 'node:sqlite';
import {quoteIdentifier} from './sql.mjs';

export function businessTables(db) {return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT IN('d1_migrations','schema_migrations') ORDER BY name").all().map(x=>x.name);}
export const rowCounts=db=>Object.fromEntries(businessTables(db).map(table=>[table,Number(db.prepare('SELECT COUNT(*) n FROM '+quoteIdentifier(table)).get().n)]));
export const countSql=tables=>tables.map(name=>"SELECT '"+name.replaceAll("'","''")+"' AS table_name,COUNT(*) AS row_count FROM "+quoteIdentifier(name)).join(' UNION ALL ')+';';
export async function decryptValue(key,value,context) {
  const parts=value.split('.');if(parts.length!==3||parts[0]!=='v1')throw Error('Encrypted field format invalid');
  const cryptoKey=await crypto.subtle.importKey('raw',Buffer.from(key,'base64'),{name:'AES-GCM'},false,['decrypt']);
  await crypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(parts[1],'base64'),additionalData:new TextEncoder().encode(context)},cryptoKey,Buffer.from(parts[2],'base64'));
}
export async function verifyDatabase(path,fieldKey,{expectedCounts,media,sampleSize=20}={}) {
  const db=new DatabaseSync(path,{readOnly:true,enableForeignKeyConstraints:true});
  try {
    const integrity=db.prepare('PRAGMA integrity_check').all(),foreignKeys=db.prepare('PRAGMA foreign_key_check').all();
    const counts=rowCounts(db),countErrors=[];
    if(expectedCounts){for(const key of new Set([...Object.keys(counts),...Object.keys(expectedCounts)]))if(counts[key]!==Number(expectedCounts[key]))countErrors.push(key);}
    const fields=[];
    const collect=(table,column,context,columns='tenant_id,id')=>{
      if(!Object.hasOwn(counts,table))return;
      if(!db.prepare('PRAGMA table_info('+quoteIdentifier(table)+')').all().some(x=>x.name===column))return;
      const rows=db.prepare('SELECT '+columns+','+quoteIdentifier(column)+' AS cipher FROM '+quoteIdentifier(table)+' WHERE '+quoteIdentifier(column)+" IS NOT NULL AND "+quoteIdentifier(column)+"<>'' ORDER BY random() LIMIT ?").all(sampleSize);
      for(const r of rows)fields.push({cipher:r.cipher,context:context(r)});
    };
    for(const table of ['users','students','teachers','leads'])for(const column of ['phone_enc','parent_phone_enc'])collect(table,column,r=>r.tenant_id+':phone');
    collect('tenants','contact_enc',r=>r.id+':contact','id');
    collect('platform_admins','totp_enc',()=> 'platform:totp','id');
    collect('plan_prospects','data_enc',r=>r.tenant_id+':plan-prospect:'+r.id,'tenant_id,id');
    collect('plan_briefs','text_enc',r=>r.tenant_id+':plan-brief:'+r.plan_id,'tenant_id,plan_id');
    // Select without repeating an encrypted value. Do not return identifiers or plaintext.
    const candidates=[...new Map(fields.map(x=>[x.context+':'+x.cipher,x])).values()];
    for(let i=candidates.length-1;i>0;i--){const j=crypto.getRandomValues(new Uint32Array(1))[0]%(i+1);[candidates[i],candidates[j]]=[candidates[j],candidates[i]];}
    const sample=candidates.slice(0,sampleSize);let decrypted=0;
    for(const item of sample)try{await decryptValue(fieldKey,item.cipher,item.context);decrypted++;}catch{}
    const pictures=Object.hasOwn(counts,'gallery_images')?db.prepare('SELECT r2_key FROM gallery_images WHERE deleted_at IS NULL ORDER BY random() LIMIT ?').all(sampleSize):[];
    let imagesFound=0;if(media)for(const picture of pictures)if(await media.head(picture.r2_key))imagesFound++;
    const ok=integrity.length===1&&Object.values(integrity[0])[0]==='ok'&&foreignKeys.length===0&&countErrors.length===0&&decrypted===sample.length&&(!media||imagesFound===pictures.length);
    return {ok,integrity:integrity.length===1?Object.values(integrity[0])[0]:'failed',foreignKeyErrors:foreignKeys.length,counts,countMismatchTables:countErrors,decryption:{sampled:sample.length,passed:decrypted,failed:sample.length-decrypted},images:{sampled:pictures.length,passed:media?imagesFound:null,checked:!!media},warnings:[...!expectedCounts?['Source table counts not supplied; count comparison has NOT passed.']:[],...sample.length<sampleSize?['Only '+sample.length+' encrypted values available; all available sampled.']:[],...!media?['COS picture check has NOT run.']:[]]};
  }finally{db.close();}
}
