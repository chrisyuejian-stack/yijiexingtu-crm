import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {loadConfig} from '../platform/config.mjs';
import {createBuckets} from '../platform/r2-cos.mjs';
import {verifyDatabase} from '../platform/verify.mjs';

export function parseCounts(value) {
  if(value.results)value=value.results;
  if(Array.isArray(value)&&value.length===1&&value[0].results)value=value[0].results;
  if(Array.isArray(value)&&value.length===1&&value[0].counts!==undefined)value=value[0].counts;
  if(value&&typeof value==='object'&&!Array.isArray(value)&&value.counts!==undefined)value=value.counts;
  if(typeof value==='string')value=JSON.parse(value);
  if(Array.isArray(value))return Object.fromEntries(value.map(x=>[x.table_name,Number(x.row_count)]));
  return value;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try {
    const args=process.argv.slice(2),config=loadConfig();
    const path=args.find(x=>!x.startsWith('--'))||config.dbPath,index=args.indexOf('--counts');
    if(index<0||!args[index+1])throw Error('Supply --counts source-counts.json copied from the same D1 export window');
    const expectedCounts=parseCounts(JSON.parse(await readFile(args[index+1],'utf8'))),buckets=await createBuckets(config);
    const result=await verifyDatabase(path,config.vars.FIELD_KEY,{expectedCounts,media:buckets.media});
    console.log(JSON.stringify(result,null,2));
    // Login uses the existing UI and its TOTP; never ask for password in CLI or logs.
    console.log('LOGIN CHECK: perform tenant login and ops Basic Auth + password + TOTP in browser before acceptance.');
    if(!result.ok)process.exitCode=1;
  }catch(error){console.error('VERIFY FAILED:',error.message);process.exitCode=1;}
}
