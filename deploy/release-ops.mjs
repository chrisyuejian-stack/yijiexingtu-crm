import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,readlink,realpath,cp,lstat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {request} from 'node:http';
import {setTimeout as sleep} from 'node:timers/promises';
import {parseEnvironmentFile} from '../platform/env-file.mjs';
import {loadConfig} from '../platform/config.mjs';
const execute=promisify(execFile);

export async function productionSettings() {
  if(process.getuid?.()!==0)throw Error('Run version management as root');
  const config=loadConfig(parseEnvironmentFile(await readFile('/etc/yijiexingtu/app.env','utf8'))),appRoot='/opt/yijiexingtu';
  if(config.distDir!==appRoot+'/current/dist'||config.backupPath!==appRoot+'/current/backup-dist/backup-worker.js')throw Error('DIST_DIR/BACKUP_WORKER_PATH must follow /opt/yijiexingtu/current for atomic updates');
  return {appRoot,dataRoot:'/var/lib/yijiexingtu-deploy',dbPath:config.dbPath,maintenanceFlag:'/etc/yijiexingtu/maintenance.flag',service:'yijiexingtu',config};
}
async function probe(port,host) {
  return await new Promise(resolve=>{
    const req=request({host:'127.0.0.1',port,path:'/login',method:'GET',headers:{Host:host,'X-Real-IP':'127.0.0.1'}},response=>{response.resume();response.once('error',()=>resolve(false));response.once('aborted',()=>resolve(false));response.once('end',()=>resolve(response.statusCode===200));});
    req.setTimeout(2000,()=>req.destroy());req.once('error',()=>resolve(false));req.end();
  });
}
export function productionOperations(settings) {
  return {
    async prepareDependencies(directory,previous) {
      const lock=join(directory,'deploy/npm/package-lock.json'),oldLock=join(previous,'deploy/npm/package-lock.json');let copied=false;
      try{
        if((await readFile(lock)).equals(await readFile(oldLock))&&(await lstat(join(previous,'deploy/npm/node_modules'))).isDirectory()){
          await cp(join(previous,'deploy/npm/node_modules'),join(directory,'deploy/npm/node_modules'),{recursive:true,dereference:false,verbatimSymlinks:true});copied=true;
        }
      }catch(error){if(error.code!=='ENOENT')throw error;}
      if(!copied)await execute('npm',['ci','--prefix',join(directory,'deploy/npm'),'--omit=dev','--ignore-scripts','--no-audit','--no-fund','--registry='+ (process.env.NPM_REGISTRY||'https://mirrors.cloud.tencent.com/npm/')],{maxBuffer:2*1024*1024});
      await execute('chown',['-R','root:yxt',directory]);
      // Package data directories/files are already 0750/0640; only copied npm files need no write access.
      await execute('chmod',['-R','g-w,o-rwx',directory]);
    },
    async stopService(){await execute('systemctl',['stop',settings.service]);},
    async startService(){await execute('systemctl',['restart',settings.service]);},
    async healthCheck(directory){
      const until=Date.now()+200000,expected=await realpath(directory);
      while(Date.now()<until){
        try{
          const result=await execute('systemctl',['show',settings.service,'--property=MainPID','--value']);const pid=Number(result.stdout.trim());
          // A 200 from a surviving OLD process is not a successful new release.
          if(pid>0&&await realpath('/proc/'+pid+'/cwd')===expected&&await probe(settings.config.port,settings.config.vars.TENANT_HOST))return true;
        }catch{}
        await sleep(1000);
      }
      return false;
    }
  };
}
