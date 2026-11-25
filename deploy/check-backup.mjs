import {DatabaseSync} from 'node:sqlite';
import {pathToFileURL} from 'node:url';
export function checkBackup(path,at=Date.now()) {
  const db=new DatabaseSync(path,{readOnly:true});
  try{const last=db.prepare("SELECT MAX(at) at FROM backup_runs WHERE status='completed'").get().at;const ok=last!==null&&last<=at&&at-last<=26*3600000;return {level:ok?'info':'ERROR',event:'backup_freshness',ok,lastSuccessfulAt:last?new Date(last).toISOString():null,maxAgeHours:26};}finally{db.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{const path=process.argv[2]||process.env.DB_PATH;if(!path)throw Error('DB_PATH required');const result=checkBackup(path);console.log(JSON.stringify(result));if(!result.ok)process.exitCode=1;}catch(error){console.error('ERROR backup check failed:',error.message);process.exitCode=1;}}
