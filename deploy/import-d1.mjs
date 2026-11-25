import {DatabaseSync} from 'node:sqlite';
import {readFile,chmod,link,unlink,stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {splitSql,statementInfo} from '../platform/sql.mjs';

export async function importD1(input,output) {
  try{await stat(output);throw Error('Output already exists; import always creates a NEW database');}catch(e){if(e.code!=='ENOENT')throw e;}
  const statements=splitSql(await readFile(input,'utf8')).map(sql=>({sql,...statementInfo(sql)}));
  const accepted=statements.filter(x=>x.kind!=='control'&&!x.internal);
  if(!accepted.some(x=>x.kind==='table'&&x.table==='tenants'))throw Error('Not a complete business database export');
  const temp=output+'.import-'+crypto.randomUUID();let db;
  try {
    db=new DatabaseSync(temp,{enableForeignKeyConstraints:true});await chmod(temp,0o600);
    db.exec('PRAGMA foreign_keys=ON; BEGIN IMMEDIATE; PRAGMA defer_foreign_keys=ON;');
    // Restore data before triggers, so importing a historical row cannot fire an
    // application INSERT trigger or revoke historical sessions accidentally.
    for(const kind of ['table','data','view','index','trigger'])for(const entry of accepted.filter(x=>x.kind===kind))db.exec(entry.sql);
    if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('Imported foreign keys are invalid');
    const integrity=db.prepare('PRAGMA integrity_check').all();
    if(integrity.length!==1||Object.values(integrity[0])[0]!=='ok')throw Error('Imported integrity_check failed');
    db.exec('COMMIT');db.close();db=null;await link(temp,output);await unlink(temp);
    return {output,statements:accepted.length,skipped:statements.length-accepted.length,integrity:'ok',foreignKeys:0};
  } catch(error){try{db?.exec('ROLLBACK');}catch{}db?.close();await unlink(temp).catch(()=>{});throw error;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{const [input,output]=process.argv.slice(2);if(!input||!output)throw Error('Usage: node deploy/import-d1.mjs d1.sql /new/path/rehearsal.sqlite');console.log(JSON.stringify(await importD1(resolve(input),resolve(output))));}
  catch(error){console.error('IMPORT FAILED:',error.message);process.exitCode=1;}
}
