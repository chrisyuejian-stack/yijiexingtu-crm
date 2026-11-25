import {createInterface} from 'node:readline/promises';
import {Writable} from 'node:stream';
import {readFile,writeFile,chmod} from 'node:fs/promises';
import {parseEnvironmentFile,encodeEnvironmentValue} from '../platform/env-file.mjs';
import {randomBytes} from 'node:crypto';
if(process.getuid?.()!==0){console.error('请用root运行配置助手。');process.exitCode=1;}
else {
 let silent=false;const output=new Writable({write(chunk,_encoding,callback){if(!silent)process.stdout.write(chunk);callback();}}),rl=createInterface({input:process.stdin,output,terminal:true});
 try {
  const template=await readFile(new URL('./app.env.example',import.meta.url),'utf8'),vars=parseEnvironmentFile(template);
  for(const key of ['FIELD_KEY','BACKUP_KEY','HMAC_KEY','PW_PEPPER','PLATFORM_PHONE_HMAC_KEY','DEEPSEEK_API_KEY']){
    process.stdout.write(key+(key==='DEEPSEEK_API_KEY'?'（现有或新建的DeepSeek Key）':'（必须是原值）')+'：');silent=true;const value=await rl.question('');silent=false;process.stdout.write('\n');if(!value)throw Error(key+' 不能为空');vars[key]=value;
  }
  vars.PLATFORM_SETUP_KEY=randomBytes(32).toString('base64');
  for(const key of ['COS_BUCKET_MEDIA','COS_BUCKET_BACKUPS']){const value=await rl.question(key+'（完整桶名，含-APPID）：');if(!value)throw Error(key+' 不能为空');vars[key]=value.trim();}
  const path='/etc/yijiexingtu/app.env';
  try{const old=await readFile(path);await writeFile(path+'.previous-'+Date.now(),old,{flag:'wx',mode:0o600});}catch(error){if(error.code!=='ENOENT')throw error;}
  await writeFile(path,Object.entries(vars).map(([key,value])=>key+'='+encodeEnvironmentValue(value)).join('\n')+'\n',{mode:0o600});await chmod(path,0o600);
  console.log('配置已保存，未打印密钥、未启动服务。默认使用上海实例角色；后续解密/登录/备份核对仍必须通过。');
 }catch(error){silent=false;console.error('配置未完成：',error.message);process.exitCode=1;}finally{rl.close();}
}
