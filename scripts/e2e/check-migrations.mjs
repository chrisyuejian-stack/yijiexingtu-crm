// Disposable local database only: this script never reads remote D1 bindings or credentials.
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root=fileURLToPath(new URL('../../',import.meta.url));
const db=new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys=ON');
const files=readdirSync(path.join(root,'migrations')).filter(f=>/^\d{4}_.+\.sql$/.test(f)).sort();
const migrations=[];
try {
  for(const file of files){
    const sql=readFileSync(path.join(root,'migrations',file));db.exec(sql.toString());
    migrations.push({file,bytes:sql.length,sha256:createHash('sha256').update(sql).digest('hex')});
  }
  const objects=db.prepare("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
  const counts=Object.fromEntries(['table','view','index','trigger'].map(type=>[type,objects.filter(x=>x.type===type).length]));
  const integrity=db.prepare('PRAGMA integrity_check').all(), foreignKeys=db.prepare('PRAGMA foreign_key_check').all();
  if(integrity.length!==1||integrity[0].integrity_check!=='ok'||foreignKeys.length)throw Error('Migration integrity check failed');
  const out=path.resolve(root,process.env.MIGRATION_REPORT_DIR||'work/migration-preflight');
  mkdirSync(out,{recursive:true});
  writeFileSync(path.join(out,'report.json'),JSON.stringify({scope:'本地空库顺序执行全部迁移；没有连接远端数据库',migrations,counts,integrity,foreignKeys,objects},null,2));
  const quote=s=>"'"+s.replaceAll("'","''")+"'";
  const expected='WITH expected(type,name) AS (VALUES\n'+objects.map(x=>'  ('+quote(x.type)+','+quote(x.name)+')').join(',\n')+'\n)\n';
  const sql='-- 只读；逐条执行完整查询，不按分号拆开迁移触发器。\n-- 只统计源码列出的对象，不包含 Cloudflare 系统对象。\n\n'+expected+
    "SELECT e.type,COUNT(*) AS expected_count,SUM(CASE WHEN s.name IS NOT NULL THEN 1 ELSE 0 END) AS present_count FROM expected e LEFT JOIN sqlite_master s ON s.type=e.type AND s.name=e.name GROUP BY e.type ORDER BY e.type;\n\n"+expected+
    "SELECT e.type,e.name AS missing_object FROM expected e LEFT JOIN sqlite_master s ON s.type=e.type AND s.name=e.name WHERE s.name IS NULL;\n\nPRAGMA foreign_key_check;\n";
  writeFileSync(path.join(out,'当前版本部署结构核验.sql'),sql);
  // Verify the generated read-only queries against the same complete schema.
  const statements=sql.split(';').map(x=>x.trim()).filter(Boolean);
  const found=db.prepare(statements[0]).all();
  if(found.some(x=>x.expected_count!==x.present_count)||db.prepare(statements[1]).all().length)throw Error('Generated schema check mismatch');
  console.log(JSON.stringify({migrations:migrations.length,lastMigration:files.at(-1),counts,foreignKeys:foreignKeys.length,integrity:'ok',reportDir:out},null,2));
} finally {db.close();}
