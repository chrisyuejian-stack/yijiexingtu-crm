import {readFile,stat} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {parseEnvironmentFile} from '../platform/env-file.mjs';
try{
 const args=process.argv.slice(2);let file='/etc/yijiexingtu/app.env';if(args[0]==='--file'){args.shift();file=args.shift();}if(args[0]==='--')args.shift();if(!args.length)throw Error('Supply a command after --');
 const metadata=await stat(file);if(process.getuid?.()===0&&metadata.uid!==0)throw Error('Environment file must be owned by root');if((metadata.mode&0o077)!==0)throw Error('Environment file must have mode 0600 (no group/other access)');
 const values=parseEnvironmentFile(await readFile(file,'utf8'));
 const child=spawn(args[0],args.slice(1),{env:{...process.env,...values},stdio:'inherit'});
 child.once('error',()=>{console.error('Command could not start');process.exitCode=1;});child.once('exit',(code,signal)=>{process.exitCode=signal?1:(code??1);});
}catch(error){console.error('ENV RUN FAILED:',error.message);process.exitCode=1;}
