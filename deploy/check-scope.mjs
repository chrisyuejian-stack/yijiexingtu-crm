import {readFile,readdir,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
const sha=data=>createHash('sha256').update(data).digest('hex');
const root=new URL('../',import.meta.url);
const before=JSON.parse(await readFile(new URL('./baseline-sha256.json',import.meta.url),'utf8')),changed=[],deleted=[];
for(const [path,hash] of Object.entries(before)){try{if(sha(await readFile(new URL(path,root)))!==hash)changed.push(path);}catch(error){if(error.code==='ENOENT')deleted.push(path);else throw error;}}
const original=JSON.parse(await readFile(new URL('package.json',root),'utf8')),removeAdded=structuredClone(original);delete removeAdded.scripts.start;delete removeAdded.scripts['test:platform'];delete removeAdded.scripts['package:tencent'];delete removeAdded.dependencies;
const expectedBasePath=new URL('./reference/base-package.json',import.meta.url),basePackage=JSON.parse(await readFile(expectedBasePath,'utf8'));
const validPackage=JSON.stringify(removeAdded)===JSON.stringify(basePackage)&&JSON.stringify(original.dependencies)===JSON.stringify({'cos-nodejs-sdk-v5':'3.0.0'})&&original.scripts.start==='node --max-old-space-size=768 server.mjs'&&original.scripts['test:platform']==='node --test tests/platform/*.test.mjs'&&original.scripts['package:tencent']==='npm run build && node deploy/package-tencent.mjs';
const added=[],ignored=new Set(['node_modules','work','dist','backup-dist','.git','.wrangler']);
async function walk(path=''){for(const entry of await readdir(new URL(path||'.',root),{withFileTypes:true})){if(ignored.has(entry.name)||path==='deploy/'&&entry.name==='packages')continue;const file=join(path,entry.name);if(entry.isDirectory())await walk(file+'/');else if(entry.isFile()&&!Object.hasOwn(before,file))added.push(file);}}
await walk();
const invalidAdded=added.filter(p=>!(p.startsWith('platform/')||p.startsWith('deploy/')||p.startsWith('tests/platform/')||p==='server.mjs'));
const result={baselineFiles:Object.keys(before).length,changed,deleted,added:added.sort(),invalidAdded,packageOnlyAllowedAdditions:validPackage,protectedFilesUnchanged:changed.every(p=>p==='package.json')&&deleted.length===0,ok:validPackage&&changed.every(p=>p==='package.json')&&!deleted.length&&!invalidAdded.length};
await mkdir(new URL('./verification/',import.meta.url),{recursive:true});
await writeFile(new URL('./verification/scope.json',import.meta.url),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({ok:result.ok,changed,added:added.length,invalidAdded,deleted}));if(!result.ok)process.exitCode=1;
