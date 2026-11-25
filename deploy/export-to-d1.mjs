import {DatabaseSync} from 'node:sqlite';
import {open,unlink} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {quoteIdentifier,sqlValue} from '../platform/sql.mjs';

export async function exportToD1(input,output,{replaceExisting=false}={}) {
  const file=await open(output,'wx',0o600),db=new DatabaseSync(input,{readOnly:true});
  try {
    db.exec('BEGIN');
    const schema=db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE type IN('table','view','index','trigger') AND sql IS NOT NULL ORDER BY type,name").all().filter(x=>! /^(?:sqlite_|_cf_|d1_migrations$)/i.test(x.name)&&! /^(?:sqlite_|_cf_|d1_migrations$)/i.test(x.tbl_name));
    const tables=schema.filter(x=>x.type==='table');
    await file.write('-- Generated from a consistent SQLite read transaction. Keep offline and private.\nPRAGMA defer_foreign_keys=ON;\n');
    if(replaceExisting){
      // Explicit opt-in only: transiently disable application triggers while rows
      // are replaced; re-create the exact source trigger SQL afterwards.
      for(const t of schema.filter(x=>x.type==='trigger'))await file.write('DROP TRIGGER IF EXISTS '+quoteIdentifier(t.name)+';\n');
      for(const t of [...tables].reverse())await file.write('DELETE FROM '+quoteIdentifier(t.name)+';\n');
    }else for(const t of tables)await file.write(t.sql+';\n');
    const counts={};
    for(const t of tables){
      const columns=db.prepare('PRAGMA table_info('+quoteIdentifier(t.name)+')').all().map(x=>x.name),statement=db.prepare('SELECT * FROM '+quoteIdentifier(t.name));statement.setReadBigInts(true);let count=0;
      for(const row of statement.iterate()){await file.write('INSERT INTO '+quoteIdentifier(t.name)+'('+columns.map(quoteIdentifier).join(',')+') VALUES('+columns.map(k=>sqlValue(row[k])).join(',')+');\n');count++;}
      counts[t.name]=count;
    }
    for(const x of schema.filter(x=>x.type!=='table'&&(!replaceExisting||x.type==='trigger')))await file.write(x.sql+';\n');
    db.exec('COMMIT');return {tables:tables.length,counts,mode:replaceExisting?'replace-existing-rows':'new-empty-database'};
  }catch(error){await file.close();await unlink(output).catch(()=>{});throw error;}
  finally{db.close();await file.close().catch(()=>{});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const [input,output,...args]=process.argv.slice(2);
  try{if(!input||!output)throw Error('Usage: node deploy/export-to-d1.mjs input.sqlite rollback.sql [--replace-existing --confirm-offline-replacement]');const replaceExisting=args.includes('--replace-existing');if(replaceExisting&&!args.includes('--confirm-offline-replacement'))throw Error('Replacement requires --confirm-offline-replacement. Never run against a live writable database.');console.log(JSON.stringify(await exportToD1(input,output,{replaceExisting})));}
  catch(error){console.error('EXPORT FAILED:',error.message);process.exitCode=1;}
}
