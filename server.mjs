import {pathToFileURL} from 'node:url';
import {open,unlink,readFile} from 'node:fs/promises';
import {SqliteD1} from './platform/d1-sqlite.mjs';
import {loadConfig,existingDatabase,checkDatabase,checkBuild,checkBuckets} from './platform/config.mjs';
import {loadAssets} from './platform/assets.mjs';
import {createBuckets} from './platform/r2-cos.mjs';
import {createBridge} from './platform/bridge.mjs';
import {CronScheduler} from './platform/scheduler.mjs';
import {logger,safeError} from './platform/log.mjs';

// Match the UTC default of the original Workers runtime; business code applies CST explicitly.
process.env.TZ='UTC';

async function acquireLock(path) {
  const filename=path+'.node-lock';
  for(let attempt=0;attempt<2;attempt++){
    try {const file=await open(filename,'wx',0o600);await file.writeFile(String(process.pid));return async()=>{await file.close();await unlink(filename);};}
    catch(error){if(error.code!=='EEXIST')throw error;
      const pid=Number(await readFile(filename,'utf8'));
      if(!Number.isInteger(pid)||pid<1)throw Error('Database process lock requires operator inspection');
      try{process.kill(pid,0);throw Error('Another process owns DB_PATH');}catch(e){if(e.code!=='ESRCH')throw e;}
      await unlink(filename);
    }
  }
  throw Error('Could not acquire database process lock');
}
export async function startServer({config=loadConfig(),sdkFactory,fetchImpl,log=logger,startScheduler=true,port=config.port,shutdownMs=20000}={}) {
  await existingDatabase(config.dbPath);
  const release=await acquireLock(config.dbPath);let db,server,scheduler;
  try {
    db=new SqliteD1(config.dbPath);await checkDatabase(db);
    const build=await checkBuild(config),buckets=await createBuckets(config,{sdkFactory,fetchImpl});await checkBuckets(buckets);
    const [worker,backupWorker,assets]=await Promise.all([import(pathToFileURL(build.workerPath).href),import(pathToFileURL(config.backupPath).href),loadAssets(config.distDir)]);
    const bindings={CHANNEL_DB:db,CHANNEL_MEDIA:buckets.media,CHANNEL_BACKUPS:buckets.backups,ASSETS:assets};
    const makeEnv=()=>({...bindings,...config.vars});
    scheduler=new CronScheduler(backupWorker.default,makeEnv,{log});
    server=createBridge(worker.default,bindings,config.vars,{maxBodyBytes:config.maxBodyBytes,log});
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
    if(startScheduler)scheduler.start();
    log({level:'info',event:'started',address:'127.0.0.1',port:server.address().port,migration:'0028',workerSha256:build.workerSha256,backupSha256:build.backupSha256,cosAuth:config.cos.auth});
    let closing;
    return {server,db,scheduler,bindings,makeEnv,build,close(){
      if(closing)return closing;
      closing=(async()=>{
        let deadline;const expired=new Promise(resolve=>{deadline=setTimeout(()=>{server.closeAllConnections();log({level:'warn',event:'shutdown_deadline'});resolve();},shutdownMs);});
        try{await Promise.race([Promise.all([new Promise(resolve=>{server.close(resolve);server.closeIdleConnections();}),scheduler.stop()]),expired]);}
        finally{clearTimeout(deadline);db.close();await release();}
      })();return closing;
    }};
  } catch(error) {server?.closeAllConnections();server?.close();await scheduler?.stop();db?.close();await release();throw error;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {
    const app=await startServer();let stopping=false;
    const stop=async()=>{if(stopping)return;stopping=true;const hard=setTimeout(()=>process.exit(1),21000);hard.unref();try{await app.close();clearTimeout(hard);process.exit(0);}catch(error){logger({level:'error',event:'shutdown_failed',...safeError(error)});clearTimeout(hard);process.exit(1);}};
    process.once('SIGTERM',stop);process.once('SIGINT',stop);
  }catch(error){logger({level:'error',event:'startup_failed',reason:error.message,...safeError(error)});process.exitCode=1;}
}
