import {HttpError,fail} from './core.js';
export const DEFAULT_GALLERY_LIMIT = 500 * 1024 * 1024;
export function storageFull(storage) {const e=new HttpError(413,'图库容量已满，请清理无引用图片或联系平台调整上限','storage_full');e.details={used:storage.used,limit:storage.limit};throw e;}
// Legacy zero means unmeasured. NULL means the object was verified missing (no bytes used).
// Backfill only touches the new bytes column; versions/business fields remain untouched.
export async function refreshGalleryStorage(env,r) {
  const rows=await r.galleryUnmeasured(20),sizes=[];
  if(rows.length&&!env.CHANNEL_MEDIA)fail(503,'图库存储未配置','configuration_missing');
  try {
    for(const row of rows){
      let bytes;
      if(typeof env.CHANNEL_MEDIA.head==='function') {
        const obj=await env.CHANNEL_MEDIA.head(row.r2_key);bytes=obj?obj.size:null;
      }else{const obj=await env.CHANNEL_MEDIA.get(row.r2_key);bytes=obj?new TextEncoder().encode(await obj.text()).length:null;}
      if(bytes!==null&&(!Number.isSafeInteger(bytes)||bytes<0))throw Error('invalid object size');
      sizes.push({id:row.id,bytes});
    }
    if(sizes.length)await r.gallerySetSizes(sizes);
  }catch{fail(503,'暂时无法核对图库容量，请稍后重试','storage_unavailable');}
  return r.galleryStorage();
}
export function storagePending(storage){const e=new HttpError(503,'图库容量正在统计，请稍后刷新','storage_pending');e.details={storage};throw e;}
export async function requireGalleryCapacity(env,r,bytes) {
  const storage=await refreshGalleryStorage(env,r);
  if(storage.pending)storagePending(storage);
  if(storage.used+bytes>storage.limit)storageFull(storage);
  return storage;
}
