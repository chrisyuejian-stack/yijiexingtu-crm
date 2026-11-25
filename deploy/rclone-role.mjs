import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {loadConfig} from '../platform/config.mjs';
import {RoleCredentials} from '../platform/cos-auth.mjs';

export async function runRclone(args,config,{spawnImpl=spawn,fetchImpl,log=console.error}={}) {
  if(!args.length)throw Error('Supply rclone arguments');
  const role=config.cos.auth==='role'?new RoleCredentials(config.cos.role,{fetchImpl}):null;
  for(;;){
    const credentials=role?await role.get():{TmpSecretId:config.cos.secretId,TmpSecretKey:config.cos.secretKey};
    const env={...process.env,RCLONE_CONFIG_COS_ACCESS_KEY_ID:credentials.TmpSecretId,RCLONE_CONFIG_COS_SECRET_ACCESS_KEY:credentials.TmpSecretKey,RCLONE_CONFIG_COS_SESSION_TOKEN:credentials.SecurityToken||''};
    for(const key of ['FIELD_KEY','BACKUP_KEY','HMAC_KEY','PW_PEPPER','PLATFORM_PHONE_HMAC_KEY','PLATFORM_SETUP_KEY','DEEPSEEK_API_KEY','COS_SECRET_ID','COS_SECRET_KEY'])delete env[key];
    let rotate=false,timer;
    const child=spawnImpl('rclone',args,{env,stdio:'inherit'});
    if(role){timer=setTimeout(()=>{rotate=true;child.kill('SIGINT');},Math.max(1000,credentials.ExpiredTime*1000-Date.now()-300000));timer.unref();}
    let status;
    try{status=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));});}finally{clearTimeout(timer);}
    if(rotate){log('Refreshing instance-role credentials; resuming incremental rclone command.');continue;}
    if(status.code!==0)throw Error('rclone failed (exit '+status.code+', signal '+(status.signal||'none')+')');
    return;
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{await runRclone(process.argv.slice(2),loadConfig());}catch(error){console.error('RCLONE FAILED:',error.message);process.exitCode=1;}}
