import {readdir,readFile,realpath} from 'node:fs/promises';
import {join,relative,sep,extname} from 'node:path';

const mime = {'.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.html':'text/html; charset=utf-8','.json':'application/json; charset=utf-8','.txt':'text/plain; charset=utf-8'};
export async function loadAssets(directory) {
  const root = await realpath(directory), files = new Map();
  async function visit(dir) {
    for (const entry of await readdir(dir, {withFileTypes:true})) {
      const file = join(dir,entry.name);
      if (entry.isSymbolicLink()) throw Error('ASSETS symlinks are not allowed');
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile()) {
        const key = '/' + relative(root,file).split(sep).join('/');
        // Worker internals are loaded separately, never exposed as static assets.
        if (key === '/_worker.js' || key === '/_routes.json') continue;
        files.set(key, {data:await readFile(file),type:mime[extname(file)] || 'application/octet-stream'});
      }
    }
  }
  await visit(root);
  return {
    size: files.size,
    async fetch(request) {
      let path;
      try { path = decodeURIComponent(new URL(request.url).pathname); } catch { return new Response('Not found',{status:404}); }
      if (path.includes('\\') || path.includes('\0') || path.split('/').some(x => x === '..' || x === '.')) return new Response('Not found',{status:404});
      if (!['GET','HEAD'].includes(request.method)) return new Response('Method not allowed',{status:405});
      const file = files.get(path);
      if (!file) return new Response('Not found',{status:404});
      return new Response(request.method === 'HEAD' ? null : file.data, {headers:{'Content-Type':file.type,'Content-Length':String(file.data.length)}});
    }
  };
}
