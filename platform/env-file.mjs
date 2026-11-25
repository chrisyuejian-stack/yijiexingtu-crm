/** Literal EnvironmentFile subset shared with systemd; never execute shell code. */
export function parseEnvironmentFile(text) {
  const result={};
  for(const line of text.split(/\r?\n/)){
    const value=line.trim();if(!value||value.startsWith('#')||value.startsWith(';'))continue;
    const m=/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(value);if(!m)throw Error('Invalid EnvironmentFile assignment');
    let raw=m[2].trim(),out='';
    if(raw.startsWith("'")){if(!raw.endsWith("'")||raw.length<2)throw Error('Unterminated env quote');out=raw.slice(1,-1);}
    else if(raw.startsWith('"')){
      if(!raw.endsWith('"')||raw.length<2)throw Error('Unterminated env quote');raw=raw.slice(1,-1);
      for(let i=0;i<raw.length;i++){if(raw[i]==='\\'&&i+1<raw.length&&'"\\`$'.includes(raw[i+1]))out+=raw[++i];else out+=raw[i];}
    }else{
      if(/["']/.test(raw))throw Error('Quote the entire environment value');
      for(let i=0;i<raw.length;i++){if(raw[i]==='\\'&&i+1<raw.length)out+=raw[++i];else out+=raw[i];}
    }
    result[m[1]]=out;
  }
  return result;
}
export function encodeEnvironmentValue(value) {if(/[\r\n\0]/.test(value))throw Error('Environment values must be one line');return '"'+value.replace(/["\\`$]/g,'\\$&')+'"';}
