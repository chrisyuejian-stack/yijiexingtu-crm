import {logger,safeError} from './log.mjs';
export const crons=['0 19 * * *','*/5 * * * *'];
export function matchingCrons(at) {
  const date=new Date(at),out=[];
  if(date.getUTCHours()===19&&date.getUTCMinutes()===0)out.push(crons[0]);
  if(date.getUTCMinutes()%5===0)out.push(crons[1]);
  return out;
}
export class CronScheduler {
  constructor(worker,makeEnv,{now=Date.now,log=logger}={}) {
    this.worker=worker;this.makeEnv=makeEnv;this.now=now;this.log=log;
    this.lastMinute=Math.floor(now()/60000);this.active=null;this.timer=null;this.stopped=false;
  }
  start() {
    if(this.timer)return;
    this.lastMinute=Math.floor(this.now()/60000); // Never replay downtime or the current minute.
    this.stopped=false;
    const arm=()=>{this.timer=setTimeout(()=>{if(!this.stopped){void this.tick();arm();}},60000-this.now()%60000);this.timer.unref();};arm();
  }
  async tick(at=this.now()) {
    const minute=Math.floor(at/60000);
    if(this.stopped||minute<=this.lastMinute)return;
    this.lastMinute=minute;
    const matches=matchingCrons(minute*60000);if(!matches.length)return;
    if(this.active){this.log({level:'warn',event:'cron_skipped_busy',minute:minute*60000});return;}
    this.active=this.run(matches,minute*60000);
    try{await this.active;}finally{this.active=null;}
  }
  async run(matches,at) {
    for(const cron of matches) {
      const tasks=[];
      try {
        await this.worker.scheduled({cron,scheduledTime:at},this.makeEnv(),{waitUntil:p=>tasks.push(Promise.resolve(p).then(()=>({}),error=>({error})))});
        while(tasks.length){const results=await Promise.all(tasks.splice(0));const failed=results.find(x=>x.error);if(failed)throw failed.error;}
        this.log({level:'info',event:'cron_completed',cron,scheduledTime:at});
      } catch(error){await Promise.allSettled(tasks);this.log({level:'error',event:'cron_failed',cron,...safeError(error)});}
    }
  }
  async stop() {this.stopped=true;if(this.timer)clearTimeout(this.timer);this.timer=null;await this.active;}
}
