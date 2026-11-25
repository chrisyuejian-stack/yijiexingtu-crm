import {resolve} from 'node:path';
import {createReleasePackage} from './release-package.mjs';
try{
  const args=process.argv.slice(2),option=name=>{const i=args.indexOf(name);if(i<0)return undefined;if(!args[i+1]||args[i+1].startsWith('--'))throw Error('Missing '+name+' value');return args[i+1];};
  const version=option('--version'),output=resolve(option('--output')||'deploy/packages/yijiexingtu-tencent-'+(version||Date.now())+'.zip');
  const result=await createReleasePackage(process.cwd(),output,{version});console.log(JSON.stringify(result,null,2));
}catch(error){console.error('PACKAGE FAILED:',error.message);process.exitCode=1;}
