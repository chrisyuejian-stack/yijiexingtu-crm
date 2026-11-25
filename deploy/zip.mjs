import {deflateRawSync,inflateRawSync} from 'node:zlib';

function crc32(data) {let value=0xffffffff;for(const byte of data){value^=byte;for(let n=0;n<8;n++)value=(value>>>1)^((value&1)?0xedb88320:0);}return (value^0xffffffff)>>>0;}
export function encodeZip(entries) {
  const chunks=[],central=[];let offset=0;
  for(const entry of entries){
    const name=Buffer.from(entry.name,'utf8'),data=Buffer.from(entry.data),packed=deflateRawSync(data),crc=crc32(data);
    const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800,6);header.writeUInt16LE(8,8);header.writeUInt16LE(33,12);header.writeUInt32LE(crc,14);header.writeUInt32LE(packed.length,18);header.writeUInt32LE(data.length,22);header.writeUInt16LE(name.length,26);
    chunks.push(header,name,packed);
    const item=Buffer.alloc(46);item.writeUInt32LE(0x02014b50);item.writeUInt16LE((3<<8)|20,4);item.writeUInt16LE(20,6);item.writeUInt16LE(0x800,8);item.writeUInt16LE(8,10);item.writeUInt16LE(33,14);item.writeUInt32LE(crc,16);item.writeUInt32LE(packed.length,20);item.writeUInt32LE(data.length,24);item.writeUInt16LE(name.length,28);item.writeUInt32LE(((entry.mode??0o100644)<<16)>>>0,38);item.writeUInt32LE(offset,42);central.push(item,name);
    offset+=header.length+name.length+packed.length;
  }
  if(entries.length>65535)throw Error('Too many ZIP entries');
  const index=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(index.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...chunks,index,end]);
}
export function safeArchivePath(name) {
  if(!name||name.startsWith('/')||/[\\:\x00-\x1f\x7f]/.test(name)||name.split('/').some(x=>!x||x==='.'||x==='..'))throw Error('Unsafe archive path');
  return name;
}
export function decodeZip(buffer,{maxFiles=10000,maxBytes=512*1024*1024,maxFileBytes=64*1024*1024}={}) {
  const data=Buffer.from(buffer);let end=-1;
  for(let i=data.length-22;i>=Math.max(0,data.length-65557);i--)if(data.readUInt32LE(i)===0x06054b50&&i+22+data.readUInt16LE(i+20)===data.length){end=i;break;}
  if(end<0)throw Error('Invalid ZIP directory');
  if(data.readUInt16LE(end+4)||data.readUInt16LE(end+6))throw Error('Multipart ZIP is unsupported');
  const count=data.readUInt16LE(end+10),start=data.readUInt32LE(end+16),length=data.readUInt32LE(end+12);
  if(count!==data.readUInt16LE(end+8)||count>maxFiles||start+length!==end)throw Error('Invalid ZIP size or entry count');
  const entries=[],names=new Set();let cursor=start,total=0;
  for(let i=0;i<count;i++){
    if(cursor+46>end||data.readUInt32LE(cursor)!==0x02014b50)throw Error('Invalid ZIP entry');
    const flags=data.readUInt16LE(cursor+8),method=data.readUInt16LE(cursor+10),crc=data.readUInt32LE(cursor+16),packedSize=data.readUInt32LE(cursor+20),size=data.readUInt32LE(cursor+24),nameSize=data.readUInt16LE(cursor+28),extraSize=data.readUInt16LE(cursor+30),commentSize=data.readUInt16LE(cursor+32),mode=data.readUInt32LE(cursor+38)>>>16,local=data.readUInt32LE(cursor+42);
    const name=data.subarray(cursor+46,cursor+46+nameSize).toString('utf8');cursor+=46+nameSize+extraSize+commentSize;
    if(flags&1||![0,8].includes(method)||cursor>end||size>maxFileBytes||(total+=size)>maxBytes)throw Error('Unsupported or oversized ZIP entry');
    if(name.endsWith('/')){safeArchivePath(name.slice(0,-1));if(size)throw Error('Invalid ZIP directory entry');continue;}
    safeArchivePath(name);if(names.has(name))throw Error('Duplicate ZIP path');names.add(name);
    if((mode&0o170000)&&((mode&0o170000)!==0o100000))throw Error('ZIP links and special files are forbidden');
    if(local+30>start||data.readUInt32LE(local)!==0x04034b50)throw Error('Invalid ZIP local header');
    const localNameSize=data.readUInt16LE(local+26),localExtra=data.readUInt16LE(local+28),body=local+30+localNameSize+localExtra;
    if(data.subarray(local+30,local+30+localNameSize).toString('utf8')!==name||body+packedSize>start)throw Error('ZIP local path mismatch');
    const raw=data.subarray(body,body+packedSize),value=method===8?inflateRawSync(raw,{maxOutputLength:maxFileBytes}):Buffer.from(raw);
    if(value.length!==size||crc32(value)!==crc)throw Error('ZIP CRC mismatch');
    entries.push({name,data:value,mode});
  }
  if(cursor!==end)throw Error('ZIP directory length mismatch');
  return entries;
}
