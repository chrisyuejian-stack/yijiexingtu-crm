const metadataBase = 'http://metadata.tencentyun.com/latest/meta-data/cam/security-credentials/';
export class RoleCredentials {
  constructor(role, {fetchImpl=fetch,now=Date.now,timeoutMs=5000}={}) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(role)) throw Error('Invalid COS_ROLE_NAME');
    this.url=metadataBase+role;this.fetchImpl=fetchImpl;this.now=now;this.timeoutMs=timeoutMs;
    this.value=null;this.pending=null;
  }
  async get() {
    if (this.value && this.value.ExpiredTime*1000-this.now()>300000) return this.value;
    if (this.pending) return this.pending;
    this.pending=this.refresh();
    try { return await this.pending; } finally { this.pending=null; }
  }
  async refresh() {
    const response=await this.fetchImpl(this.url,{redirect:'error',signal:AbortSignal.timeout(this.timeoutMs)});
    if (!response.ok) throw Error('CVM role metadata unavailable');
    const v=await response.json();
    if (v.Code !== 'Success' || typeof v.TmpSecretId!=='string' || !v.TmpSecretId || typeof v.TmpSecretKey!=='string' || !v.TmpSecretKey || typeof v.Token!=='string' || !v.Token || !Number.isFinite(Number(v.ExpiredTime)) || Number(v.ExpiredTime)*1000-this.now()<=300000) throw Error('Invalid CVM role credentials');
    this.value={TmpSecretId:v.TmpSecretId,TmpSecretKey:v.TmpSecretKey,SecurityToken:v.Token,StartTime:Math.floor(this.now()/1000)-30,ExpiredTime:Number(v.ExpiredTime)};
    return this.value;
  }
}
