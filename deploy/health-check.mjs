import {readFile,writeFile,rename} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
export async function healthCheck({url='https://edu.yijiexingtu.com/login',state='/var/lib/yijiexingtu/health-state.json',fetchImpl=fetch}={}) {
  let failures=0;try{failures=Number(JSON.parse(await readFile(state,'utf8')).failures)||0;}catch{}
  let ok=false;try{const response=await fetchImpl(url,{redirect:'manual',signal:AbortSignal.timeout(20000)});ok=response.status===200;await response.body?.cancel();}catch{}
  failures=ok?0:failures+1;const result={level:ok?'info':failures>=3?'ERROR':'warn',event:'public_health',ok,failures,alarm:failures>=3};
  const temp=state+'.tmp-'+crypto.randomUUID();await writeFile(temp,JSON.stringify({failures}),{mode:0o600});await rename(temp,state);return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{const result=await healthCheck();console.log(JSON.stringify(result));if(result.alarm)process.exitCode=1;}catch(error){console.error('ERROR health probe state failed:',error.name);process.exitCode=1;}}
