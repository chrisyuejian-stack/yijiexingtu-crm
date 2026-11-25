import {readFile} from 'node:fs/promises';
try{
 const [media,backups]=process.argv.slice(2);if(!media||!backups||media===backups)throw Error('Supply two distinct Shanghai bucket names ending in -APPID');const pattern=/^[a-z0-9][a-z0-9-]*-(\d+)$/,a=pattern.exec(media),b=pattern.exec(backups);if(!a||!b||a[1]!==b[1])throw Error('Bucket names must share the same account APPID');
 const template=JSON.parse(await readFile(new URL('./cam-role-policy.template.json',import.meta.url),'utf8'));
 template.statement[0].resource=[media,backups].map(bucket=>'qcs::cos:ap-shanghai:uid/'+a[1]+':'+bucket+'/');template.statement[1].resource=template.statement[0].resource.map(x=>x+'*');console.log(JSON.stringify(template,null,2));
}catch(error){console.error('POLICY FAILED:',error.message);process.exitCode=1;}
