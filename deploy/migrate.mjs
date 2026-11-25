import {DatabaseSync} from 'node:sqlite';
import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {splitSql,stripComments} from '../platform/sql.mjs';
import {hashBytes} from './release-package.mjs';

export async function migrationFiles(directory) {
  const files=[];
  for(const name of (await readdir(directory)).sort()){
    const match=/^(\d{4})_[a-z0-9_]+\.sql$/.exec(name);if(!match)throw Error('Unexpected migration filename: '+name);
    const data=await readFile(join(directory,name));files.push({version:Number(match[1]),name,sha256:hashBytes(data),sql:data.toString('utf8')});
  }
  files.forEach((file,i)=>{if(file.version!==i+1)throw Error('Migration versions must be contiguous and unique');});return files;
}
function canonicalSql(sql) {
  const tokens=[];let i=0;
  while(i<sql.length){
    if(/\s/.test(sql[i])){i++;continue;}
    if(sql.slice(i,i+2)==='--'){const end=sql.indexOf('\n',i);i=end<0?sql.length:end+1;continue;}
    if(sql.slice(i,i+2)==='/*'){const end=sql.indexOf('*/',i+2);if(end<0)throw Error('Unterminated SQL comment');i=end+2;continue;}
    const quote=sql[i];
    if(['\'', '"','`','['].includes(quote)){
      const end=quote==='['?']':quote;let value='';i++;
      for(;i<sql.length;i++){if(sql[i]===end){if(sql[i+1]===end){value+=end;i++;continue;}i++;break;}value+=sql[i];}
      tokens.push(quote==='\''?"'"+value+"'":value.toLowerCase());continue;
    }
    const word=/^[A-Za-z0-9_]+/.exec(sql.slice(i));if(word){tokens.push(word[0].toLowerCase());i+=word[0].length;}else tokens.push(sql[i++]);
  }
  return tokens.join(' ');
}
function schema(db) {
  return db.prepare("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND type IN('table','view','index','trigger') ORDER BY type,name").all().filter(x=>! /^(?:sqlite_|_cf_|d1_migrations$|schema_migrations$)/i.test(x.name)).map(x=>[x.type,x.name,canonicalSql(x.sql)]);
}
export async function recognizeLegacy28(db,legacyDirectory) {
  const files=(await migrationFiles(legacyDirectory)).slice(0,28);if(files.length!==28)throw Error('Cannot recognize legacy database without original 0001–0028');
  const baseline=JSON.parse(await readFile(new URL('./baseline-sha256.json',import.meta.url),'utf8'));
  for(const file of files)if(baseline['migrations/'+file.name]!==file.sha256)throw Error('Original migration hash mismatch; refusing legacy inference');
  const reference=new DatabaseSync(':memory:',{enableForeignKeyConstraints:true});
  try{for(const file of files)reference.exec(file.sql);if(JSON.stringify(schema(reference))!==JSON.stringify(schema(db)))throw Error('Untracked database is not the complete known v0.5/0028 schema; refusing to replay historical migrations');}
  finally{reference.close();}
  return files;
}
function checkIntegrity(db) {
  const rows=db.prepare('PRAGMA quick_check').all();if(rows.length!==1||Object.values(rows[0])[0]!=='ok')throw Error('Migration quick_check failed');
  if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('Migration foreign_key_check failed');
}
function validateTransactionSql(file) {
  for(const statement of splitSql(file.sql)){
    const value=stripComments(statement);
    if(/^(?:BEGIN|COMMIT|END|ROLLBACK|SAVEPOINT|RELEASE|VACUUM|ATTACH|DETACH)\b/i.test(value)||/^PRAGMA\s+(?:foreign_keys\s*=\s*(?:OFF|0)|journal_mode)\b/i.test(value))throw Error('Migration must not control the deployment transaction: '+file.name);
    if(/\b(?:CREATE|ALTER|DROP)\s+TABLE\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?["`\[]?schema_migrations\b/i.test(value))throw Error('schema_migrations is owned by deployment tooling');
  }
}
export async function migrationPlan(path,files,legacyDirectory) {
  const db=new DatabaseSync(path,{readOnly:true,enableForeignKeyConstraints:true});
  try {
    db.exec('PRAGMA busy_timeout=5000');checkIntegrity(db);
    const tracked=!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get();
    let applied;
    if(tracked){
      const columns=db.prepare('PRAGMA table_info(schema_migrations)').all().map(x=>x.name);
      if(!['version','name','sha256','applied_at','release','bootstrap'].every(x=>columns.includes(x)))throw Error('Unknown schema_migrations format');
      applied=db.prepare('SELECT version,name,sha256 FROM schema_migrations ORDER BY version').all();if(!applied.length)throw Error('Empty migration ledger cannot prove a database version');
    }else applied=await recognizeLegacy28(db,legacyDirectory);
    applied.forEach((row,i)=>{if(row.version!==i+1||files[i]?.name!==row.name||files[i]?.sha256!==row.sha256)throw Error('Applied migration missing/changed or target is a downgrade: '+row.version);});
    const pending=files.slice(applied.length);pending.forEach(validateTransactionSql);
    return {tracked,version:applied.length,applied:applied.map(x=>({version:x.version,name:x.name,sha256:x.sha256})),pending:pending.map(x=>x.version)};
  }finally{db.close();}
}
export async function applyMigrations(path,files,legacyDirectory,release) {
  const plan=await migrationPlan(path,files,legacyDirectory),db=new DatabaseSync(path,{enableForeignKeyConstraints:true});
  try {
    db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; BEGIN IMMEDIATE; PRAGMA defer_foreign_keys=ON;');
    db.exec('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL UNIQUE,sha256 TEXT NOT NULL,applied_at INTEGER NOT NULL,release TEXT NOT NULL,bootstrap INTEGER NOT NULL DEFAULT 0 CHECK(bootstrap IN(0,1)))');
    const insert=db.prepare('INSERT INTO schema_migrations(version,name,sha256,applied_at,release,bootstrap) VALUES(?,?,?,?,?,?)');
    if(!plan.tracked)for(const row of plan.applied)insert.run(row.version,row.name,row.sha256,Date.now(),release,1);
    const current=db.prepare('SELECT version,name,sha256 FROM schema_migrations ORDER BY version').all();
    if(JSON.stringify(current.map(x=>({...x})))!==JSON.stringify(plan.applied))throw Error('Migration ledger changed after preflight');
    for(const file of files.filter(x=>x.version>plan.version)){
      db.exec('SAVEPOINT deployment_migration');
      try{db.exec(file.sql);insert.run(file.version,file.name,file.sha256,Date.now(),release,0);db.exec('RELEASE deployment_migration');}
      catch(error){try{db.exec('ROLLBACK TO deployment_migration; RELEASE deployment_migration');}catch{}throw error;}
    }
    checkIntegrity(db);db.exec('COMMIT');
    return {bootstrapped:!plan.tracked?plan.version:0,applied:plan.pending,version:files.length};
  }catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}
  finally{db.close();}
}
export function ledgerVersion(path) {
  const db=new DatabaseSync(path,{readOnly:true});try{if(!db.prepare("SELECT 1 FROM sqlite_master WHERE name='schema_migrations' AND type='table'").get())return null;return Number(db.prepare('SELECT MAX(version) version FROM schema_migrations').get().version||0);}finally{db.close();}
}
